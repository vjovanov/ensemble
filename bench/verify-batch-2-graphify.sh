#!/usr/bin/env bash
# Verify batch 2 instances can be cloned, checked out, and processed by graphify.
# This does not run the coding agent or spend model tokens.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"

source ./config.sh
source ./batch-2-cases.sh

VERIFY_DIR="${VERIFY_DIR:-$WORK_DIR/batch-2-graphify}"
LIST="$(mktemp)"

cleanup() {
  local rc=$?
  trap - EXIT
  rm -f "$LIST"
  exit "$rc"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM HUP QUIT

command -v "$GRAPHIFY" >/dev/null || die "graphify not on PATH: $GRAPHIFY"
mkdir -p "$VERIFY_DIR" "$INST_DIR"

echo "[batch-2-graphify] fetching ${#BATCH_2[@]} instances..."
for spec in "${BATCH_2[@]}"; do
  # shellcheck disable=SC2086  (intentional word-split of "<path> <index>")
  node fetch-instances.mjs $spec | awk '/^saved/{print $2}' >> "$LIST" \
    || echo "[batch-2-graphify] WARN: fetch failed for: $spec"
done

n=$(wc -l < "$LIST" | tr -d ' ')
[ "$n" -eq "${#BATCH_2[@]}" ] || die "expected ${#BATCH_2[@]} instances, fetched $n"

failures=0
while IFS= read -r inst; do
  eval "$(node "$BENCH_DIR/lib/inst-env.mjs" "$inst")"
  [ -n "$SHA" ] || die "instance $ID has no base sha"

  src="$VERIFY_DIR/$ID/src"
  out="$VERIFY_DIR/$ID/graphify"
  log_file="$VERIFY_DIR/$ID/graphify.log"
  mkdir -p "$VERIFY_DIR/$ID"

  if [ ! -d "$src/.git" ]; then
    echo "[batch-2-graphify] cloning $ORG/$REPO for $ID..."
    rm -rf "$src"
    git clone --quiet --filter=blob:none "https://github.com/$ORG/$REPO" "$src" \
      || { echo "[batch-2-graphify] FAIL clone $ID"; failures=$((failures + 1)); continue; }
  fi

  echo "[batch-2-graphify] checking $ID..."
  if ! git -C "$src" checkout --quiet --detach "$SHA"; then
    echo "[batch-2-graphify] FAIL checkout $ID @ ${SHA:0:12}"
    failures=$((failures + 1))
    continue
  fi
  git -C "$src" reset --hard --quiet "$SHA"
  git -C "$src" clean -fdq

  rm -rf "$out"
  if ! (cd "$src" && GRAPHIFY_OUT="$out" "$GRAPHIFY" update "$src" >"$log_file" 2>&1); then
    echo "[batch-2-graphify] FAIL graphify update $ID (see $log_file)"
    failures=$((failures + 1))
    continue
  fi

  graph="$out/graph.json"
  if [ ! -s "$graph" ]; then
    echo "[batch-2-graphify] FAIL no non-empty graph.json for $ID"
    failures=$((failures + 1))
    continue
  fi

  nodes="$(node -e 'const fs=require("fs"); const g=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); console.log((g.nodes||[]).length)' "$graph")"
  edges="$(node -e 'const fs=require("fs"); const g=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); console.log((g.edges||g.links||[]).length)' "$graph")"
  if [ "${nodes:-0}" -le 0 ]; then
    echo "[batch-2-graphify] FAIL empty graph for $ID (nodes=$nodes edges=$edges)"
    failures=$((failures + 1))
    continue
  fi
  echo "[batch-2-graphify] OK $ID nodes=$nodes edges=$edges"
done < "$LIST"

if [ "$failures" -ne 0 ]; then
  echo "[batch-2-graphify] failed: $failures"
  exit 1
fi

echo "[batch-2-graphify] all $n batch 2 instances produced graphify graphs"
