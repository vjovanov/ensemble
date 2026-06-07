#!/usr/bin/env bash
# Fetch and run batch 2: a C-focused Multi-SWE-bench sweep for the configured arms.
#
# First run:
#   ./verify-batch-2-graphify.sh
#
# Then run:
#   ./run-batch-2.sh              # fetch + run
#   nohup ./run-batch-2.sh &      # detached
#
# Honest expectations:
#   - 7 instances x 2 arms = 14 agent runs on oca/gpt-5.5; budget ~$10-35.
#   - The C dataset only has three repos: jq, zstd, and ponyc. This suite samples
#     all three and uses multiple jq/zstd/ponyc issues for within-language signal.
#   - PARALLEL=2 runs both arms for one instance at a time.
#   - FORCE=1 bypasses the clone-size guard. The ponyc dataset file is 25MB; the
#     fetcher streams only up to the requested rows.
#   - Run AFTER any in-flight sweep finishes; Docker grading + collection runs automatically.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"

source ./batch-2-cases.sh

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
echo "[batch-2] fetching ${#BATCH_2[@]} instances..."
for spec in "${BATCH_2[@]}"; do
  # shellcheck disable=SC2086  (intentional word-split of "<path> <index>")
  node fetch-instances.mjs $spec | awk '/^saved/{print $2}' >> "$LIST" \
    || echo "[batch-2] WARN: fetch failed for: $spec"
done

n=$(wc -l < "$LIST" | tr -d ' ')
echo "[batch-2] fetched $n instances:"; cat "$LIST"
[ "$n" -gt 0 ] || { echo "[batch-2] nothing fetched; aborting"; exit 1; }

echo "[batch-2] running $n instances x 2 arms on ${MODEL:-oca/gpt-5.5} (PARALLEL=${PARALLEL:-2})..."
FORCE=1 PARALLEL="${PARALLEL:-2}" INSTANCES="$(tr '\n' ' ' < "$LIST")" setsid ./run-all.sh &
RUN_PID=$!
wait "$RUN_PID"
RUN_PID=""

echo "[batch-2] done. Results are in results/results.csv"
