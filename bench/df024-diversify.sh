#!/usr/bin/env bash
# DF-024 (scout): diversify the benchmark set — new/larger repos + C++ depth + Java breadth.
# Run classic + classic-graph-bash + codex × K=2 to surface interesting divergences (NOT a verdict;
# K=2 scout per §REQ-006 — winners graduate to K=3). FORCE=1 allows the large repos past MAX_REPO_MB.
# Usage: ./df024-diversify.sh
set -uo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"
N22="$(ls -d "$HOME"/.nvm/versions/node/v22*/bin 2>/dev/null | sort -V | tail -1)"
[ -n "$N22" ] && export PATH="$N22:$PATH"
export FORCE=1                                   # allow large-repo clones (the point of this scout)
export PI_EXPLORE_MAX_RESULT_BYTES=1073741824

INSTS="mui__material-ui-39962,mui__material-ui-39775,Kong__insomnia-7734,apache__dubbo-11781,cli__cli-10388,nlohmann__json-4537,nlohmann__json-4536,yhirose__cpp-httplib-1765,mockito__mockito-3220,google__gson-1787"
ARMS="classic,classic-graph-bash,codex"
K="${K:-2}"; CONC="${CONC:-3}"                   # low conc: large repos are heavy on disk/clone

LOG="multiseed/df024-diversify.setsid.log"; mkdir -p multiseed; : > "$LOG"
log(){ echo "[df024-diversify $(date +%H:%M:%S)] $*" | tee -a "$LOG"; }
log "START diversify scout: arms=$ARMS seeds=$K conc=$CONC instances=$(echo "$INSTS" | tr ',' ' ' | wc -w) (FORCE=1)"
./multiseed.sh df024-diversify --instances "$INSTS" --arms "$ARMS" --seeds "$K" --conc "$CONC" >>"$LOG" 2>&1 \
  || log "multiseed returned nonzero"
./reclaim-docker.sh >/dev/null 2>&1 || true
log "DF024-DIVERSIFY-DONE (K=$K, arms=$ARMS)"
