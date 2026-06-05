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

# Per-(instance,arm) patch records are written to raw/<id>__<arm>/patch.jsonl by
# run-instance.sh; eval/run-eval.sh assembles them into per-arm jsonls at grade time.
log "instances=${#INSTANCE_LIST[@]} arms=(${ARM_LIST[*]}) model=$MODEL dry_run=$DRY_RUN"
for inst in "${INSTANCE_LIST[@]}"; do
  for arm in "${ARM_LIST[@]}"; do
    "$BENCH_DIR/run-instance.sh" "$inst" "$arm" || log "run-instance failed for $inst / $arm"
  done
done

log "all runs complete. Patches in $PATCH_DIR/. Next:"
log "  ./eval/run-eval.sh            # grade patches in Docker (multi_swe_bench harness)"
log "  node collect.mjs             # join metrics + resolved -> results/results.csv"
