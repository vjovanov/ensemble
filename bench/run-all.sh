#!/usr/bin/env bash
# Run every fetched instance across every arm, then grade and collect results.
#
#   ./run-all.sh                       # all instances in bench/instances/, all ARMS
#   INSTANCES='bench/instances/foo.json bar.json' ./run-all.sh
#   ARMS='ensemble-strict classic' ./run-all.sh
#   DRY_RUN=1 ./run-all.sh             # plumbing only, no paid agent calls
#
# Prints each instance/arm as it starts and finishes. Runs block until every
# child process exits, then grading and collection run in the same foreground job.
source "$(dirname "${BASH_SOURCE[0]}")/config.sh"

# Instance set: explicit $INSTANCES, else everything under bench/instances/.
if [ -n "${INSTANCES:-}" ]; then
  read -r -a INSTANCE_LIST <<< "$INSTANCES"
else
  INSTANCE_LIST=("$INST_DIR"/*.json)
fi
[ -e "${INSTANCE_LIST[0]}" ] || die "no instances found. Run: node fetch-instances.mjs <lang> <index>"

read -r -a ARM_LIST <<< "$ARMS"

# PARALLEL = how many instances to run concurrently (default 1). Parallelism is per-instance,
# not per-arm: an instance's arms run sequentially so they share its one pristine clone without
# racing. Each instance writes only its own raw/<id>__<arm>/ dirs, so instances never collide.
: "${PARALLEL:=1}"

declare -A running   # pid -> instance short name

cleanup_children() {
  local pids=("${!running[@]}")
  [ "${#pids[@]}" -gt 0 ] || return 0
  log "terminating ${#pids[@]} active instance job(s)…"
  kill "${pids[@]}" 2>/dev/null || true
  wait "${pids[@]}" 2>/dev/null || true
}

trap 'cleanup_children; exit 130' INT
trap 'cleanup_children; exit 143' TERM
trap 'rc=$?; if [ "$rc" -ne 0 ]; then cleanup_children; fi' EXIT

run_instance_all_arms() {
  local inst="$1" short rc arm_log
  short="$(basename "$inst" .json)"
  rc=0
  for arm in "${ARM_LIST[@]}"; do
    printf '%s' "$arm" > "$RAW_DIR/.status_$short" 2>/dev/null || true
    arm_log="$RAW_DIR/.log_${short}_${arm}.txt"
    log "run $short / $arm (log: $arm_log)"
    if "$BENCH_DIR/run-instance.sh" "$inst" "$arm" >"$arm_log" 2>&1; then
      log "done $short / $arm"
    else
      log "FAILED $short / $arm (log: $arm_log)"
      rc=1
    fi
  done
  rm -f "$RAW_DIR/.status_$short"
  return "$rc"
}

# One-line per-instance summary once both arms are done (tokens/cost/turns per arm).
instance_summary() {
  local status="$2"
  node -e '
    const fs=require("fs"); const [dir,id,status,...arms]=process.argv.slice(1);
    const lbl=a=>a==="ensemble-strict"?"graph":a;
    const parts=arms.map(a=>{const p=`${dir}/${id}__${a}/metrics.json`;if(!fs.existsSync(p))return `${lbl(a)}: -`;
      const m=JSON.parse(fs.readFileSync(p,"utf8"));
      return `${lbl(a)} ${(m.totalTokens||0).toLocaleString()}tok $${(m.costUsd||0).toFixed(3)} ${m.assistantTurns||0}t`;});
    console.log(`  ${status === "0" ? "OK" : "FAIL"} ${id}   ${parts.join("   |   ")}`);
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
idx=0; active=0      # `active` counter avoids ${#running[@]} on an empty array under set -u
failures=0

while [ "$idx" -lt "$total" ] || [ "$active" -gt 0 ]; do
  # fill free slots up to PARALLEL
  while [ "$active" -lt "$PARALLEL" ] && [ "$idx" -lt "$total" ]; do
    inst="${INSTANCE_LIST[$idx]}"; short="$(basename "$inst" .json)"
    run_instance_all_arms "$inst" & running[$!]="$short"
    active=$((active + 1)); idx=$((idx + 1))
    log "started $short ($idx/$total)"
  done

  # Block until one active instance job exits, then print its summary.
  if [ "$active" -gt 0 ]; then
    done_pid=""
    if wait -n -p done_pid "${!running[@]}"; then
      rc=0
    else
      rc=$?
    fi
    short="${running[$done_pid]:-unknown}"
    unset 'running[$done_pid]'
    active=$((active - 1))
    instance_summary "$short" "$rc"
    if [ "$rc" -ne 0 ]; then
      failures=$((failures + 1))
      log "instance job failed: $short (rc=$rc)"
    fi
    done_runs="$(metrics_count)"
    log "progress: $done_runs/$runs_total runs have metrics"
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
