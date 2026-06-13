#!/usr/bin/env bash
# Watchdog for the df022 Qwen cascade: kill any running instance that is spinning
# in the explore loop (same source_slice/search target repeated >= THRESH times),
# instead of waiting for the 1200s agent cap. A SIGKILL -> rc=137 -> the cascade
# ejects it. Healthy explorations stay well under THRESH (<20); loopers hit 90-600.
# Exits when the cascade driver is gone.
set -uo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"
THRESH="${LOOP_THRESH:-60}"
LOG="multiseed/df022-graph-bash-sidekicks/df022-loop-killer.log"
log(){ echo "[loop-killer $(date +%H:%M:%S)] $*" | tee -a "$LOG"; }
log "START thresh=$THRESH"

while pgrep -f "df022-qwen-cascade.sh" >/dev/null 2>&1; do
  # for each running instance, compute the max single-target repeat from its live debug log
  while read -r id; do
    [ -z "$id" ] && continue
    f="raw/${id}__graph-bash/explore-debug.jsonl"
    [ -f "$f" ] || continue
    rep=$(python3 - "$f" <<'PY'
import json,sys,collections
t=collections.Counter()
for ln in open(sys.argv[1]):
    try:d=json.loads(ln)
    except:continue
    if d.get("phase")=="start" and d.get("tool"):
        a=d.get("args",{}) or {}
        t[d["tool"]+":"+str(list(a.values())[0] if a else "")[:40]]+=1
print(t.most_common(1)[0][1] if t else 0)
PY
)
    if [ "${rep:-0}" -ge "$THRESH" ]; then
      pgid=$(pgrep -f "timeout .*run-instance.sh instances/${id}.json" | head -1)
      [ -z "$pgid" ] && continue
      log "KILL $id (maxRepeat=$rep) pgid=$pgid"
      kill -TERM -- "-$pgid" 2>/dev/null
      pkill -f "graphify watch.*work/${id}/graph-bash" 2>/dev/null
      sleep 1
      kill -KILL -- "-$pgid" 2>/dev/null || true
    fi
  done < <(pgrep -af "run-instance.sh.*graph-bash" | grep -oE 'instances/[^ ]+\.json' | sed 's#instances/##;s#\.json##' | sort -u)
  sleep 45
done
log "cascade gone; loop-killer exiting"
