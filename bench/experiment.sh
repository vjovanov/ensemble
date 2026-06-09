#!/usr/bin/env bash
# Start a research experiment as a worktree off base/current. §REQ-005-research-checkpoints.2.
# Usage: ./experiment.sh <slug>   ->   worktree ../ensemble-exp-<slug> on branch exp/<slug>.
set -uo pipefail
ROOT="$(git rev-parse --show-toplevel)"
slug="${1:?usage: experiment.sh <slug>}"
git -C "$ROOT" rev-parse --verify base/current >/dev/null 2>&1 || { echo "no base/current tag — run checkpoint.sh first"; exit 1; }
wt="$(dirname "$ROOT")/ensemble-exp-${slug}"
git -C "$ROOT" worktree add -b "exp/${slug}" "$wt" base/current
base="$(git -C "$ROOT" describe --tags base/current 2>/dev/null || git -C "$ROOT" rev-parse --short base/current)"
echo "worktree: $wt"
echo "branch:   exp/${slug}  (from base/current = $base)"
echo "next: cd $wt/bench, change ONE thing (a DF/DA), re-run the affected arms, then:"
echo "      ./compare.sh exp/${slug}      # REQ-002/003 verdict vs the base"
