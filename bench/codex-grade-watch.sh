#!/usr/bin/env bash
# After the instrumented codex re-run finishes, grade the fresh codex patches on the 30 base002
# instances (docker eval) so codex has up-to-date resolved verdicts to match its new cost metrics.
set -uo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"
LOG="multiseed/base002/CODEX-GRADE.log"; : > "$LOG"
say(){ echo "[codex-grade $(date +%H:%M:%S)] $*" | tee -a "$LOG"; }
say "waiting for CODEX-RERUN-DONE…"
while ! grep -q "CODEX-RERUN-DONE" multiseed/base002/CODEX-RERUN.log 2>/dev/null; do sleep 60; done
say "re-run done; grading codex on 30 instances"
IP=""; for id in $(cat base002-ids.txt); do IP+="instances/${id}.json "; done
INSTANCES="$IP" ARMS=codex ./eval/run-eval.sh >>"$LOG" 2>&1 || say "grade nonzero"
r=0; for id in $(cat base002-ids.txt); do f=results/validation/codex/$id.json; [ -f "$f" ] && grep -q '"resolved": true' "$f" && r=$((r+1)); done
say "CODEX-GRADE-DONE: codex resolved $r/30"
./reclaim-docker.sh >>"$LOG" 2>&1 || true