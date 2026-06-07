#!/usr/bin/env bash
# Shared batch 3 instance list: cases where graph beat classic in the current sweep.

BATCH_3=(
  "java/apache__dubbo_dataset.jsonl 0"            # apache__dubbo-11781: graph 0.45x cost, same unresolved outcome
  "go/cli__cli_dataset.jsonl 0"                   # cli__cli-10388: graph 0.43x cost, same unresolved outcome
  "java/fasterxml__jackson-core_dataset.jsonl 0"  # fasterxml__jackson-core-1309: graph 0.88x cost, same unresolved outcome
  "cpp/simdjson__simdjson_dataset.jsonl 0"        # simdjson__simdjson-2178: graph 0.88x cost, both resolved
  "js/sveltejs__svelte_dataset.jsonl 0"           # sveltejs__svelte-15115: graph 0.63x cost, same unresolved outcome
  "ts/vuejs__core_dataset.jsonl 0"                # vuejs__core-11899: graph 0.70x cost, same unresolved outcome
)
