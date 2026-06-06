#!/usr/bin/env bash
# Run every fetched instance across every arm, then grade and collect results.
#
#   ./run-all.sh                       # all instances in bench/instances/, all ARMS
#   INSTANCES='bench/instances/foo.json bar.json' ./run-all.sh
#   ARMS='ensemble-strict classic' ./run-all.sh
#   DRY_RUN=1 ./run-all.sh             # plumbing only, no paid agent calls
#
# Prints each instance/arm as it starts and finishes. Each instance runs its
# arms together up to PARALLEL, joins them, then prints a side-by-side summary.
source "$(dirname "${BASH_SOURCE[0]}")/config.sh"

# Instance set: explicit $INSTANCES, else everything under bench/instances/.
if [ -n "${INSTANCES:-}" ]; then
  read -r -a INSTANCE_LIST <<< "$INSTANCES"
else
  INSTANCE_LIST=("$INST_DIR"/*.json)
fi
[ -e "${INSTANCE_LIST[0]}" ] || die "no instances found. Run: node fetch-instances.mjs <lang> <index>"

read -r -a ARM_LIST <<< "$ARMS"

# PARALLEL = how many arms of the same instance to run concurrently (default 1).
# Instances run sequentially so each joined comparison is for the same benchmark.
: "${PARALLEL:=1}"
: "${PROGRESS_INTERVAL:=30}"

declare -A running   # pid -> instance/arm label
PROGRESS_PID=""

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

trap 'trap - EXIT; cleanup_children; exit 130' INT
trap 'trap - EXIT; cleanup_children; exit 143' TERM
trap 'rc=$?; if [ "$rc" -ne 0 ]; then cleanup_children; fi' EXIT

start_progress_reporter() {
  local short="$1" started_at
  started_at="$(node -e 'console.log(Date.now())')"
  (
    while true; do
      node "$BENCH_DIR/lib/run-progress.mjs" \
        --raw-dir "$RAW_DIR" \
        --id "$short" \
        --arms "${ARM_LIST[*]}" \
        --started-at "$started_at" \
        --timeout "$AGENT_TIMEOUT" || true
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
    const metrics = new Map(arms.map((a) => {
      const p=`${dir}/${id}__${a}/metrics.json`;
      return [a, fs.existsSync(p) ? JSON.parse(fs.readFileSync(p,"utf8")) : null];
    }));
    const parts=arms.map((a) => {
      const m=metrics.get(a);
      if (!m) return `${lbl(a)}: -`;
      return `${lbl(a)} ${(m.totalTokens||0).toLocaleString()}tok $${(m.costUsd||0).toFixed(3)} ${m.assistantTurns||0}t`;
    });
    const baselineArm = arms.includes("classic") ? "classic" : arms[0];
    const candidateArm = arms.find((a) => a !== baselineArm && metrics.get(a));
    const baseline = metrics.get(baselineArm);
    const candidate = candidateArm ? metrics.get(candidateArm) : null;
    let cmp = "";
    if (baseline && candidate) {
      const dt = (candidate.totalTokens || 0) - (baseline.totalTokens || 0);
      const dc = (candidate.costUsd || 0) - (baseline.costUsd || 0);
      const turns = (candidate.assistantTurns || 0) - (baseline.assistantTurns || 0);
      const sign = (n) => n > 0 ? "+" : "";
      cmp = `   |   ${lbl(candidateArm)} vs ${lbl(baselineArm)}: ${sign(dt)}${dt.toLocaleString()}tok ${sign(dc)}$${dc.toFixed(3)} ${sign(turns)}${turns}t`;
    }
    console.log(`  ${status === "0" ? "OK" : "FAIL"} ${id}   ${parts.join("   |   ")}${cmp}`);
  ' "$RAW_DIR" "$1" "$status" "${ARM_LIST[@]}"
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

total=${#INSTANCE_LIST[@]}
runs_total=$((total * ${#ARM_LIST[@]}))

log "instances=$total arms=(${ARM_LIST[*]}) model=$MODEL parallel=$PARALLEL dry_run=$DRY_RUN"
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

if [ "$failures" -ne 0 ]; then
  die "$failures instance job(s) failed; skipping grading"
fi

if [ "$DRY_RUN" = "1" ]; then
  log "all dry-run plumbing complete. Patches in $PATCH_DIR/."
  log "skipping Docker grading because DRY_RUN=1"
else
  log "all runs complete. Grading patches in Docker…"
  INSTANCES="${INSTANCE_LIST[*]}" "$BENCH_DIR/eval/run-eval.sh" \
    || log "Docker grading returned nonzero; check $RESULTS_DIR/<arm>/logs"
  log "collecting results…"
  echo
  ( cd "$BENCH_DIR" && INSTANCES="${INSTANCE_LIST[*]}" node collect.mjs ) \
    || log "collect failed; check $RESULTS_DIR and eval reports"
  log "results csv: $RESULTS_DIR/results.csv"
fi
