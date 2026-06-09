#!/usr/bin/env bash
# Reference run: OpenAI Codex (cdx) as a one-time external baseline on ALL fetched
# benchmark instances, graded by the same Docker harness (arm = codex). Codex is an
# orientation reference only (its own agent + model, no pi token metrics) per
# §GRUND-002-benchmark-comparison-methodology — we read its resolved verdict.
#
# Runs AFTER the cap-experiment chain (cap A/B + run-hard-all) so there is never a
# concurrent agent. Sequential (no parallel) to keep it simple and resource-light.
set -uo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"
LOG="codex-ref.log"
log(){ echo "[codex-ref $(date +%H:%M:%S)] $*" | tee -a "$LOG"; }

# 1. wait for the cap-experiment chain to fully finish (guard: 12h)
waited=0
while pgrep -f cap-experiment.sh >/dev/null 2>&1; do
  [ "$waited" -ge 43200 ] && { log "waited 12h, proceeding"; break; }
  sleep 120; waited=$((waited+120))
done
sleep 30  # grace for trailing grading/collection
log "chain clear; starting codex reference run"

# 2. ALL fetched benchmark instances
PATHS=()
for p in instances/*.json; do
  [ -f "$p" ] && PATHS+=("$p")
done
log "codex on ${#PATHS[@]} instances (all fetched)"

# 3. run codex per instance (sequential)
for p in "${PATHS[@]}"; do
  log "codex: $p"
  ./run-instance-codex.sh "$p" codex >>"$LOG" 2>&1 || log "  run-instance-codex failed for $p"
done

# 4. grade + collect (arm-agnostic; reads raw/*__codex/patch.jsonl)
log "grading codex…"
INSTANCES="${PATHS[*]}" ARMS=codex ./eval/run-eval.sh >>"$LOG" 2>&1 || log "run-eval failed"
INSTANCES="${PATHS[*]}" ARMS=codex node collect.mjs >>"$LOG" 2>&1 || log "collect failed (resolved still in results/codex/final_report.json)"
log "DONE. codex reference verdicts: results/codex/final_report.json + results.csv (arm=codex)."
