#!/usr/bin/env bash
# Correctness loop test: run the culprit instances (uncapped, current code) + grade, signal DONE.
set -uo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"
export PI_EXPLORE_MAX_RESULT_BYTES=1073741824
LOGDIR="graphify-all-logs"; mkdir -p "$LOGDIR"
LOG="loop-test.log"; : > "$LOG"
IDS=(jqlang__jq-3238 simdjson__simdjson-2178 nushell__nushell-13870)
running=0
for id in "${IDS[@]}"; do
  ./run-instance.sh "instances/${id}.json" classic-graph-bash >"$LOGDIR/LOOP-${id}.log" 2>&1 &
  running=$((running+1)); [ "$running" -ge 3 ] && { wait -n; running=$((running-1)); }
done
wait
INST=""; for id in "${IDS[@]}"; do INST+="instances/${id}.json "; done
INSTANCES="$INST" ARMS="classic-graph-bash" ./eval/run-eval.sh >>"$LOG" 2>&1 || true
INSTANCES="$INST" ARMS="classic-graph-bash" node collect.mjs >>"$LOG" 2>&1 || true
echo "LOOP-DONE" >> "$LOG"
