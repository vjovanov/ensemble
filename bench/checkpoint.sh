#!/usr/bin/env bash
# Freeze the current full benchmark run as an immutable base checkpoint.
# §REQ-005-research-checkpoints.1.  Usage: ./checkpoint.sh <slug>
# Lightweight freeze: per (instance,arm) metrics.json + patch.diff + manifest.json, the validation
# records, results.csv, and a META. Heavy session/graph blobs are NOT frozen (stay local).
set -uo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"
ROOT="$(git rev-parse --show-toplevel)"
slug="${1:?usage: checkpoint.sh <slug>}"

n=$(git -C "$ROOT" tag -l 'base/[0-9]*' | sed -E 's|base/0*([0-9]+).*|\1|' | sort -n | tail -1)
nnn=$(printf '%03d' $(( ${n:-0} + 1 )))
name="${nnn}-${slug}"; tag="base/${name}"
dir="checkpoints/${name}"
[ -e "$dir" ] && { echo "checkpoint dir $dir exists; aborting"; exit 1; }
mkdir -p "$dir/raw"

# 1. lightweight per-(instance,arm) artifacts from raw/
shopt -s nullglob
for d in raw/*__*/; do
  b="$(basename "$d")"
  mkdir -p "$dir/raw/$b"
  for f in metrics.json patch.diff manifest.json; do [ -f "$d/$f" ] && cp "$d/$f" "$dir/raw/$b/"; done
done
# 2. validation records + results.csv
[ -d results/validation ] && cp -r results/validation "$dir/validation"
[ -f results/results.csv ] && cp results/results.csv "$dir/results.csv"
# 3. META
{
  echo "tag=$tag"
  echo "commit=$(git -C "$ROOT" rev-parse HEAD)"
  echo "date=$(date -u +%FT%TZ)"
  echo "arms=${ARMS:-}"
  echo "instances=$(ls instances/*.json 2>/dev/null | wc -l)"
} > "$dir/META"

# 4. commit + tag (+ move base/current)
git -C "$ROOT" add "bench/$dir"
git -C "$ROOT" commit -q -m "checkpoint $tag" || { echo "nothing to commit"; }
git -C "$ROOT" tag "$tag"
git -C "$ROOT" tag -f base/current >/dev/null
echo "froze $tag -> bench/$dir  (base/current -> $tag)"
echo "files: $(find "$dir" -type f | wc -l)"
