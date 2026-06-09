#!/usr/bin/env bash
# Promote a winning experiment: merge exp/<slug> into the main branch, then cut a new base.
# §REQ-005-research-checkpoints.3.  Usage: ./promote.sh <slug> <new-base-slug>
# Run from the MAIN worktree. The experiment must already PASS ./compare.sh (run it first).
set -uo pipefail
ROOT="$(git rev-parse --show-toplevel)"
slug="${1:?usage: promote.sh <exp-slug> <new-base-slug>}"
newslug="${2:?usage: promote.sh <exp-slug> <new-base-slug>}"
branch="exp/${slug}"
git -C "$ROOT" rev-parse --verify "$branch" >/dev/null 2>&1 || { echo "no branch $branch"; exit 1; }

cur="$(git -C "$ROOT" branch --show-current)"
echo "merging $branch into $cur"
git -C "$ROOT" merge --no-ff -m "promote $branch (REQ-005)" "$branch" || {
  echo "merge conflict — resolve, commit, then run: ./checkpoint.sh $newslug"; exit 1; }
echo "merged. Next: run the full bench at HEAD (all arms), then ./checkpoint.sh $newslug"
echo "(checkpoint cuts base/NNN-$newslug and advances base/current; keep exp tag $branch for the record)"
