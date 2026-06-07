#!/usr/bin/env bash
# Shared C-focused batch 2 instance list.

BATCH_2=(
  "c/jqlang__jq_dataset.jsonl 0"                  # jq#3238 optional regex capture groups
  "c/jqlang__jq_dataset.jsonl 3"                  # jq#2919 CLI script after --
  "c/jqlang__jq_dataset.jsonl 4"                  # jq#2840 negative index wrapping
  "c/facebook__zstd_dataset.jsonl 0"              # zstd#3942 -c/-o/--rm option order
  "c/facebook__zstd_dataset.jsonl 2"              # zstd#3438 hash/chain log bounds
  "c/ponylang__ponyc_dataset.jsonl 0"             # ponyc#4595 parser/compiler crash
  "c/ponylang__ponyc_dataset.jsonl 1"             # ponyc#4593 CLI parent command defaults
)
