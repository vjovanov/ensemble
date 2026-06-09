#!/usr/bin/env bash
set -uo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"
export PI_EXPLORE_MAX_RESULT_BYTES=1073741824
LOGDIR="graphify-all-logs"; mkdir -p "$LOGDIR"
IDS=(nushell__nushell-13870 simdjson__simdjson-2178 jqlang__jq-3238)
running=0
for id in "${IDS[@]}"; do
  ./run-instance.sh "instances/${id}.json" classic-graph-bash >"$LOGDIR/DF008-${id}.log" 2>&1 &
  running=$((running+1)); [ "$running" -ge 3 ] && { wait -n; running=$((running-1)); }
done
wait
INST=""; for id in "${IDS[@]}"; do INST+="instances/${id}.json "; done
INSTANCES="$INST" ARMS="classic-graph-bash" ./eval/run-eval.sh >>df008-validate.log 2>&1 || true
INSTANCES="$INST" ARMS="classic-graph-bash" node collect.mjs >>df008-validate.log 2>&1 || true
echo "DF008-DONE" >> df008-validate.log
