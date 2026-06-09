#!/usr/bin/env bash
# DF-004 experiment: does capping explore output (PI_EXPLORE_MAX_RESULT_BYTES) fix the
# simdjson/go-zero graph-bash regressions without degrading healthy graph instances?
#
# Waits for the active 20-instance run to finish, then runs a clean cap-off vs cap-on
# A/B on the two worst graph-bash cases plus two healthy controls, across both graph
# arms, snapshotting raw/ after each condition so the runs don't clobber each other.
set -uo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"

LOG="cap-experiment.log"
OUT="cap-experiment"
# worst graph-bash regressions (C/C++: simdjson, zstd, jq + small Go: go-zero) and two
# healthy graph controls (clap, logstash) to check the cap does not degrade the wins.
INSTS="simdjson__simdjson-2178,facebook__zstd-3438,jqlang__jq-2919,zeromicro__go-zero-2787,clap-rs__clap-5873,elastic__logstash-17021"
ARMS="classic-graph,classic-graph-bash"
CAP_OFF=2000000000   # effectively unbounded
CAP_ON=24576         # 24KB (the new default)

log(){ echo "[cap-exp $(date +%H:%M:%S)] $*" | tee -a "$LOG"; }

# 1. wait for the in-flight benchmarks-20 run to finish (guard: max 5h)
waited=0
while pgrep -fa "run-all.sh" | grep -q "benchmarks-20"; do
  [ "$waited" -ge 18000 ] && { log "waited 5h, proceeding anyway"; break; }
  sleep 60; waited=$((waited+60))
done
log "prior run clear; starting cap A/B (instances: $INSTS; arms: $ARMS)"

run_cond(){
  local label="$1" capbytes="$2"
  log "=== condition '$label' PI_EXPLORE_MAX_RESULT_BYTES=$capbytes ==="
  PI_EXPLORE_MAX_RESULT_BYTES="$capbytes" ./run-all.sh --instances "$INSTS" --arms "$ARMS" >>"$LOG" 2>&1
  mkdir -p "$OUT/$label"
  for i in ${INSTS//,/ }; do for a in ${ARMS//,/ }; do
    [ -d "raw/${i}__${a}" ] && cp -r "raw/${i}__${a}" "$OUT/$label/${i}__${a}"
  done; done
  log "condition '$label' done; snapshot in $OUT/$label"
}

run_cond capoff "$CAP_OFF"
run_cond capon  "$CAP_ON"

log "cap A/B DONE. Compare: $OUT/capoff vs $OUT/capon metrics.json (totalTokens, cacheRead, costUsd) + eval verdict."

# 2. once the cap experiment is fully done, run the full large benchmark across all 4 arms.
log "=== launching full large benchmark: run-hard-all, all 4 arms ==="
FORCE=1 ARMS="classic classic-bash classic-graph classic-graph-bash" ./run-hard-all.sh >>large-bench.log 2>&1
log "FULL LARGE BENCHMARK DONE (see large-bench.log + raw/)."
