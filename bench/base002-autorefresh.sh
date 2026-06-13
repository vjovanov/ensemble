#!/usr/bin/env bash
# Keep the README in sync with base/002 results as they come in: periodically regenerate the plots
# + tables and commit/push if anything changed (refresh-results.sh is a no-op when nothing moved).
# codex auto-joins the cost graphs once its grade lands. Exits after seed-2 + codex are both done.
set -uo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"
LOG="multiseed/base002/AUTOREFRESH.log"; : > "$LOG"
say(){ echo "[autorefresh $(date +%H:%M:%S)] $*" | tee -a "$LOG"; }
say "armed; refreshing README as base/002 seed-2 + codex results land"
for i in $(seq 1 72); do            # ~6h cap at 300s/iter
  bash refresh-results.sh >>"$LOG" 2>&1 || say "refresh error (continuing)"
  ms=$(grep -c "MULTISEED-DONE base002" multiseed/base002/multiseed.log 2>/dev/null || true)
  cx=$(grep -c "CODEX-GRADE-DONE" multiseed/base002/CODEX-GRADE.log 2>/dev/null || true)
  if [ "${ms:-0}" -ge 1 ] && [ "${cx:-0}" -ge 1 ]; then
    say "seed-2 + codex both done — final refresh"
    bash refresh-results.sh >>"$LOG" 2>&1 || true
    say "AUTOREFRESH-DONE"; exit 0
  fi
  sleep 300
done
say "AUTOREFRESH-TIMEOUT (did one last refresh)"; bash refresh-results.sh >>"$LOG" 2>&1 || true
