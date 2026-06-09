#!/usr/bin/env bash
# 4-arm run on the 6 newly-fetched large non-C/C++ benches, after the whole current
# chain (cap A/B -> run-hard-all -> codex) finishes — no concurrent agents.
# Grows non-C/C++ coverage where graphify is strong (§REQ-004 related-bench set).
set -uo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"
LOG="new-benches.log"
log(){ echo "[new-benches $(date +%H:%M:%S)] $*" | tee -a "$LOG"; }

INSTS="alibaba__fastjson2-2775,mockito__mockito-3424,mui__material-ui-39962,Kong__insomnia-7734,BurntSushi__ripgrep-2626,sharkdp__bat-3189"

# wait for the codex stage (last in the current chain) to finish (guard 16h)
waited=0
while pgrep -f codex-ref.sh >/dev/null 2>&1; do
  [ "$waited" -ge 57600 ] && { log "waited 16h, proceeding"; break; }
  sleep 120; waited=$((waited+120))
done
sleep 30
log "chain clear; running 6 new benches x 4 arms"

# FORCE=1: material-ui is over the MAX_REPO_MB clone guard
FORCE=1 ./run-all.sh --instances "$INSTS" --arms classic,classic-bash,classic-graph,classic-graph-bash >>"$LOG" 2>&1 \
  && log "DONE — results graded + collected (arm columns in results.csv)" \
  || log "run-all returned nonzero; check $LOG"
