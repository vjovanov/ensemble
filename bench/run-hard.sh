#!/usr/bin/env bash
# Fetch and run 9 "hard" Multi-SWE-bench instances — large, real-world repos
# across the graphify-supported languages (go/rust/ts/java) — through all 3 arms.
#
#   ./run-hard.sh                 # fetch + run (streams to run-hard.log)
#   nohup ./run-hard.sh &         # detached; then: tail -f run-hard.log
#
# Honest expectations:
#   - 9 instances x 3 arms = 27 agent runs on oca/gpt-5.5; budget ~$25-55.
#   - ~2-5h sequential, plus large clones (FORCE=1 bypasses the 400MB guard).
#   - Run this AFTER any in-flight sweep finishes (avoid concurrent agents).
#   - Grade afterward with ./eval/run-eval.sh && node collect.mjs
set -uo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"

# (repo/dataset path, instance index) — large/gnarly codebases.
HARD=(
  # tokio removed: graphify segfaults building its graph (no graph.json) — would
  # silently degrade the ensemble-graphify arm to whole-file fetches.
  "rust/clap-rs__clap_dataset.jsonl 0"                 # arg parser, large
  "rust/nushell__nushell_dataset.jsonl 0"              # shell, big codebase
  "rust/tokio-rs__tracing_dataset.jsonl 0"             # instrumentation
  "go/zeromicro__go-zero_dataset.jsonl 0"              # microservice framework
  "go/grpc__grpc-go_dataset.jsonl 5"                   # different grpc-go bug
  "java/fasterxml__jackson-databind_dataset.jsonl 0"   # the hard Jackson core
  "java/fasterxml__jackson-core_dataset.jsonl 0"
  "java/elastic__logstash_dataset.jsonl 0"             # large JRuby/Java
  "ts/vuejs__core_dataset.jsonl 0"                     # Vue 3 monorepo
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

echo "[run-hard] running $n instances x 3 arms on ${MODEL:-oca/gpt-5.5}…"
FORCE=1 INSTANCES="$(tr '\n' ' ' < "$LIST")" ./run-all.sh 2>&1 | tee run-hard.log

echo "[run-hard] done. Next: ./eval/run-eval.sh && node collect.mjs"
rm -f "$LIST"
