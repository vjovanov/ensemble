#!/usr/bin/env bash
# Run every fetched instance across every arm, then collect results.
#
#   ./run-all.sh                       # all instances in bench/instances/, all ARMS
#   INSTANCES='bench/instances/foo.json bar.json' ./run-all.sh
#   ARMS='ensemble-strict classic' ./run-all.sh
#   DRY_RUN=1 ./run-all.sh             # plumbing only, no paid agent calls
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
  local inst="$1"
  for arm in "${ARM_LIST[@]}"; do
    "$BENCH_DIR/run-instance.sh" "$inst" "$arm" >"$RAW_DIR/.log_$(basename "$inst" .json)_${arm}.txt" 2>&1 \
      || log "run-instance failed for $(basename "$inst") / $arm"
  done
}

log "instances=${#INSTANCE_LIST[@]} arms=(${ARM_LIST[*]}) model=$MODEL dry_run=$DRY_RUN parallel=$PARALLEL"
active=0
for inst in "${INSTANCE_LIST[@]}"; do
  log "→ start $(basename "$inst" .json)"
  run_instance_all_arms "$inst" &
  active=$((active + 1))
  if [ "$active" -ge "$PARALLEL" ]; then
    wait -n 2>/dev/null || wait   # wait -n (bash 4.3+) frees one slot; plain wait is the fallback
    active=$((active - 1))
  fi
done
wait

log "all runs complete. Patches in $PATCH_DIR/. Next:"
log "  ./eval/run-eval.sh            # grade patches in Docker (multi_swe_bench harness)"
log "  node collect.mjs             # join metrics + resolved -> results/results.csv"
