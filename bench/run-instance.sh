#!/usr/bin/env bash
# Run ONE (instance, arm): set up a clean worktree, run the agent, capture the
# patch + session metrics. Cloning is cached and shared across arms.
#
#   ./run-instance.sh <instance.json> <arm>
#
# Arms: classic | classic-bash | classic-graph | classic-graph-bash
# Legacy aliases: ensemble-strict | graph-bash | sidekick-fs (see config.sh)
source "$(dirname "${BASH_SOURCE[0]}")/config.sh"

INSTANCE_JSON="${1:?need instance json}"
ARM="${2:?need arm}"
[ -f "$INSTANCE_JSON" ] || die "no such instance json: $INSTANCE_JSON"

eval "$(node "$BENCH_DIR/lib/inst-env.mjs" "$INSTANCE_JSON")"
[ -n "$SHA" ] || die "instance $ID has no base sha"
log "instance=$ID lang=$LANG arm=$ARM model=$MODEL"

PRISTINE="$WORK_DIR/$ID/pristine"
PRISTINE_LOCK="$WORK_DIR/$ID/.pristine.lock"
ARM_SRC="$WORK_DIR/$ID/$ARM"
OUT="$RAW_DIR/${ID}__${ARM}"
GRAPHIFY_WATCH_PID=""
AGENT_PID=""
PRISTINE_LOCK_HELD=0

stop_graphify_watch() {
  if [ -n "$GRAPHIFY_WATCH_PID" ]; then
    if kill -0 "$GRAPHIFY_WATCH_PID" >/dev/null 2>&1; then
      kill -TERM -- "-$GRAPHIFY_WATCH_PID" >/dev/null 2>&1 || kill "$GRAPHIFY_WATCH_PID" >/dev/null 2>&1 || true
      sleep 1
      kill -KILL -- "-$GRAPHIFY_WATCH_PID" >/dev/null 2>&1 || kill -KILL "$GRAPHIFY_WATCH_PID" >/dev/null 2>&1 || true
    fi
    wait "$GRAPHIFY_WATCH_PID" >/dev/null 2>&1 || true
    GRAPHIFY_WATCH_PID=""
  fi
}

stop_agent() {
  if [ -n "$AGENT_PID" ]; then
    if kill -0 "$AGENT_PID" >/dev/null 2>&1; then
      kill -TERM -- "-$AGENT_PID" >/dev/null 2>&1 || kill "$AGENT_PID" >/dev/null 2>&1 || true
      sleep 2
      kill -KILL -- "-$AGENT_PID" >/dev/null 2>&1 || kill -KILL "$AGENT_PID" >/dev/null 2>&1 || true
    fi
    wait "$AGENT_PID" >/dev/null 2>&1 || true
    AGENT_PID=""
  fi
}

acquire_pristine_lock() {
  local lock_pid
  mkdir -p "$WORK_DIR/$ID"
  while ! mkdir "$PRISTINE_LOCK" 2>/dev/null; do
    if [ -f "$PRISTINE_LOCK/pid" ]; then
      lock_pid="$(cat "$PRISTINE_LOCK/pid" 2>/dev/null || true)"
      if [ -n "$lock_pid" ] && ! kill -0 "$lock_pid" 2>/dev/null; then
        rm -f "$PRISTINE_LOCK/pid"
        rmdir "$PRISTINE_LOCK" 2>/dev/null || true
        continue
      fi
    elif rmdir "$PRISTINE_LOCK" 2>/dev/null; then
      continue
    fi
    sleep 0.2
  done
  printf '%s\n' "$$" > "$PRISTINE_LOCK/pid"
  PRISTINE_LOCK_HELD=1
}

release_pristine_lock() {
  if [ "$PRISTINE_LOCK_HELD" = "1" ]; then
    rm -f "$PRISTINE_LOCK/pid"
    rmdir "$PRISTINE_LOCK" 2>/dev/null || true
    PRISTINE_LOCK_HELD=0
  fi
}

cleanup() {
  stop_agent
  stop_graphify_watch
  release_pristine_lock
}
trap cleanup EXIT
trap 'cleanup; exit 130' INT
trap 'cleanup; exit 143' TERM

