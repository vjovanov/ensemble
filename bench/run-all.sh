#!/usr/bin/env bash
# Run every fetched instance across every arm, then grade and collect results.
#
#   ./run-all.sh                       # all instances in bench/instances/, all ARMS
#   INSTANCES='bench/instances/foo.json bar.json' ./run-all.sh
#   ARMS='classic-bash classic' ./run-all.sh
#   ./run-all.sh --langs cpp,js --instances simdjson__simdjson-2178 --arms classic-bash,classic
#   ./run-all.sh --csv /tmp/bench.csv --arms classic-bash,classic
#   DRY_RUN=1 ./run-all.sh             # plumbing only, no paid agent calls
#
# Prints each instance/arm as it starts and finishes. Each instance runs its
# arms together up to PARALLEL, joins them, then prints a side-by-side summary.
source "$(dirname "${BASH_SOURCE[0]}")/config.sh"

while [ "$#" -gt 0 ]; do
  case "$1" in
    --langs|--lang)
      [ "$#" -ge 2 ] || die "$1 needs a value"
      BENCH_LANGS="$2"; shift 2 ;;
    --instances|--instance|--ids|--id)
      [ "$#" -ge 2 ] || die "$1 needs a value"
      BENCH_INSTANCES="$2"; shift 2 ;;
    --csv)
      [ "$#" -ge 2 ] || die "$1 needs a value"
      BENCH_CSV="$2"; shift 2 ;;
    --arms|--modes|--mode)
      [ "$#" -ge 2 ] || die "$1 needs a value"
      ARMS="${2//,/ }"; shift 2 ;;
    --parallel)
      [ "$#" -ge 2 ] || die "$1 needs a value"
      PARALLEL="$2"; shift 2 ;;
    --dry-run)
      DRY_RUN=1; shift ;;
    --skip-eval)
      SKIP_EVAL=1; shift ;;
    --reuse-eval)
      REUSE_EVAL=1; shift ;;
    --reuse-classic)
      REUSE_CLASSIC=1; shift ;;
    --help|-h)
      cat <<'EOF'
usage: ./run-all.sh [--langs cpp,js] [--instances id-or-path[,id-or-path...]] [--csv file.csv] [--arms classic-bash,classic]

