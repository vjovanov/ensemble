#!/usr/bin/env bash
# Run the 28 new (never-run) instances across ALL 5 arms (4 pi arms + codex),
# after the current chain finishes. run-all grades + collects + auto-reclaims docker.
set -uo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"
LOG="new-all.log"
log(){ echo "[new-all $(date +%H:%M:%S)] $*" | tee -a "$LOG"; }
# wait for the current chain (new-benches / codex-ref / run-hard-all) to clear
waited=0
while pgrep -f "new-benches.sh|codex-ref.sh|run-hard-all.sh" >/dev/null 2>&1; do
  [ "$waited" -ge 43200 ] && { log "waited 12h, proceeding"; break; }
  sleep 120; waited=$((waited+120))
done
sleep 30
log "chain clear; running 28 new instances x 5 arms (codex + 4 pi arms)"
FORCE=1 ./run-all.sh --parallel 4 --instances "anuraghazra__github-readme-stats-2491,anuraghazra__github-readme-stats-2844,anuraghazra__github-readme-stats-3442,darkreader__darkreader-6747,expressjs__express-5555,fasterxml__jackson-databind-4615,fasterxml__jackson-databind-4641,fasterxml__jackson-dataformat-xml-644,google__gson-1787,googlecontainertools__jib-4144,grpc__grpc-go-3258,grpc__grpc-go-3351,grpc__grpc-go-3361,iamkun__dayjs-2399,iamkun__dayjs-2420,iamkun__dayjs-2532,rayon-rs__rayon-986,sharkdp__fd-1394,tokio-rs__bytes-732,vuejs__core-11625,vuejs__core-11680,vuejs__core-11694,vuejs__core-11761,vuejs__core-11813,vuejs__core-11854,zeromicro__go-zero-2363,zeromicro__go-zero-2463,zeromicro__go-zero-2537" --arms classic,classic-bash,classic-graph,classic-graph-bash,codex >>"$LOG" 2>&1   && log "DONE — graded + collected; results.csv has all 5 arm columns"   || log "run-all returned nonzero; check $LOG"