archive_existing_bundle() {
  [ -e "$OUT" ] || return 0
  stamp="$(date -u +%Y%m%dT%H%M%SZ)"
  archive_dir="$RAW_HISTORY_DIR/${ID}__${ARM}/$stamp"
  if [ -e "$archive_dir" ]; then
    archive_dir="$RAW_HISTORY_DIR/${ID}__${ARM}/${stamp}.$$"
  fi
  mkdir -p "$(dirname "$archive_dir")"
  mv "$OUT" "$archive_dir"
  log "archived previous raw bundle: $archive_dir"
}

# --- 1. Pristine clone at base sha (cached) ---------------------------------
if [ ! -d "$PRISTINE/.git" ]; then
  acquire_pristine_lock
  if [ ! -d "$PRISTINE/.git" ]; then
    # A tiny dataset file can map to a huge repo (e.g. ts/material-ui ~750MB).
    # Refuse to pull anything over MAX_REPO_MB unless FORCE=1.
    REPO_KB=$(node "$BENCH_DIR/lib/repo-size-kb.mjs" "$ORG" "$REPO" 2>/dev/null || echo 0)
    if [ "${FORCE:-0}" != "1" ] && [ "${REPO_KB:-0}" -gt "$((MAX_REPO_MB * 1024))" ] 2>/dev/null; then
      die "$ORG/$REPO is ~$((REPO_KB / 1024))MB > MAX_REPO_MB=${MAX_REPO_MB}MB. Pick a smaller repo or set FORCE=1."
    fi
    log "cloning $ORG/$REPO @ ${SHA:0:12} (~$((REPO_KB / 1024))MB)"
    rm -rf "$PRISTINE"; mkdir -p "$PRISTINE"
    git clone --quiet --filter=blob:none "https://github.com/$ORG/$REPO" "$PRISTINE" \
      || die "clone failed for $ORG/$REPO"
    git -C "$PRISTINE" checkout --quiet --detach "$SHA" \
      || die "checkout $SHA failed (commit not on default remote?)"
  fi
  release_pristine_lock
fi

# Each attempt owns its raw bundle. On rerun, archive the previous bundle first
# so the latest numbers update in raw/ without losing the old evidence.
archive_existing_bundle
mkdir -p "$OUT"

# --- 2. Fresh per-arm worktree ------------------------------------------------
rm -rf "$ARM_SRC"
cp -a "$PRISTINE" "$ARM_SRC"
git -C "$ARM_SRC" reset --hard --quiet "$SHA"
git -C "$ARM_SRC" clean -fdq
# Defense-in-depth for older/incomplete runs; strict runs write graphify artifacts
# outside the worktree before the agent starts.
echo "graphify-out/" >> "$ARM_SRC/.git/info/exclude"

