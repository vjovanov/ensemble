#!/usr/bin/env bash
# Lightweight disk guard for the long base002 seed-2 stretch: reclaim docker (safe — only
# unattached objects) whenever free space on /home drops below the threshold. Exits once the
# candidate run + watcher are both gone.
set -uo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"
THRESH_G=50
LOG="multiseed/base002/DISKGUARD.log"; : > "$LOG"
say(){ echo "[diskguard $(date +%H:%M:%S)] $*" | tee -a "$LOG"; }
say "armed (threshold ${THRESH_G}G free)"
while pgrep -f 'multiseed.sh base002|base002-watch.sh' >/dev/null 2>&1; do
  free=$(df -BG --output=avail /home | tail -1 | tr -dc '0-9')
  if [ "${free:-999}" -lt "$THRESH_G" ]; then
    say "free=${free}G < ${THRESH_G}G — reclaiming docker"
    ./reclaim-docker.sh | tee -a "$LOG"
    say "after reclaim: $(df -h /home | awk 'NR==2{print $4}') free"
  fi
  sleep 180
done
say "candidate run + watcher gone — disk guard exiting"
