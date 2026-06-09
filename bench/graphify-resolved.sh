#!/usr/bin/env bash
# Run classic-graphify (HARD directive) on the 11 instances classic resolved, so the
# comparison is on real fixes (REQ-002). Instance-parallel via run-instance.sh, then one
# grade + collect pass for this arm. Nothing else should be running (run after the chain).
set -uo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"
LOG="graphify-resolved.log"; LOGDIR="graphify-all-logs"; mkdir -p "$LOGDIR"
ARM=classic-graphify; CONC="${CONC:-4}"
log(){ echo "[graphify-resolved $(date +%H:%M:%S)] $*" | tee -a "$LOG"; }

# classic-resolved set (from results/validation/classic, resolved=true)
IDS=(clap-rs__clap-5873 darkreader__darkreader-7241 facebook__zstd-3438 facebook__zstd-3942 \
     jqlang__jq-2919 jqlang__jq-3238 nushell__nushell-13870 sharkdp__bat-3189 \
     simdjson__simdjson-2178 tokio-rs__tracing-2897 zeromicro__go-zero-2787)

# safety: don't race an in-flight run-all chain
while pgrep -f "new-all.sh|cap-higher.sh|run-all.sh|run_evaluation|graphify-all.sh" >/dev/null 2>&1; do sleep 60; done
log "starting classic-graphify (hard directive) on ${#IDS[@]} classic-resolved instances (conc=$CONC)"

running=0
for id in "${IDS[@]}"; do
  ./run-instance.sh "instances/${id}.json" "$ARM" >"$LOGDIR/RES-${id}.log" 2>&1 &
  running=$((running+1))
  if [ "$running" -ge "$CONC" ]; then wait -n; running=$((running-1)); fi
done
wait
log "agent runs done; grading"

INST_PATHS=""; for id in "${IDS[@]}"; do INST_PATHS+="instances/${id}.json "; done
INSTANCES="$INST_PATHS" ARMS="$ARM" ./eval/run-eval.sh >>"$LOG" 2>&1 || log "grade nonzero"
INSTANCES="$INST_PATHS" ARMS="$ARM" node collect.mjs >>"$LOG" 2>&1 || log "collect nonzero"
./reclaim-docker.sh >/dev/null 2>&1 || true
log "DONE — classic-graphify (hard directive) on classic-resolved set"