# --- 3. Arm-specific exploration setup --------------------------------------
EXPLORATION="sidekick"
declare -a ENVV=()
declare -a SKILL_ARGS=()   # extra pi flags (e.g. --skill) for arms that load a skill
# Trace the explore sidekick's own tool calls (graph_query/explain/fetch,
# caller_context, …) to a per-run JSONL. "full" includes payload previews.
# Lets us see whether/how the sidekick reads the parent via caller_context.
DEBUG_ENV=("PI_EXPLORE_DEBUG=full" "PI_EXPLORE_DEBUG_LOG=$OUT/explore-debug.jsonl")
rm -f "$OUT/explore-debug.jsonl"
# §DF-014: out-of-band capture of bash (raw output -> digest) for the bash-summary arms.
BASH_DIGEST_DEBUG=("PI_BASH_DIGEST_DEBUG_LOG=$OUT/bash-digest-debug.jsonl")
rm -f "$OUT/bash-digest-debug.jsonl"
GRAPHIFY_WATCH_ENABLED=0
case "$ARM" in
  classic-graph|ensemble-strict)
    command -v "$GRAPHIFY" >/dev/null || die "graphify not on PATH (required for $ARM)"
    log "building graphify graph…"
    GRAPH_ARTIFACT_DIR="$OUT/graphify"
    rm -rf "$GRAPH_ARTIFACT_DIR" "$ARM_SRC/graphify-out"
    ( cd "$ARM_SRC" && GRAPHIFY_OUT="$GRAPH_ARTIFACT_DIR" "$GRAPHIFY" update "$ARM_SRC" >/dev/null 2>"$OUT/graphify.log" ) \
      || log "graphify update returned nonzero (continuing; strict assert will catch fallback)"
    GRAPH_FILE="$GRAPH_ARTIFACT_DIR/graph.json"
    [ -f "$GRAPH_FILE" ] || log "WARN: no graph.json produced for $LANG"
    GRAPHIFY_WATCH_ENABLED=1
    # PI_REQUIRE_GRAPH=1 makes graphify a hard precondition (FS-001 §7.4): pi
    # fail-fasts at startup and explore throws rather than ever falling back.
    # PI_GRAPHIFY_GRAPH_FILE keeps backend artifacts out of the source tree (§FS-001-ensemble-explore.2.1).
    ENVV=("GRAPHIFY_COMMAND=$GRAPHIFY" "PI_REQUIRE_GRAPH=1" "PI_GRAPHIFY_GRAPH_FILE=$GRAPH_FILE" "PI_BASH_OUTPUT_SUMMARY=0" "${DEBUG_ENV[@]}")
    ;;
  classic-graph-bash|graph-bash)
    command -v "$GRAPHIFY" >/dev/null || die "graphify not on PATH (required for $ARM)"
    log "building graphify graph…"
    GRAPH_ARTIFACT_DIR="$OUT/graphify"
    rm -rf "$GRAPH_ARTIFACT_DIR" "$ARM_SRC/graphify-out"
    ( cd "$ARM_SRC" && GRAPHIFY_OUT="$GRAPH_ARTIFACT_DIR" "$GRAPHIFY" update "$ARM_SRC" >/dev/null 2>"$OUT/graphify.log" ) \
      || log "graphify update returned nonzero (continuing; strict assert will catch fallback)"
    GRAPH_FILE="$GRAPH_ARTIFACT_DIR/graph.json"
    [ -f "$GRAPH_FILE" ] || log "WARN: no graph.json produced for $LANG"
    GRAPHIFY_WATCH_ENABLED=1
    ENVV=("GRAPHIFY_COMMAND=$GRAPHIFY" "PI_REQUIRE_GRAPH=1" "PI_GRAPHIFY_GRAPH_FILE=$GRAPH_FILE" "PI_BASH_OUTPUT_SUMMARY=1" "${BASH_DIGEST_DEBUG[@]}" "${DEBUG_ENV[@]}")
    ;;
  sidekick-fs)
    # Force graphify unavailable so the sidekick uses the filesystem fallback.
    rm -rf "$ARM_SRC/graphify-out"
    ENVV=("GRAPHIFY_COMMAND=$BENCH_DIR/no-graphify" "PI_BASH_OUTPUT_SUMMARY=0" "${DEBUG_ENV[@]}")  # nonexistent -> commandAvailable=false
    ;;
  classic-bash)
    EXPLORATION="classic"
    rm -rf "$ARM_SRC/graphify-out"
    ENVV=("GRAPHIFY_COMMAND=$BENCH_DIR/no-graphify" "PI_BASH_OUTPUT_SUMMARY=1" "${BASH_DIGEST_DEBUG[@]}")
    ;;
  classic)
    EXPLORATION="classic"
    rm -rf "$ARM_SRC/graphify-out"
    ENVV=("GRAPHIFY_COMMAND=$BENCH_DIR/no-graphify" "PI_BASH_OUTPUT_SUMMARY=0")
    ;;
  classic-graphify)
    # classic exploration (NO pi explore sidekick) + graphify's OWN shipped skill (skill.md):
    # the lead drives graphify directly via bash. Build the graph IN-TREE so the lead's
    # `graphify query` finds graphify-out/ in cwd; it is git-excluded above, so it never enters
    # the patch. A/B vs classic-graph (same graph, sidekick vs. skill). §FS-001-ensemble-explore.
    command -v "$GRAPHIFY" >/dev/null || die "graphify not on PATH (required for $ARM)"
    [ -f "$GRAPHIFY_SKILL" ] || die "graphify skill not found: $GRAPHIFY_SKILL (set GRAPHIFY_SKILL)"
    EXPLORATION="classic"
    log "building graphify graph (in-tree graphify-out/)…"
    GRAPH_ARTIFACT_DIR="$ARM_SRC/graphify-out"
    rm -rf "$GRAPH_ARTIFACT_DIR"
    ( cd "$ARM_SRC" && GRAPHIFY_OUT="$GRAPH_ARTIFACT_DIR" "$GRAPHIFY" update "$ARM_SRC" >/dev/null 2>"$OUT/graphify.log" ) \
      || log "graphify update returned nonzero (continuing)"
    [ -f "$GRAPH_ARTIFACT_DIR/graph.json" ] || log "WARN: no graph.json produced for $LANG"
    cp -r "$GRAPH_ARTIFACT_DIR" "$OUT/graphify" 2>/dev/null || true   # snapshot for audit
    # Hard directive: the passive skill is ignored (lead never reads it / runs graphify), so
    # explicitly require graphify-first navigation. Measures graphify's best case; A/B vs classic.
    GRAPHIFY_NUDGE='This repository has a prebuilt graphify knowledge graph at graphify-out/graph.json. You MUST use the graphify CLI to locate relevant code (definitions, callers, call paths) BEFORE reading files or editing: run `graphify explain "<symbol>"`, `graphify query "<text>"`, and `graphify path "A" "B"` via bash (they default to --graph graphify-out/graph.json). See the graphify skill for usage. Use ripgrep/read only when graphify cannot answer the question.'
    SKILL_ARGS=(--skill "$GRAPHIFY_SKILL" --append-system-prompt "$GRAPHIFY_NUDGE")
    ENVV=("PI_BASH_OUTPUT_SUMMARY=0")
    ;;
  codex)
    # Reference arm: OpenAI Codex CLI (cdx), not pi. No graphify, no pi env.
    EXPLORATION="codex"
    rm -rf "$ARM_SRC/graphify-out"
    ENVV=()
    ;;
  *) die "unknown arm: $ARM" ;;
