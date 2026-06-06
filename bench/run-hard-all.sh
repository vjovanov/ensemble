#!/usr/bin/env bash
# Combined benchmark: run-hard (6 curated worst/best for graphify) + run-hard-diverse
# (6 large, diverse repos) = 12 instances across 7 languages (rust/java/ts/go/js/c/cpp)
# and many domains. Both arms (ensemble-strict graph vs classic rg/sed). The largest
# single benchmark set — use this when you want statistical power, not a quick A/B.
#
#   ./run-hard-all.sh             # fetch + run (streams to run-hard-all.log)
#   nohup ./run-hard-all.sh &     # detached
#
# Honest expectations:
#   - 12 instances x 2 arms = 24 agent runs on oca/gpt-5.5; budget ~$20-50.
#   - PARALLEL=2 (2 instances at a time) -> ~6 waves; raise PARALLEL to go faster.
#   - Large clones (FORCE=1 bypasses the 400MB guard); fetch streams huge dataset files.
#   - graphify supports every language here (tree-sitter); coverage verified for c/cpp.
#   - Run AFTER any in-flight sweep finishes; grade with ./eval/run-eval.sh && node collect.mjs
set -uo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"

# (repo/dataset path, instance index).
HARD=(
  # --- curated worst/best for graphify (run-hard.sh) ---
  "rust/clap-rs__clap_dataset.jsonl 0"            # rust  worst 3.43x
  "rust/tokio-rs__tracing_dataset.jsonl 0"        # rust  worst 3.30x
  "java/fasterxml__jackson-core_dataset.jsonl 0"  # java  worst 2.37x
  "ts/vuejs__core_dataset.jsonl 0"                # ts    worst 2.16x
  "rust/nushell__nushell_dataset.jsonl 0"         # rust  best  0.50x
  "go/zeromicro__go-zero_dataset.jsonl 0"         # go    best  0.60x
  # --- diverse large codebases (run-hard-diverse.sh) ---
  "js/sveltejs__svelte_dataset.jsonl 0"           # js    compiler/framework
  "cpp/simdjson__simdjson_dataset.jsonl 0"        # cpp   SIMD JSON parser
  "c/facebook__zstd_dataset.jsonl 0"              # c     compression
  "go/cli__cli_dataset.jsonl 0"                   # go    GitHub CLI app
  "java/apache__dubbo_dataset.jsonl 0"            # java  RPC framework
  "js/axios__axios_dataset.jsonl 0"               # js    HTTP client
)

LIST="$(mktemp)"
echo "[all] fetching ${#HARD[@]} instances…"
for spec in "${HARD[@]}"; do
  # shellcheck disable=SC2086  (intentional word-split of "<path> <index>")
  node fetch-instances.mjs $spec | awk '/^saved/{print $2}' >> "$LIST" \
    || echo "[all] WARN: fetch failed for: $spec"
done

n=$(wc -l < "$LIST" | tr -d ' ')
echo "[all] fetched $n instances:"; cat "$LIST"
[ "$n" -gt 0 ] || { echo "[all] nothing fetched; aborting"; exit 1; }

echo "[all] running $n instances x 2 arms on ${MODEL:-oca/gpt-5.5} (PARALLEL=${PARALLEL:-2})…"
FORCE=1 PARALLEL="${PARALLEL:-2}" INSTANCES="$(tr '\n' ' ' < "$LIST")" ./run-all.sh 2>&1 | tee run-hard-all.log

echo "[all] done. Next: ./eval/run-eval.sh && node collect.mjs"
rm -f "$LIST"
