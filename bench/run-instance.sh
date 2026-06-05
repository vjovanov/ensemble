#!/usr/bin/env bash
# Run ONE (instance, arm): set up a clean worktree, run the agent, capture the
# patch + session metrics. Cloning is cached and shared across arms.
#
#   ./run-instance.sh <instance.json> <arm>
#
# Arms: ensemble-strict | sidekick-fs | classic   (see config.sh)
source "$(dirname "${BASH_SOURCE[0]}")/config.sh"

INSTANCE_JSON="${1:?need instance json}"
ARM="${2:?need arm}"
[ -f "$INSTANCE_JSON" ] || die "no such instance json: $INSTANCE_JSON"

eval "$(node "$BENCH_DIR/lib/inst-env.mjs" "$INSTANCE_JSON")"
[ -n "$SHA" ] || die "instance $ID has no base sha"
log "instance=$ID lang=$LANG arm=$ARM model=$MODEL"

PRISTINE="$WORK_DIR/$ID/pristine"
ARM_SRC="$WORK_DIR/$ID/$ARM"
OUT="$RAW_DIR/${ID}__${ARM}"
mkdir -p "$OUT"

# --- 1. Pristine clone at base sha (cached) ---------------------------------
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

# --- 2. Fresh per-arm worktree (copy, not git-worktree, to allow graphify-out) ---
rm -rf "$ARM_SRC"
cp -a "$PRISTINE" "$ARM_SRC"
git -C "$ARM_SRC" reset --hard --quiet "$SHA"
git -C "$ARM_SRC" clean -fdq
# Never let the graphify artifact dir reach the captured patch.
echo "graphify-out/" >> "$ARM_SRC/.git/info/exclude"

# --- 3. Arm-specific exploration setup --------------------------------------
EXPLORATION="sidekick"
declare -a ENVV=()
# Trace the explore sidekick's own tool calls (graph_query/explain/fetch,
# caller_context, …) to a per-run JSONL. "full" includes payload previews.
# Lets us see whether/how the sidekick reads the parent via caller_context.
DEBUG_ENV=("PI_EXPLORE_DEBUG=full" "PI_EXPLORE_DEBUG_LOG=$OUT/explore-debug.jsonl")
rm -f "$OUT/explore-debug.jsonl"
case "$ARM" in
  ensemble-strict)
    command -v "$GRAPHIFY" >/dev/null || die "graphify not on PATH (required for ensemble-strict)"
    log "building graphify graph…"
    ( cd "$ARM_SRC" && "$GRAPHIFY" update "$ARM_SRC" >/dev/null 2>"$OUT/graphify.log" ) \
      || log "graphify update returned nonzero (continuing; strict assert will catch fallback)"
    [ -f "$ARM_SRC/graphify-out/graph.json" ] || log "WARN: no graph.json produced for $LANG"
    # PI_REQUIRE_GRAPH=1 makes graphify a hard precondition (FS-001 §7.4): pi
    # fail-fasts at startup and explore throws rather than ever falling back.
    ENVV=("GRAPHIFY_COMMAND=$GRAPHIFY" "PI_REQUIRE_GRAPH=1" "${DEBUG_ENV[@]}")
    ;;
  sidekick-fs)
    # Force graphify unavailable so the sidekick uses the filesystem fallback.
    rm -rf "$ARM_SRC/graphify-out"
    ENVV=("GRAPHIFY_COMMAND=$BENCH_DIR/no-graphify" "${DEBUG_ENV[@]}")  # nonexistent -> commandAvailable=false
    ;;
  classic)
    EXPLORATION="classic"
    rm -rf "$ARM_SRC/graphify-out"
    ENVV=("GRAPHIFY_COMMAND=$BENCH_DIR/no-graphify")
    ;;
  *) die "unknown arm: $ARM" ;;
esac

# --- 4. Prompt + session dir -------------------------------------------------
PROMPT="$(node "$BENCH_DIR/lib/build-prompt.mjs" "$INSTANCE_JSON")"
SESSION_DIR="$OUT/session"
rm -rf "$SESSION_DIR"; mkdir -p "$SESSION_DIR"

# --- 5. Run the agent --------------------------------------------------------
if [ "$DRY_RUN" = "1" ]; then
  log "DRY_RUN=1 -> skipping paid agent call"
else
  log "running agent (timeout ${AGENT_TIMEOUT}s)…"
  MODEL_ARGS=(--model "$MODEL")
  [ -n "${PROVIDER:-}" ] && MODEL_ARGS=(--provider "$PROVIDER" --model "$MODEL")
  ( cd "$ARM_SRC" && env "${ENVV[@]}" timeout "${AGENT_TIMEOUT}s" \
      "$TSX" --tsconfig "$REPO_ROOT/tsconfig.json" "$REPO_ROOT/packages/coding-agent/src/cli.ts" \
      -p "$PROMPT" \
      "${MODEL_ARGS[@]}" \
      --exploration "$EXPLORATION" \
      --no-context-files \
      `# all arms ignore repo AGENTS.md/CLAUDE.md so the only difference is exploration` \
      --session-dir "$SESSION_DIR" \
    ) >"$OUT/agent.out" 2>"$OUT/agent.err" || log "agent exited nonzero (rc=$?) — see agent.err"
fi

# --- 6. Extract the model patch (graphify-out is git-excluded above) ---------
PATCH="$OUT/patch.diff"
( cd "$ARM_SRC" && git add -A >/dev/null 2>&1; git diff --cached --no-color ) > "$PATCH" 2>/dev/null || true
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
if [ -n "$SESSION_FILE" ]; then
  node "$BENCH_DIR/lib/parse-session.mjs" "$SESSION_FILE" --arm "$ARM" --price "$PRICE" \
    > "$OUT/metrics.json"
  log "metrics: $(node -e 'const m=require(process.argv[1]);console.log(`tokens=${m.totalTokens} cost=$${m.costUsd} turns=${m.assistantTurns} explore=${m.exploreCalls} strict=${m.strictOk}`)' "$OUT/metrics.json")"
else
  log "WARN: no session jsonl found (DRY_RUN or agent failed); writing empty metrics"
  printf '{"arm":"%s","note":"no session"}\n' "$ARM" > "$OUT/metrics.json"
fi
log "done: $OUT"
