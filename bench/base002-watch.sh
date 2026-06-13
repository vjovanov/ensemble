#!/usr/bin/env bash
# Single orchestration watcher for base/002-30 (§REQ-005-research-checkpoints).
# 1. Wait for the candidate run (classic, classic-graph-bash, classic-graphify × 2 seeds) to finish.
# 2. Grading round for the reused arms (classic-bash, classic-graph, codex) — all 30 already have
#    runs, so --reuse makes this pure grade+snapshot into the same multiseed dir.
# 3. Freeze base/002-30 from the 6-arm multiseed snapshot.
set -uo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"
NAME=base002
LOG="multiseed/$NAME/multiseed.log"
W="multiseed/$NAME/WATCH.log"; : > "$W"
say(){ echo "[base002-watch $(date +%H:%M:%S)] $*" | tee -a "$W"; }
IDS=$(tr '\n' ',' < base002-ids.txt | sed 's/,$//')

say "waiting for candidate run MULTISEED-DONE ($NAME)…"
while ! grep -q "MULTISEED-DONE $NAME" "$LOG" 2>/dev/null; do sleep 60; done
say "candidate run done. reclaiming docker."
./reclaim-docker.sh | tee -a "$W"

say "grading round: classic-bash,classic-graph,codex (--seeds 1 --reuse, pure grade)"
./multiseed.sh "$NAME" --instances "$IDS" \
  --arms classic-bash,classic-graph,codex --seeds 1 \
  --reuse classic-bash,classic-graph,codex --conc 5 2>&1 | tee -a "$W"
say "grading round done. reclaiming docker."
./reclaim-docker.sh | tee -a "$W"

say "freezing checkpoint base002-30"
./checkpoint.sh base002-30 --from "multiseed/$NAME" 2>&1 | tee -a "$W"
say "BASE002-COMPLETE"