esac

# --- 4. Prompt + session dir -------------------------------------------------
PROMPT="$(node "$BENCH_DIR/lib/build-prompt.mjs" "$INSTANCE_JSON")"
SESSION_DIR="$OUT/session"
rm -rf "$SESSION_DIR"; mkdir -p "$SESSION_DIR"

# --- 4b. Run bundle: commit link + the exact prompts this run uses -----------
# Every run is self-describing: prompts + tool calls (session/ + explore-debug) +
# logs, all pinned to the product commit it ran against.
COMMIT="$(git -C "$REPO_ROOT" rev-parse HEAD 2>/dev/null || echo unknown)"
DIRTY=false; [ -n "$(git -C "$REPO_ROOT" status --porcelain 2>/dev/null)" ] && DIRTY=true
DBG=off
case "$ARM" in
  classic-graph|classic-graph-bash|ensemble-strict|graph-bash|sidekick-fs) DBG=full ;;
esac
REQUIRE_GRAPH=0
case "$ARM" in
  classic-graph|classic-graph-bash|ensemble-strict|graph-bash) REQUIRE_GRAPH=1 ;;
esac
if [ "$ARM" = "classic-bash" ] || [ "$ARM" = "classic-graph-bash" ] || [ "$ARM" = "graph-bash" ]; then
  BASH_OUTPUT_SUMMARY=1
else
  BASH_OUTPUT_SUMMARY=0
fi
node -e '
  const fs=require("fs");
  const [out,commit,dirty,model,provider,arm,inst,lang,expl,rg,dbg,bashSummary]=process.argv.slice(1);
  fs.writeFileSync(out+"/manifest.json", JSON.stringify({
    instance:inst, arm, language:lang,
    commit, dirty:dirty==="true",
    model, provider, exploration:expl, require_graph:rg==="1",
    bash_output_summary: bashSummary==="1",
    explore_debug: dbg,
    tool_calls: {lead:"session/*.jsonl", sidekick: dbg==="full" ? "explore-debug.jsonl" : null},
    prompts_dir: "prompts/",
  },null,2)+"\n");
