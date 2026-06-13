#!/usr/bin/env bash
# Add a third seed for classic + classic-graph-bash on the base/002 set: run fresh, grade, snapshot
# to multiseed/base002/s3 (s1/s2 preserved), then refresh the README. graphify keeps 2 seeds; the
# per-run framing handles the uneven seed counts.
set -uo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"
export PI_EXPLORE_MAX_RESULT_BYTES=1073741824   # uncapped explore (matches multiseed)
ARMS="classic classic-graph-bash"
OUT="multiseed/base002"; CONC="${CONC:-5}"
LOG="$OUT/SEED3.log"; : > "$LOG"
log(){ echo "[seed3 $(date +%H:%M:%S)] $*" | tee -a "$LOG"; }
mapfile -t IDS < base002-ids.txt
log "running seed 3 for [$ARMS] on ${#IDS[@]} instances (conc=$CONC)"
running=0
for id in "${IDS[@]}"; do [ -z "$id" ] && continue; for arm in $ARMS; do
  ./run-instance.sh "instances/${id}.json" "$arm" >"graphify-all-logs/S3-${id}__${arm}.log" 2>&1 &
  running=$((running+1)); [ "$running" -ge "$CONC" ] && { wait -n; running=$((running-1)); }
done; done
wait
log "runs done; reclaiming docker before grade"
./reclaim-docker.sh >>"$LOG" 2>&1 || true
INST_PATHS=""; for id in "${IDS[@]}"; do [ -z "$id" ] && continue; INST_PATHS+="instances/${id}.json "; done
log "grading seed 3"
INSTANCES="$INST_PATHS" ARMS="$ARMS" ./eval/run-eval.sh >>"$LOG" 2>&1 || log "grade nonzero"
log "snapshotting -> $OUT/s3"
for id in "${IDS[@]}"; do [ -z "$id" ] && continue; for arm in $ARMS; do
  sd="$OUT/s3/${id}__${arm}"; mkdir -p "$sd"
  for f in metrics.json patch.diff manifest.json; do [ -f "raw/${id}__${arm}/$f" ] && cp "raw/${id}__${arm}/$f" "$sd/"; done
  v="results/validation/${arm}/${id}.json"; [ -f "$v" ] && { mkdir -p "$OUT/s3/validation/${arm}"; cp "$v" "$OUT/s3/validation/${arm}/"; }
done; done
./reclaim-docker.sh >>"$LOG" 2>&1 || true
log "refreshing README (3 seeds for classic + graph-bash)"
bash refresh-results.sh >>"$LOG" 2>&1 || log "refresh error"
log "SEED3-DONE"
