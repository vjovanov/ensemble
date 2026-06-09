#!/usr/bin/env bash
# Populate the classic-graphify arm across ALL benchmarks, sequenced so it runs
# AFTER new-all (which holds run-all's single run-lock) and BEFORE the DF-004.6
# cap sweep — the user wants graphify-skill results before continuing experiments.
#
# run-all only parallelizes arms-within-an-instance, so a single arm would run the
# instances sequentially (~7h). Instead we drive run-instance.sh directly at
# concurrency CONC (instance-level parallelism, no run-lock), then do ONE grade +
# collect pass. Finally we re-launch cap-higher.sh so the experiment queue resumes.
set -uo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"
LOG="graphify-all.log"
LOGDIR="graphify-all-logs"; mkdir -p "$LOGDIR"
ARM=classic-graphify
CONC="${CONC:-4}"
log(){ echo "[graphify-all $(date +%H:%M:%S)] $*" | tee -a "$LOG"; }

# 1. wait for any in-flight run-all chain (new-all / cap sweep) to release the lock
#    and finish grading, so we never race the shared eval dataset or the API.
while pgrep -f "new-all.sh|cap-higher.sh|run-all.sh|run_evaluation" >/dev/null 2>&1; do sleep 120; done
sleep 30
log "chain clear; classic-graphify on all instances (conc=$CONC)"

# 2. agent runs, instance-level parallel pool
mapfile -t INSTS < <(ls instances/*.json)
log "instances: ${#INSTS[@]}"
running=0
for inst in "${INSTS[@]}"; do
  short="$(basename "$inst" .json)"
  ./run-instance.sh "$inst" "$ARM" >"$LOGDIR/${short}.log" 2>&1 &
  running=$((running+1))
  if [ "$running" -ge "$CONC" ]; then wait -n; running=$((running-1)); fi
done
wait
log "agent runs done"

# 3. ONE grade + collect + reclaim pass for this arm
INST_PATHS="$(printf '%s ' "${INSTS[@]}")"
INSTANCES="$INST_PATHS" ARMS="$ARM" ./eval/run-eval.sh >>"$LOG" 2>&1 || log "grade returned nonzero"
INSTANCES="$INST_PATHS" ARMS="$ARM" node collect.mjs >>"$LOG" 2>&1 || log "collect returned nonzero"
./reclaim-docker.sh >/dev/null 2>&1 || true
log "classic-graphify populated across all benchmarks"

# 4. resume the experiment queue (DF-004.6 cap sweep)
log "re-launching cap-higher.sh (DF-004.6)"
setsid ./cap-higher.sh >>cap-higher.log 2>&1 < /dev/null &
log "DONE"