' "$OUT" "$COMMIT" "$DIRTY" "$MODEL" "${PROVIDER:-}" "$ARM" "$ID" "$LANG" "$EXPLORATION" "$REQUIRE_GRAPH" "$DBG" "$BASH_OUTPUT_SUMMARY"
if [ "$ARM" = "classic" ] || [ "$ARM" = "classic-bash" ] || [ "$ARM" = "codex" ] || [ "$ARM" = "classic-graphify" ]; then
  mkdir -p "$OUT/prompts"
  if [ "$ARM" = "codex" ]; then
    printf 'codex arm (reference): OpenAI Codex CLI (cdx exec) run on the same task prompt and base commit.\nUses Codex'\''s own agent on the same model (gpt-5.5/oca) at reasoning effort=medium (matched to classic), not pi.\nFor orientation per GRUND-002; resolved verdict only.\n' > "$OUT/prompts/NOTE.txt"
  elif [ "$ARM" = "classic-graphify" ]; then
    printf 'classic-graphify arm: classic exploration (NO pi explore sidekick) + graphify'\''s OWN shipped skill\n(%s). Lead drives graphify directly via bash against the in-tree graphify-out/ graph.\nBase pi system prompt pinned by commit %s. A/B vs classic-graph (same graph, sidekick vs. skill).\n' "$GRAPHIFY_SKILL" "$COMMIT" > "$OUT/prompts/NOTE.txt"
    cp "$GRAPHIFY_SKILL" "$OUT/prompts/graphify-skill.md" 2>/dev/null || true
  elif [ "$ARM" = "classic-bash" ]; then
    printf 'classic-bash arm: classic exploration with the bash sidekick enabled. Uses the base pi system prompt (pinned by\ncommit %s) plus read/grep/find/ls tools. No explore sidekick prompt.\n' "$COMMIT" > "$OUT/prompts/NOTE.txt"
  else
    printf 'classic arm: classic exploration with bash sidekick disabled. Uses the base pi system prompt (pinned by\ncommit %s) plus read/grep/find/ls tools. No explore sidekick prompt.\n' "$COMMIT" > "$OUT/prompts/NOTE.txt"
  fi
else
  "$TSX" --tsconfig "$REPO_ROOT/tsconfig.json" "$BENCH_DIR/lib/dump-prompts.mjs" "$OUT/prompts" >/dev/null 2>&1 \
    || log "WARN: could not dump prompts"
fi
[ "$DIRTY" = "true" ] && log "NOTE: repo tree is dirty — commit before runs you intend to publish (manifest records commit=$COMMIT, dirty=true)"

# --- 5. Run the agent --------------------------------------------------------
if [ "$DRY_RUN" = "1" ]; then
  log "DRY_RUN=1 -> skipping paid agent call"
else
  log "running agent (timeout ${AGENT_TIMEOUT}s)…"
  if [ "$ARM" = "codex" ]; then
    command -v cdx >/dev/null || die "cdx (Codex CLI) not on PATH"
    # cdx already passes --dangerously-bypass-approvals-and-sandbox; edits land in ARM_SRC.
    # Match the pi classic arm's reasoning level (gpt-5.5 thinkingLevel=medium); Codex's
    # config default is "high". Same model (gpt-5.5/oca), so this aligns model + effort.
    # --json emits event JSONL (incl. per-turn token usage) to stdout; the final message is
    # captured separately via --output-last-message so we still keep agent.out for inspection.
    ( cd "$ARM_SRC" && timeout "${AGENT_TIMEOUT}s" \
        cdx exec -C "$ARM_SRC" -c model_reasoning_effort="medium" \
          --json --output-last-message "$OUT/agent.out" "$PROMPT" \
      ) >"$OUT/codex-events.jsonl" 2>"$OUT/agent.err" &
    AGENT_PID=$!
  else
    MODEL_ARGS=(--model "$MODEL")
    [ -n "${PROVIDER:-}" ] && MODEL_ARGS=(--provider "$PROVIDER" --model "$MODEL")
    if [ "$GRAPHIFY_WATCH_ENABLED" = "1" ]; then
      log "starting graphify watch…"
      setsid bash -c 'cd "$1" && exec env GRAPHIFY_OUT="$2" "$3" watch "$1"' \
        bash "$ARM_SRC" "$GRAPH_ARTIFACT_DIR" "$GRAPHIFY" \
        >"$OUT/graphify-watch.log" 2>&1 &
      GRAPHIFY_WATCH_PID=$!
      sleep 1
      if ! kill -0 "$GRAPHIFY_WATCH_PID" >/dev/null 2>&1; then
        log "graphify watch failed to start; see $OUT/graphify-watch.log"
        die "graphify watch is required for ensemble-strict"
      fi
    fi
    ( cd "$ARM_SRC" && env "${ENVV[@]}" timeout "${AGENT_TIMEOUT}s" \
        "$TSX" --tsconfig "$REPO_ROOT/tsconfig.json" "$REPO_ROOT/packages/coding-agent/src/cli.ts" \
        -p "$PROMPT" \
        "${MODEL_ARGS[@]}" \
        --exploration "$EXPLORATION" \
        ${SKILL_ARGS[@]+"${SKILL_ARGS[@]}"} \
        --no-context-files \
        --session-dir "$SESSION_DIR" \
      ) >"$OUT/agent.out" 2>"$OUT/agent.err" &
    AGENT_PID=$!
  fi
  if wait "$AGENT_PID"; then
    AGENT_PID=""
  else
    agent_rc=$?
    AGENT_PID=""
    log "agent exited nonzero (rc=$agent_rc) — see agent.err"
  fi
  stop_graphify_watch