Selection:
  --langs        Filter fetched bench/instances/*.json by instance language.
  --instances   Comma/space-separated instance ids or JSON paths.
  --csv          CSV with instance/id/path column, or first column containing ids/paths.
  --arms         Comma/space-separated benchmark arms, e.g. classic-bash,classic.

Existing env vars still work: BENCH_LANGS, BENCH_INSTANCES, BENCH_CSV, INSTANCES, ARMS.
EOF
      exit 0 ;;
    *)
      die "unknown argument: $1" ;;
  esac
done

ARMS="${ARMS//,/ }"

SELECTED_INSTANCES="$(node "$BENCH_DIR/lib/select-instances.mjs" \
  --inst-dir "$INST_DIR" \
  --instances "${INSTANCES:-}" \
  --ids "${BENCH_INSTANCES:-${BENCH_IDS:-}}" \
  --langs "${BENCH_LANGS:-${LANGS:-}}" \
  --csv "${BENCH_CSV:-}")" \
  || die "no instances found. Run: node fetch-instances.mjs <lang> <index>"
readarray -t INSTANCE_LIST <<< "$SELECTED_INSTANCES"
[ "${#INSTANCE_LIST[@]}" -gt 0 ] || die "no instances matched selection"

read -r -a RESULT_ARM_LIST <<< "$ARMS"
ARM_LIST=("${RESULT_ARM_LIST[@]}")
if [ "$REUSE_CLASSIC" = "1" ]; then
  ARM_LIST=()
  for arm in "${RESULT_ARM_LIST[@]}"; do
    [ "$arm" = "classic" ] && continue
    ARM_LIST+=("$arm")
  done
  [ "${#ARM_LIST[@]}" -gt 0 ] || die "REUSE_CLASSIC=1 removed every runnable arm from ARMS='$ARMS'"
fi

# PARALLEL = how many arms of the same instance to run concurrently (default 1).
# Instances run sequentially so each joined comparison is for the same benchmark.
: "${PARALLEL:=1}"
: "${PROGRESS_INTERVAL:=10}"

declare -A running   # pid -> instance/arm label
RUN_LOCK_DIR="$BENCH_DIR/.run-all.lock"
RUN_LOCK_HELD=0
PROGRESS_PID=""
PROGRESS_LINES=0
PROGRESS_RENDERER="$BENCH_DIR/lib/run-progress.mjs"
PROGRESS_RENDERER_TEMP=""

acquire_run_lock() {
  local lock_pid
  while ! mkdir "$RUN_LOCK_DIR" 2>/dev/null; do
    lock_pid=""
    [ -f "$RUN_LOCK_DIR/pid" ] && lock_pid="$(cat "$RUN_LOCK_DIR/pid" 2>/dev/null || true)"
    if [ -n "$lock_pid" ] && kill -0 "$lock_pid" 2>/dev/null; then
      die "benchmark already running (pid=$lock_pid); stop it before starting another run"
    fi
    rm -f "$RUN_LOCK_DIR/pid"
    if ! rmdir "$RUN_LOCK_DIR" 2>/dev/null; then
      die "benchmark lock exists at $RUN_LOCK_DIR; remove it after verifying no benchmark is active"
    fi
  done
  printf '%s\n' "$$" > "$RUN_LOCK_DIR/pid"
  RUN_LOCK_HELD=1
}

release_run_lock() {
  local owner
  if [ "$RUN_LOCK_HELD" = "1" ]; then
    owner="$(cat "$RUN_LOCK_DIR/pid" 2>/dev/null || true)"
    if [ "$owner" = "$$" ]; then
      rm -f "$RUN_LOCK_DIR/pid"
      rmdir "$RUN_LOCK_DIR" 2>/dev/null || true
    fi
    RUN_LOCK_HELD=0
  fi
  if [ -n "$PROGRESS_RENDERER_TEMP" ]; then
    rm -f "$PROGRESS_RENDERER_TEMP"
    PROGRESS_RENDERER_TEMP=""
  fi
}

snapshot_progress_renderer() {
  PROGRESS_RENDERER_TEMP="$(mktemp "${TMPDIR:-/tmp}/bench-run-progress.XXXXXX.mjs")"
  cp "$BENCH_DIR/lib/run-progress.mjs" "$PROGRESS_RENDERER_TEMP"
  PROGRESS_RENDERER="$PROGRESS_RENDERER_TEMP"
}

cleanup_children() {
  local pids=("${!running[@]}")
  local pid
  stop_progress_reporter
  [ "${#pids[@]}" -gt 0 ] || return 0
  log "terminating ${#pids[@]} active arm job(s)…"
  for pid in "${pids[@]}"; do
    kill -TERM -- "-$pid" 2>/dev/null || kill -TERM "$pid" 2>/dev/null || true
  done
  sleep 2
  for pid in "${pids[@]}"; do
    kill -KILL -- "-$pid" 2>/dev/null || kill -KILL "$pid" 2>/dev/null || true
  done
  wait "${pids[@]}" 2>/dev/null || true
}

on_exit() {
  local rc=$?
  trap - EXIT
  if [ "$rc" -ne 0 ]; then
    cleanup_children
  else
    stop_progress_reporter
  fi
  release_run_lock
  exit "$rc"
}

trap 'trap - INT TERM HUP QUIT EXIT; cleanup_children; release_run_lock; exit 130' INT
trap 'trap - INT TERM HUP QUIT EXIT; cleanup_children; release_run_lock; exit 143' TERM HUP QUIT
trap on_exit EXIT

start_progress_reporter() {
  local short="$1" started_at tui
  started_at="$(node -e 'console.log(Date.now())')"
  tui=0
  if [ -t 2 ]; then
    tui=1
  else
    PROGRESS_LINES=0
  fi
  (
    previous_lines=0
    while true; do
      columns="$(tput cols 2>/dev/null || printf '120')"
      if [ "$tui" = "1" ]; then
        if [ "$previous_lines" -gt 0 ]; then
          printf '\033[%sF\033[J' "$previous_lines" >&2
        fi
      fi
      output="$(node "$PROGRESS_RENDERER" \
        --raw-dir "$RAW_DIR" \
        --id "$short" \
        --arms "${ARM_LIST[*]}" \
        --started-at "$started_at" \
        --timeout "$AGENT_TIMEOUT" \
        --tui "$tui" \
        --columns "$columns" 2>&1 || true)"
      printf '%s\n' "$output" >&2
      previous_lines="$(printf '%s\n' "$output" | wc -l | tr -d ' ')"
      sleep "$PROGRESS_INTERVAL"
    done
  ) &
  PROGRESS_PID=$!
}

stop_progress_reporter() {
  if [ -n "$PROGRESS_PID" ]; then
    kill "$PROGRESS_PID" 2>/dev/null || true
    wait "$PROGRESS_PID" 2>/dev/null || true
    PROGRESS_PID=""
    PROGRESS_LINES=0
  fi
}

run_instance_all_arms() {
  local inst="$1" short rc arm arm_log pid done_pid active arm_parallel done_runs
  local -A arm_for_pid
  short="$(basename "$inst" .json)"
  rc=0
  active=0
  arm_parallel="$PARALLEL"
  [ "$arm_parallel" -gt 0 ] || arm_parallel=1

  start_progress_reporter "$short"
  for arm in "${ARM_LIST[@]}"; do
    while [ "$active" -ge "$arm_parallel" ]; do
      done_pid=""
      if wait -n -p done_pid "${!arm_for_pid[@]}"; then
        log "done $short / ${arm_for_pid[$done_pid]}"
      else
        log "FAILED $short / ${arm_for_pid[$done_pid]}"
        rc=1
      fi
      unset 'running[$done_pid]' 'arm_for_pid[$done_pid]'
      active=$((active - 1))
    done

    arm_log="$RAW_DIR/.log_${short}_${arm}.txt"
    log "run $short / $arm (log: $arm_log)"
    setsid "$BENCH_DIR/run-instance.sh" "$inst" "$arm" >"$arm_log" 2>&1 &
    pid=$!
    running[$pid]="$short / $arm"
    arm_for_pid[$pid]="$arm"
    active=$((active + 1))
  done

  while [ "$active" -gt 0 ]; do
    done_pid=""
    if wait -n -p done_pid "${!arm_for_pid[@]}"; then
      log "done $short / ${arm_for_pid[$done_pid]}"
    else
      log "FAILED $short / ${arm_for_pid[$done_pid]}"
      rc=1
    fi
    unset 'running[$done_pid]' 'arm_for_pid[$done_pid]'
    active=$((active - 1))
  done
  stop_progress_reporter

  instance_summary "$short" "$rc"
  done_runs="$(metrics_count)"
  log "progress: $done_runs/$runs_total runs have metrics"
  return "$rc"
}

# One-line per-instance summary once both arms are done (tokens/cost/turns per arm).
instance_summary() {
  local status="$2"
  node -e '
    const fs=require("fs"); const [dir,id,status,...arms]=process.argv.slice(1);
    const lbl=a=>a==="ensemble-strict"?"graph":a;
    const val=(m,...keys)=>keys.reduce((found,key)=>found ?? m?.[key], undefined) ?? 0;
    const total=(m)=>val(m,"totalTokens") ||
      val(m,"input","inputTokens") + val(m,"output","outputTokens") +
      val(m,"cacheRead","cacheInputTokens") + val(m,"cacheWrite");
    const fmt=(n)=>n.toLocaleString();
    const sign=(n)=>n > 0 ? "+" : "";
    const breakdown=(m)=>[
      `${fmt(val(m,"input","inputTokens"))} i`,
      `${fmt(val(m,"output","outputTokens"))} o`,
      `${fmt(val(m,"cacheRead","cacheInputTokens"))} c-i`,
      `${fmt(val(m,"cacheWrite"))} c-w`,
    ].join(" ");
    const deltaBreakdown=(candidate,baseline)=>[
      ["input","inputTokens","i"],
      ["output","outputTokens","o"],
      ["cacheRead","cacheInputTokens","c-i"],
      ["cacheWrite","cacheWrite","c-w"],
    ].map(([key,alt,label]) => {
      const d = val(candidate,key,alt) - val(baseline,key,alt);
      return `${sign(d)}${fmt(d)} ${label}`;
    }).join(" ");
    const metrics = new Map(arms.map((a) => {
      const p=`${dir}/${id}__${a}/metrics.json`;
      return [a, fs.existsSync(p) ? JSON.parse(fs.readFileSync(p,"utf8")) : null];
    }));
    const parts=arms.map((a) => {
      const m=metrics.get(a);
      if (!m) return `${lbl(a)}: -`;
      return `${lbl(a)} ${fmt(total(m))}tok [${breakdown(m)}] $${(m.costUsd||0).toFixed(3)} ${m.assistantTurns||0}t`;
    });
    const baselineArm = arms.includes("classic") ? "classic" : arms[0];
    const candidateArm = arms.find((a) => a !== baselineArm && metrics.get(a));
    const baseline = metrics.get(baselineArm);
    const candidate = candidateArm ? metrics.get(candidateArm) : null;
    let cmp = "";
    if (baseline && candidate) {
      const dt = total(candidate) - total(baseline);
      const dc = (candidate.costUsd || 0) - (baseline.costUsd || 0);
      const turns = (candidate.assistantTurns || 0) - (baseline.assistantTurns || 0);
      cmp = `   |   ${lbl(candidateArm)} vs ${lbl(baselineArm)}: ${sign(dt)}${fmt(dt)}tok [${deltaBreakdown(candidate,baseline)}] ${sign(dc)}$${dc.toFixed(3)} ${sign(turns)}${turns}t`;
    }
    console.log(`  ${status === "0" ? "OK" : "FAIL"} ${id}   ${parts.join("   |   ")}${cmp}`);
  ' "$RAW_DIR" "$1" "$status" "${RESULT_ARM_LIST[@]}"
}

metrics_count() {
  local count inst short arm
  count=0
  for inst in "${INSTANCE_LIST[@]}"; do
    short="$(basename "$inst" .json)"
    for arm in "${ARM_LIST[@]}"; do
      [ -f "$RAW_DIR/${short}__${arm}/metrics.json" ] && count=$((count + 1))
    done
  done
  printf '%s\n' "$count"
}

tool_call_report() {
  node "$BENCH_DIR/lib/tool-call-report.mjs" \
    --raw-dir "$RAW_DIR" \
    --instances "${INSTANCE_LIST[*]}" \
    --arms "${RESULT_ARM_LIST[*]}" \
    --out "$RESULTS_DIR/tool-calls.tsv"
}

total=${#INSTANCE_LIST[@]}
runs_total=$((total * ${#ARM_LIST[@]}))

acquire_run_lock
snapshot_progress_renderer

log "instances=$total run_arms=(${ARM_LIST[*]}) result_arms=(${RESULT_ARM_LIST[*]}) model=$MODEL parallel=$PARALLEL dry_run=$DRY_RUN skip_eval=$SKIP_EVAL reuse_eval=$REUSE_EVAL reuse_classic=$REUSE_CLASSIC"
failures=0

for idx in "${!INSTANCE_LIST[@]}"; do
  inst="${INSTANCE_LIST[$idx]}"
  short="$(basename "$inst" .json)"
  log "started $short ($((idx + 1))/$total)"
  if ! run_instance_all_arms "$inst"; then
    failures=$((failures + 1))
    log "instance job failed: $short"
  fi
done

echo
tool_call_report || log "tool-call report failed; check raw session logs"

if [ "$failures" -ne 0 ]; then
  die "$failures instance job(s) failed; skipping grading"
fi

if [ "$DRY_RUN" = "1" ]; then
  log "all dry-run plumbing complete. Patches in $PATCH_DIR/."
  log "skipping Docker grading because DRY_RUN=1"
else
  if [ "$SKIP_EVAL" = "1" ]; then
    log "skipping Docker grading because SKIP_EVAL=1"
  else
    log "all runs complete. Grading patches in Docker…"
    INSTANCES="${INSTANCE_LIST[*]}" ARMS="${RESULT_ARM_LIST[*]}" REUSE_CLASSIC="$REUSE_CLASSIC" REUSE_EVAL="$REUSE_EVAL" "$BENCH_DIR/eval/run-eval.sh" \
      || log "Docker grading returned nonzero; check $RESULTS_DIR/<arm>/logs"
  fi
  log "collecting results…"
  echo
  ( cd "$BENCH_DIR" && INSTANCES="${INSTANCE_LIST[*]}" ARMS="${RESULT_ARM_LIST[*]}" node collect.mjs ) \
    || log "collect failed; check $RESULTS_DIR and eval reports"
  log "results csv: $RESULTS_DIR/results.csv"
fi
