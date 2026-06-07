#!/usr/bin/env bash
# Fetch and run 8 DIVERSE large-codebase Multi-SWE-bench instances — adding new
# languages (JS, C, C++) and new domains (compiler, compression, CLI, RPC, web)
# beyond the go/rust/ts/java set in run-hard.sh. Uses the default arms in config.sh
# (classic-bash vs classic unless ARMS is overridden).
#
#   ./run-hard-diverse.sh         # fetch + run (streams to run-hard-diverse.log)
#   nohup ./run-hard-diverse.sh & # detached
#
# Honest expectations:
#   - 8 instances x 2 arms = 16 agent runs on oca/gpt-5.5; budget ~$15-40.
#   - runs 2 arms of the same instance in parallel (PARALLEL=2); per-job logs in raw/.log_<inst>_<arm>.txt.
#   - Large clones (svelte 118MB, cli 75MB, dubbo 60MB, simdjson 95MB; nlohmann skipped);
#     FORCE=1 bypasses the 400MB guard. fetch streams huge dataset files (svelte 503MB,
#     cli/cli 167MB, ponyc 25MB) so only bytes up to the requested instance are downloaded.
#   - For graph arms, C/C++/JS graph quality is unverified on real repos — graphify
#     supports them, but confirm a non-trivial graph.json per repo on first run.
#   - Run AFTER any in-flight sweep finishes (avoid concurrent agents); Docker grading +
#     collection runs automatically.
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

# (repo/dataset path, instance index) — large, diverse codebases.
HARD=(
  "js/sveltejs__svelte_dataset.jsonl 0"           # JS  compiler/framework (118MB repo, 87k*)
  "cpp/simdjson__simdjson_dataset.jsonl 0"        # C++ SIMD JSON parser   (95MB, 24k*)
  "c/facebook__zstd_dataset.jsonl 0"              # C   compression        (39MB, 27k*)
  "c/jqlang__jq_dataset.jsonl 0"                  # C   JSON processor / regex capture
  "c/ponylang__ponyc_dataset.jsonl 0"             # C   compiler frontend
  "go/cli__cli_dataset.jsonl 0"                   # Go  GitHub CLI app      (75MB, 45k*)
  "java/apache__dubbo_dataset.jsonl 0"            # Java RPC framework      (60MB, 42k*)
  "js/axios__axios_dataset.jsonl 0"               # JS  HTTP client         (27MB, 109k*)
)

LIST="$(mktemp)"
echo "[diverse] fetching ${#HARD[@]} instances…"
for spec in "${HARD[@]}"; do
  # shellcheck disable=SC2086  (intentional word-split of "<path> <index>")
  node fetch-instances.mjs $spec | awk '/^saved/{print $2}' >> "$LIST" \
    || echo "[diverse] WARN: fetch failed for: $spec"
done

n=$(wc -l < "$LIST" | tr -d ' ')
echo "[diverse] fetched $n instances:"; cat "$LIST"
[ "$n" -gt 0 ] || { echo "[diverse] nothing fetched; aborting"; exit 1; }

echo "[diverse] running $n instances x 2 arms on ${MODEL:-oca/gpt-5.5} (PARALLEL=${PARALLEL:-2})…"
FORCE=1 PARALLEL="${PARALLEL:-2}" INSTANCES="$(tr '\n' ' ' < "$LIST")" setsid ./run-all.sh &
RUN_PID=$!
wait "$RUN_PID"
RUN_PID=""

echo "[diverse] done. Results are in results/results.csv"
