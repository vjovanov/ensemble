#!/usr/bin/env bash
# Fetch and run 6 curated "hard" Multi-SWE-bench instances (4 worst + 2 best for graphify)
# across go/rust/ts/java — through the default arms in config.sh
# (classic-bash vs classic unless ARMS is overridden).
#
#   ./run-hard.sh                 # fetch + run (streams to run-hard.log)
#   nohup ./run-hard.sh &         # detached; then: tail -f run-hard.log
#
# Honest expectations:
#   - 6 instances x 2 arms = 12 agent runs on oca/gpt-5.5; budget ~$10-25.
#   - runs 2 arms of the same instance in parallel (PARALLEL=2); per-job logs in raw/.log_<inst>_<arm>.txt.
#   - ~2-5h sequential, plus large clones (FORCE=1 bypasses the 400MB guard).
#   - Run this AFTER any in-flight sweep finishes (avoid concurrent agents).
#   - Docker grading + collection runs automatically after the agent runs.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"

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

# (repo/dataset path, instance index) — curated to the most informative cases from the first
# sweep: the 3 WORST for graphify (graph/classic cacheRead highest) and the 2 BEST.
# They remain useful as mixed-language examples for bash-isolation runs.
HARD=(
  "rust/tokio-rs__tracing_dataset.jsonl 0"             # WORST 3.30x (rust)
  "java/fasterxml__jackson-core_dataset.jsonl 0"       # WORST 2.37x (java)
  "ts/vuejs__core_dataset.jsonl 0"                     # WORST 2.16x (ts)
  "rust/nushell__nushell_dataset.jsonl 0"              # BEST  0.50x (rust)
  "go/zeromicro__go-zero_dataset.jsonl 0"              # BEST  0.60x (go)
)

LIST="$(mktemp)"
echo "[run-hard] fetching ${#HARD[@]} instances…"
for spec in "${HARD[@]}"; do
  # word-split spec into <path> <index>; allow the larger per-repo dataset files
  # shellcheck disable=SC2086
  MAX_FILE_MB="${MAX_FILE_MB:-200}" node fetch-instances.mjs $spec \
    | awk '/^saved/{print $2}' >> "$LIST" || echo "[run-hard] WARN: fetch failed for: $spec"
done

n=$(wc -l < "$LIST" | tr -d ' ')
echo "[run-hard] fetched $n instances:"; cat "$LIST"
[ "$n" -gt 0 ] || { echo "[run-hard] nothing fetched; aborting"; exit 1; }

echo "[run-hard] running $n instances x 2 arms on ${MODEL:-oca/gpt-5.5} (PARALLEL=${PARALLEL:-2})…"
FORCE=1 PARALLEL="${PARALLEL:-2}" INSTANCES="$(tr '\n' ' ' < "$LIST")" setsid ./run-all.sh &
RUN_PID=$!
wait "$RUN_PID"
RUN_PID=""

echo "[run-hard] done. Results are in results/results.csv"
