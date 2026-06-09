#!/usr/bin/env bash
# Show each sidekick CALL paired with its RESULT for a graph-bash run — to see where it misleads the
# lead. Choose the sidekick: explore (lead task -> graph/search evidence) or bash (command -> digest/
# output the lead got). Pairs the latest raw/ session for the instance.
# Usage: ./explore-pairs.sh <instance-id> [--sidekick explore|bash] [--arm classic-graph-bash] [--full] [--max N]
#   e.g. ./explore-pairs.sh nushell__nushell-13870                       (explore, default)
#        ./explore-pairs.sh nushell__nushell-13870 --sidekick bash       (bash digests)
#        ./explore-pairs.sh jqlang__jq-3238 --sidekick bash --full
set -uo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"
# Warn if a run for this instance is live — its session is mid-write, so calls may show
# "(no result)" simply because the result line isn't flushed yet (a race, not a real abort).
inst="${1:-}"
if [ -n "$inst" ] && [ "${inst:0:2}" != "--" ] && pgrep -af "run-instance.sh.*${inst}" 2>/dev/null | grep -qv "ps -eo"; then
  echo "⚠️  WARNING: a run for '${inst}' is LIVE right now — the session is being written." >&2
  echo "    Calls may show '(no result)' because the result isn't flushed yet (race, not a real abort)." >&2
  echo "    Re-run after it finishes for a complete trace." >&2
  echo >&2
fi
exec node lib/explore-pairs.mjs "$@"
