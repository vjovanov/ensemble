#!/usr/bin/env bash
# Regenerate the base/002 result plots + README tables from the current data and commit/push if
# anything changed. Safe to run repeatedly "as results come in" — codex auto-joins once graded.
set -uo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"
node lib/plot-results.mjs    || { echo "plot-results failed"; exit 1; }
node lib/token-breakdown.mjs || { echo "token-breakdown failed"; exit 1; }
node lib/inject-readme.mjs   || { echo "inject-readme failed"; exit 1; }
git add README.md plots/cost.svg plots/tokens.svg plots/cost-vs-classic.svg plots/breakdown-cost.svg plots/breakdown-context.svg plots/breakdown-bench-classic.svg plots/breakdown-bench-classic-graphify.svg plots/breakdown-bench-classic-graph-bash.svg lib/plot-results.mjs lib/token-breakdown.mjs lib/inject-readme.mjs
if git diff --cached --quiet; then echo "[refresh] no changes"; exit 0; fi
git commit -q -m "Refresh base/002 results ($(date -u +%Y-%m-%dT%H:%MZ))"
git push fork bench/ensemble-vs-pi 2>&1 | tail -2
echo "[refresh] committed + pushed"
