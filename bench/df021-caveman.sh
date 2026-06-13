#!/usr/bin/env bash
# DF-021: caveman classic primitive levels. Run the classic-caveman arm at L1/L2/L3 x K seeds on
# the scoped retry-heavy + control + JS/TS-wide-read set, vs the frozen classic (L0) base.
# Each level is its own multiseed run (run -> grade -> snapshot per seed). §DF-021.
# Usage: ./df021-caveman.sh
set -uo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"
# the agent needs Node >= 22.19.0; default PATH may be Node 20
N22="$(ls -d "$HOME"/.nvm/versions/node/v22*/bin 2>/dev/null | sort -V | tail -1)"
[ -n "$N22" ] && export PATH="$N22:$PATH"

# scoped set (§DF-021 §3): retry-heavy (read-replay largest) + controls + JS/TS wide-read wins
INSTS="grpc__grpc-go-3258,simdjson__simdjson-2178,iamkun__dayjs-2532,iamkun__dayjs-2399,clap-rs__clap-5873,expressjs__express-5555,sveltejs__svelte-15115,vuejs__core-11694,darkreader__darkreader-7241"
K="${K:-3}"; CONC="${CONC:-5}"
LOG="multiseed/df021-caveman.setsid.log"; mkdir -p multiseed; : > "$LOG"
log(){ echo "[df021-caveman $(date +%H:%M:%S)] $*" | tee -a "$LOG"; }

declare -A LV=( [l1]=level1-trimmed [l2]=level2-caveman [l3]=level3-stone-tool )
log "START caveman ladder: levels l1,l2,l3  seeds=$K conc=$CONC  instances=$(echo "$INSTS" | tr ',' ' ' | wc -w)"
for lvl in l1 l2 l3; do
  export CAVEMAN_SKILL="$PWD/skills/caveman/${LV[$lvl]}.md"
  [ -f "$CAVEMAN_SKILL" ] || { log "FATAL: missing $CAVEMAN_SKILL"; exit 1; }
  log "=== LEVEL $lvl  ($CAVEMAN_SKILL) ==="
  ./multiseed.sh "df021-caveman-$lvl" --instances "$INSTS" --arms classic-caveman --seeds "$K" --conc "$CONC" \
    >>"$LOG" 2>&1 || log "multiseed returned nonzero ($lvl)"
  log "level $lvl done -> multiseed/df021-caveman-$lvl"
done
./reclaim-docker.sh >/dev/null 2>&1 || true
log "DF021-CAVEMAN-DONE (L1/L2/L3 x K=$K)"
