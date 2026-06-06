#!/usr/bin/env bash
# Fetch and run 6 curated "hard" Multi-SWE-bench instances (4 worst + 2 best for graphify)
# across the graphify-supported languages (go/rust/ts/java) — through both arms
# (ensemble-strict graph vs classic rg/sed; sidekick-fs dropped — see config.sh).
#
#   ./run-hard.sh                 # fetch + run (streams to run-hard.log)
#   nohup ./run-hard.sh &         # detached; then: tail -f run-hard.log
#
# Honest expectations:
#   - 6 instances x 2 arms = 12 agent runs on oca/gpt-5.5; budget ~$10-25.
#   - runs 2 instances in parallel (PARALLEL=2); per-job logs in raw/.log_<inst>_<arm>.txt.
#   - ~2-5h sequential, plus large clones (FORCE=1 bypasses the 400MB guard).
#   - Run this AFTER any in-flight sweep finishes (avoid concurrent agents).
#   - Grade afterward with ./eval/run-eval.sh && node collect.mjs
set -uo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"
exec > run-hard.log 2>&1   # write straight to the log (no tee pipe -> no hang if a child leaks the fd)

# (repo/dataset path, instance index) — curated to the most informative cases from the first
# sweep: the 4 WORST for graphify (graph/classic cacheRead highest) and the 2 BEST, so an A/B
# of the search+node_at sidekick shows movement where it matters. tokio dropped (graphify
# segfaults building its graph). Removed as mid-pack/redundant: grpc-go, jackson-databind, logstash.
HARD=(
  "rust/clap-rs__clap_dataset.jsonl 0"                 # WORST 3.43x (rust)
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

echo "[run-hard] running $n instances x 2 arms on ${MODEL:-oca/gpt-5.5}…"
FORCE=1 PARALLEL=2 INSTANCES="$(tr '\n' ' ' < "$LIST")" ./run-all.sh

echo "[run-hard] done. Next: ./eval/run-eval.sh && node collect.mjs"
rm -f "$LIST"
