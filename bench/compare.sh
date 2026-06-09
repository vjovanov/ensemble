#!/usr/bin/env bash
# REQ-002/003 verdict for the current run vs a base checkpoint. §REQ-005-research-checkpoints.3
# Usage: ./compare.sh [base-name] [--arm classic-graph-bash]
#   base-name: a checkpoints/<name> dir (default: resolve base/current).
#   Candidate = the live working tree (raw/ + results/validation).
set -uo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"
ROOT="$(git rev-parse --show-toplevel)"

base="${1:-}"; [ "${base:0:2}" = "--" ] && base=""
shift_arm=()
[ -n "$base" ] && shift || true
[ "${1:-}" = "--arm" ] && shift_arm=(--arm "$2")

if [ -z "$base" ]; then
  # resolve base/current -> the checkpoint dir it tagged
  name="$(git -C "$ROOT" tag -l --points-at base/current 'base/[0-9]*' | head -1 | sed 's|^base/||')"
  [ -n "$name" ] || { echo "cannot resolve base/current to a base/NNN-slug tag"; exit 2; }
  base="checkpoints/$name"
fi
[ -d "$base/raw" ] || { echo "base checkpoint not found: $base"; exit 2; }
echo "base: $base"
node lib/compare.mjs \
  --base-raw "$base/raw" --base-val "$base/validation" \
  --cand-raw raw --cand-val results/validation "${shift_arm[@]}"
