#!/usr/bin/env bash
# Run every fetched instance across every arm, then grade and collect results.
#
#   ./run-all.sh                       # all instances in bench/instances/, all ARMS
#   INSTANCES='bench/instances/foo.json bar.json' ./run-all.sh
#   ARMS='ensemble-strict classic' ./run-all.sh
#   DRY_RUN=1 ./run-all.sh             # plumbing only, no paid agent calls
#
# Interactive (stdout is a TTY): shows a live spinner with the running instance(s) and
# their current phase, prints a summary line as each instance completes, and the full
# results table at the end. Redirected/detached: plain log lines (no spinner).
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

run_instance_all_arms() {
  local inst="$1" short; short="$(basename "$inst" .json)"
  for arm in "${ARM_LIST[@]}"; do
    printf '%s' "$arm" > "$RAW_DIR/.status_$short" 2>/dev/null || true   # current arm (for the spinner)
    "$BENCH_DIR/run-instance.sh" "$inst" "$arm" >"$RAW_DIR/.log_${short}_${arm}.txt" 2>&1 \
      || echo "[bench] run-instance failed for $short / $arm" >&2
  done
  rm -f "$RAW_DIR/.status_$short"
}

# One-line per-instance summary once both arms are done (tokens/cost/turns per arm).
instance_summary() {
  node -e '
    const fs=require("fs"); const dir=process.argv[1], id=process.argv[2], arms=process.argv.slice(3);
    const lbl=a=>a==="ensemble-strict"?"graph":a;
    const parts=arms.map(a=>{const p=`${dir}/${id}__${a}/metrics.json`;if(!fs.existsSync(p))return `${lbl(a)}: -`;
      const m=JSON.parse(fs.readFileSync(p,"utf8"));
      return `${lbl(a)} ${(m.totalTokens||0).toLocaleString()}tok $${(m.costUsd||0).toFixed(3)} ${m.assistantTurns||0}t`;});
    console.log(`  \x1b[32m✓\x1b[0m ${id}   ${parts.join("   |   ")}`);
  ' "$RAW_DIR" "$1" "${ARM_LIST[@]}"
}

total=${#INSTANCE_LIST[@]}
runs_total=$((total * ${#ARM_LIST[@]}))
FRAMES=(⠋ ⠙ ⠹ ⠸ ⠼ ⠴ ⠦ ⠧ ⠇ ⠏); spin=0
TTY=0; [ -t 1 ] && TTY=1

log "instances=$total arms=(${ARM_LIST[*]}) model=$MODEL parallel=$PARALLEL dry_run=$DRY_RUN"
declare -A running   # pid -> instance short name
idx=0; active=0      # `active` counter avoids ${#running[@]} on an empty array under set -u

while [ "$idx" -lt "$total" ] || [ "$active" -gt 0 ]; do
  # fill free slots up to PARALLEL
  while [ "$active" -lt "$PARALLEL" ] && [ "$idx" -lt "$total" ]; do
    inst="${INSTANCE_LIST[$idx]}"; short="$(basename "$inst" .json)"
    run_instance_all_arms "$inst" & running[$!]="$short"
    active=$((active + 1)); idx=$((idx + 1))
    [ "$TTY" = 1 ] || log "→ start $short"
  done
  # reap finished instances and print their summary
  if [ "$active" -gt 0 ]; then
    for pid in "${!running[@]}"; do
      if ! kill -0 "$pid" 2>/dev/null; then
        short="${running[$pid]}"; unset 'running[$pid]'; active=$((active - 1))
        [ "$TTY" = 1 ] && printf '\r\033[K'      # erase spinner before the summary line
        instance_summary "$short"
      fi
    done
  fi
  # animate (TTY only): spinner + each running instance's current phase
  if [ "$TTY" = 1 ]; then
    frame="${FRAMES[$((spin % 10))]}"; spin=$((spin + 1))
    rs=""
    if [ "$active" -gt 0 ]; then
      for pid in "${!running[@]}"; do
        short="${running[$pid]}"; arm="$(cat "$RAW_DIR/.status_$short" 2>/dev/null || true)"
        al=$([ "$arm" = "ensemble-strict" ] && echo graph || echo "${arm:-…}")
        phase="$(tail -n1 "$RAW_DIR/.log_${short}_${arm}.txt" 2>/dev/null | sed -E 's/\x1b\[[0-9;]*m//g; s/^\[bench\][[:space:]]*//' | tr -d '\r' | cut -c1-38)"
        rs="$rs   \033[1m${short##*__}\033[0m/${al}: ${phase}"
      done
    fi
    done_runs=$(ls "$RAW_DIR"/*/metrics.json 2>/dev/null | xargs -r grep -l costUsd 2>/dev/null | wc -l)
    printf "\r\033[K\033[36m%s\033[0m  %s/%s runs ·${rs:-   (starting)} " "$frame" "$done_runs" "$runs_total"
  fi
  sleep 0.3
done
wait 2>/dev/null
[ "$TTY" = 1 ] && printf '\r\033[K'

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
