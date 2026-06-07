#!/usr/bin/env bash
# Fetch and run batch 3: known graph-win cases from the previous sweep, reused as
# a regression batch for the configured arms.
#
# First run:
#   ./verify-batch-3-graphify.sh
#
# Then run:
#   ./run-batch-3.sh              # fetch + run
#   nohup ./run-batch-3.sh &      # detached
#
# Honest expectations:
#   - 6 instances x 2 arms = 12 agent runs on oca/gpt-5.5; budget ~$10-30.
#   - This batch is not a neutral sample. It is a confirmation/regression batch.
#   - PARALLEL=2 runs both arms for one instance at a time.
#   - FORCE=1 bypasses the clone-size guard for larger repos.
#   - Run AFTER any in-flight sweep finishes; Docker grading + collection runs automatically.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"

source ./batch-3-cases.sh

RUN_PID=""
LIST=""

cleanup() {
  local rc=$?
  trap - EXIT
  if [ -n "$RUN_PID" ]; then
    kill -TERM -- "-$RUN_PID" 2>/dev/null || kill -TERM "$RUN_PID" 2>/dev/null || true
    sleep 2
    kill -KILL -- "-$RUN_PID" 2>/dev/null || kill -KILL "$RUN_PID" 2>/dev/null || true
    wait "$RUN_PID" 2>/dev/null || true
    RUN_PID=""
  fi
  [ -n "$LIST" ] && rm -f "$LIST"
  exit "$rc"
}

trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM HUP QUIT

LIST="$(mktemp)"
echo "[batch-3] fetching ${#BATCH_3[@]} instances..."
for spec in "${BATCH_3[@]}"; do
  # shellcheck disable=SC2086  (intentional word-split of "<path> <index>")
  node fetch-instances.mjs $spec | awk '/^saved/{print $2}' >> "$LIST" \
    || echo "[batch-3] WARN: fetch failed for: $spec"
done

n=$(wc -l < "$LIST" | tr -d ' ')
echo "[batch-3] fetched $n instances:"; cat "$LIST"
[ "$n" -gt 0 ] || { echo "[batch-3] nothing fetched; aborting"; exit 1; }

echo "[batch-3] running $n instances x 2 arms on ${MODEL:-oca/gpt-5.5} (PARALLEL=${PARALLEL:-2})..."
FORCE=1 PARALLEL="${PARALLEL:-2}" INSTANCES="$(tr '\n' ' ' < "$LIST")" setsid ./run-all.sh &
RUN_PID=$!
wait "$RUN_PID"
RUN_PID=""

echo "[batch-3] done. Results are in results/results.csv"
