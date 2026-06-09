#!/usr/bin/env bash
# Multi-seed run of a scoped set: K passes of (run + grade + lightweight snapshot). §REQ-005-research-checkpoints.0
# Usage: ./multiseed.sh <run-name> --instances id1,id2 --arms classic,classic-graph-bash [--seeds 3] [--conc 5]
# Results -> bench/multiseed/<run-name>/s<k>/<id>__<arm>/{metrics,patch,manifest} + s<k>/validation/.
set -uo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"
NAME="${1:?usage: multiseed.sh <run-name> --instances ... --arms ...}"; shift
INSTS=""; ARMS_IN=""; K=3; CONC=5; REUSE_ARMS=""
while [ $# -gt 0 ]; do case "$1" in
  --instances) INSTS="${2//,/ }"; shift 2;;
  --arms) ARMS_IN="${2//,/ }"; shift 2;;
  --seeds) K="$2"; shift 2;;
  --conc) CONC="$2"; shift 2;;
  --reuse) REUSE_ARMS=" ${2//,/ } "; shift 2;;  # arms whose existing raw/ counts as seed 1 (must be current code)
  *) echo "unknown arg: $1"; exit 1;;
esac; done
[ -n "$INSTS" ] && [ -n "$ARMS_IN" ] || { echo "need --instances and --arms"; exit 1; }
export PI_EXPLORE_MAX_RESULT_BYTES=1073741824   # uncapped — DF-004 cap not adopted
OUT="multiseed/$NAME"; mkdir -p "$OUT" graphify-all-logs
LOG="$OUT/multiseed.log"; : > "$LOG"
log(){ echo "[multiseed $(date +%H:%M:%S)] $*" | tee -a "$LOG"; }

while pgrep -f "run_evaluation|graphbash-rerun.sh|loop-test.sh" >/dev/null 2>&1; do sleep 60; done
for k in $(seq 1 "$K"); do
  log "=== seed $k/$K ($NAME) ==="
  running=0
  for id in $INSTS; do for arm in $ARMS_IN; do
    # seed 1 for a --reuse arm: keep the existing raw/ run (it IS a seed); still graded + snapshot below.
    if [ "$k" = "1" ] && [[ "$REUSE_ARMS" == *" $arm "* ]] && [ -f "raw/${id}__${arm}/patch.jsonl" ]; then
      continue
    fi
    ./run-instance.sh "instances/${id}.json" "$arm" >"graphify-all-logs/MS-${NAME}-s${k}-${id}__${arm}.log" 2>&1 &
    running=$((running+1)); [ "$running" -ge "$CONC" ] && { wait -n; running=$((running-1)); }
  done; done
  wait
  [ "$k" = "1" ] && [ -n "$REUSE_ARMS" ] && log "seed 1 reused existing raw for arms:$REUSE_ARMS"
  INST_PATHS=""; for id in $INSTS; do INST_PATHS+="instances/${id}.json "; done
  INSTANCES="$INST_PATHS" ARMS="$ARMS_IN" ./eval/run-eval.sh >>"$LOG" 2>&1 || log "grade nonzero (seed $k)"
  for id in $INSTS; do for arm in $ARMS_IN; do
    sd="$OUT/s${k}/${id}__${arm}"; mkdir -p "$sd"
    for f in metrics.json patch.diff manifest.json; do [ -f "raw/${id}__${arm}/$f" ] && cp "raw/${id}__${arm}/$f" "$sd/"; done
    v="results/validation/${arm}/${id}.json"; [ -f "$v" ] && { mkdir -p "$OUT/s${k}/validation/${arm}"; cp "$v" "$OUT/s${k}/validation/${arm}/"; }
  done; done
  log "seed $k snapshot -> $OUT/s${k}"
done
./reclaim-docker.sh >/dev/null 2>&1 || true
node lib/multiseed-report.mjs "$OUT" >>"$LOG" 2>&1 || true
log "MULTISEED-DONE $NAME (K=$K)"
