#!/usr/bin/env bash
# Fetch and run 6 DIVERSE large-codebase Multi-SWE-bench instances — adding new
# languages (JS, C, C++) and new domains (compiler, compression, CLI, RPC, web)
# beyond the go/rust/ts/java set in run-hard.sh. Both arms (ensemble-strict graph
# vs classic rg/sed). graphify supports all these via tree-sitter (c/cpp/javascript).
#
#   ./run-hard-diverse.sh         # fetch + run (streams to run-hard-diverse.log)
#   nohup ./run-hard-diverse.sh & # detached
#
# Honest expectations:
#   - 6 instances x 2 arms = 12 agent runs on oca/gpt-5.5; budget ~$10-30.
#   - runs 2 instances in parallel (PARALLEL=2); per-job logs in raw/.log_<inst>_<arm>.txt.
#   - Large clones (svelte 118MB, nlohmann skipped, cli 75MB, dubbo 60MB, simdjson 95MB);
#     FORCE=1 bypasses the 400MB guard. fetch streams huge dataset files (svelte 503MB,
#     cli/cli 167MB) so only the first instance's bytes are downloaded.
#   - C/C++/JS graph quality is unverified on real repos — graphify *supports* them, but
#     confirm a non-trivial graph.json per repo on first run (harness warns if empty).
#   - Run AFTER any in-flight sweep finishes (avoid concurrent agents); grade with
#     ./eval/run-eval.sh && node collect.mjs
set -uo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"
exec > run-hard-diverse.log 2>&1   # write straight to the log (no tee pipe -> no hang if a child leaks the fd)

# (repo/dataset path, instance index) — large, diverse codebases.
HARD=(
  "js/sveltejs__svelte_dataset.jsonl 0"           # JS  compiler/framework (118MB repo, 87k*)
  "cpp/simdjson__simdjson_dataset.jsonl 0"        # C++ SIMD JSON parser   (95MB, 24k*)
  "c/facebook__zstd_dataset.jsonl 0"              # C   compression        (39MB, 27k*)
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

echo "[diverse] running $n instances x 2 arms on ${MODEL:-oca/gpt-5.5}…"
FORCE=1 PARALLEL=2 INSTANCES="$(tr '\n' ' ' < "$LIST")" ./run-all.sh

echo "[diverse] done. Next: ./eval/run-eval.sh && node collect.mjs"
rm -f "$LIST"
