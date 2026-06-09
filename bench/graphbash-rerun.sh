#!/usr/bin/env bash
# Re-run classic-graph-bash UNCAPPED (PI_EXPLORE_MAX_RESULT_BYTES huge) on the 11 classic-resolved
# instances at current code, so the headline candidate is one consistent run (matching DF-004's
# "no cap" conclusion). Instance-parallel; then one grade+collect; then refresh raw-canonical.
set -uo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"
LOG="graphbash-rerun.log"; LOGDIR="graphify-all-logs"; mkdir -p "$LOGDIR"
ARM=classic-graph-bash; CONC="${CONC:-4}"
export PI_EXPLORE_MAX_RESULT_BYTES=1073741824   # 1 GB == uncapped (>0 required; no off-sentinel)
log(){ echo "[gb-rerun $(date +%H:%M:%S)] $*" | tee -a "$LOG"; }

IDS=(clap-rs__clap-5873 darkreader__darkreader-7241 facebook__zstd-3438 facebook__zstd-3942 \
     jqlang__jq-2919 jqlang__jq-3238 nushell__nushell-13870 sharkdp__bat-3189 \
     simdjson__simdjson-2178 tokio-rs__tracing-2897 zeromicro__go-zero-2787)

while pgrep -f "new-all.sh|cap-higher.sh|run-all.sh|run_evaluation|graphify-resolved.sh" >/dev/null 2>&1; do sleep 60; done
log "starting classic-graph-bash UNCAPPED on ${#IDS[@]} instances (conc=$CONC)"

running=0
for id in "${IDS[@]}"; do
  ./run-instance.sh "instances/${id}.json" "$ARM" >"$LOGDIR/GBRERUN-${id}.log" 2>&1 &
  running=$((running+1)); [ "$running" -ge "$CONC" ] && { wait -n; running=$((running-1)); }
done
wait
log "agent runs done; grading"

INST_PATHS=""; for id in "${IDS[@]}"; do INST_PATHS+="instances/${id}.json "; done
INSTANCES="$INST_PATHS" ARMS="$ARM" ./eval/run-eval.sh >>"$LOG" 2>&1 || log "grade nonzero"
INSTANCES="$INST_PATHS" ARMS="$ARM" node collect.mjs >>"$LOG" 2>&1 || log "collect nonzero"
# refresh the immutable canonical snapshot for these instances (now current-code, uncapped)
for id in "${IDS[@]}"; do [ -d "raw/${id}__${ARM}" ] && { rm -rf "raw-canonical/${id}__${ARM}"; cp -a "raw/${id}__${ARM}" "raw-canonical/${id}__${ARM}"; }; done
./reclaim-docker.sh >/dev/null 2>&1 || true
log "DONE — classic-graph-bash uncapped, current code, on classic-resolved set"