fi

# --- 6. Extract the model patch ---------------------------------------------
PATCH="$OUT/patch.diff"
if [ "$ARM" = "codex" ]; then
  # Codex may commit its own changes, so diff against the base sha to capture both
  # committed and working-tree edits.
  ( cd "$ARM_SRC" && git diff "$SHA" --no-color -- . ':(exclude)graphify-out' ) > "$PATCH" 2>/dev/null || true
else
(
  cd "$ARM_SRC"
  # The agent may run git commands itself. Keep graphify artifacts out even if
  # they were staged before this capture step.
  git reset --quiet -- graphify-out >/dev/null 2>&1 || true
  git add -A -- . ':!graphify-out' ':!graphify-out/**' >/dev/null 2>&1
  git reset --quiet -- graphify-out >/dev/null 2>&1 || true
  git diff --cached --no-color
) > "$PATCH" 2>/dev/null || true
fi
PATCH_BYTES=$(wc -c < "$PATCH" | tr -d ' ')
log "patch: $PATCH_BYTES bytes -> $PATCH"

# Write a single per-(instance,arm) patch record in the harness's fix_patch
# format. One record per file (overwritten on rerun), so direct reruns never
# accumulate duplicates; eval/run-eval.sh assembles these into per-arm jsonls.
node -e '
const fs=require("fs");
const inst=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));
const patch=fs.readFileSync(process.argv[2],"utf8");
const rec={org:inst.org,repo:inst.repo,number:inst.number,fix_patch:patch};
fs.writeFileSync(process.argv[3], JSON.stringify(rec)+"\n");
' "$INSTANCE_JSON" "$PATCH" "$OUT/patch.jsonl"

# --- 7. Metrics + strict assertion ------------------------------------------
SESSION_FILE="$(find "$SESSION_DIR" -name '*.jsonl' -type f 2>/dev/null | head -1)"
if [ "$ARM" = "codex" ]; then
  # Codex has no pi session; derive metrics from the cdx --json event log instead.
  if [ -s "$OUT/codex-events.jsonl" ]; then
    node "$BENCH_DIR/lib/codex-metrics.mjs" "$OUT/codex-events.jsonl" --arm codex --model "$MODEL" --price "$PRICE" \
      > "$OUT/metrics.json"
    log "metrics: $(node -e 'const m=require(process.argv[1]);console.log(`tokens=${m.totalTokens} cost=$${m.costUsd} turns=${m.assistantTurns}`)' "$OUT/metrics.json")"
  else
    log "WARN: no codex events (DRY_RUN or agent failed); writing empty metrics"
    printf '{"arm":"codex","note":"no events"}\n' > "$OUT/metrics.json"
  fi
elif [ -n "$SESSION_FILE" ]; then
  node "$BENCH_DIR/lib/parse-session.mjs" "$SESSION_FILE" --arm "$ARM" --price "$PRICE" \
    > "$OUT/metrics.json"
  log "metrics: $(node -e 'const m=require(process.argv[1]);console.log(`tokens=${m.totalTokens} cost=$${m.costUsd} turns=${m.assistantTurns} explore=${m.exploreCalls} strict=${m.strictOk}`)' "$OUT/metrics.json")"
else
  log "WARN: no session jsonl found (DRY_RUN or agent failed); writing empty metrics"
  printf '{"arm":"%s","note":"no session"}\n' "$ARM" > "$OUT/metrics.json"
fi
log "done: $OUT"
