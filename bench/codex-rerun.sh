#!/usr/bin/env bash
# Re-run the codex reference arm on the base002 instances with the instrumented runner
# (cdx --json), so codex gets real token/cost metrics. Gentle concurrency so it doesn't
# fight the in-flight seed-2 candidate run. The base002 watcher's grading round (--reuse codex)
# then grades + snapshots these fresh patches into the seed snapshot.
set -uo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"
CONC="${CONC:-2}"
LOG="multiseed/base002/CODEX-RERUN.log"; : > "$LOG"
say(){ echo "[codex-rerun $(date +%H:%M:%S)] $*" | tee -a "$LOG"; }
mapfile -t IDS < base002-ids.txt
say "re-running codex on ${#IDS[@]} instances (conc=$CONC)"
running=0
for id in "${IDS[@]}"; do
  [ -z "$id" ] && continue
  ./run-instance.sh "instances/${id}.json" codex >"graphify-all-logs/CODEX-${id}.log" 2>&1 &
  running=$((running+1)); [ "$running" -ge "$CONC" ] && { wait -n; running=$((running-1)); }
done
wait
ok=0; for id in "${IDS[@]}"; do [ -z "$id" ] && continue; grep -q '"costUsd"' "raw/${id}__codex/metrics.json" 2>/dev/null && ok=$((ok+1)); done
say "CODEX-RERUN-DONE: $ok/${#IDS[@]} have cost metrics"
