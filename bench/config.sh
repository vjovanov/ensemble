# bench/config.sh — shared configuration for the ensemble vs standard-pi benchmark.
# Source this from the runner scripts: `source "$(dirname "$0")/config.sh"`.
# Override any value from the environment, e.g. `MODEL=gpt-5-mini ./run-all.sh`.

set -euo pipefail

# Repo root (the ensemble/pi monorepo) and bench dir.
BENCH_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$BENCH_DIR/.." && pwd)"

# --- Model ------------------------------------------------------------------
# We use gpt-5.5 via the pi agent's OCA provider (Oracle OCI litellm endpoint,
# configured in ~/.pi/agent/models.json; key in ~/.pi/agent/.oca-key). This is the
# pi default. PROVIDER + MODEL map to `--provider <PROVIDER> --model <MODEL>`.
: "${PROVIDER:=OCA}"
: "${MODEL:=oca/gpt-5.5}"

# Per-Mtok pricing used to compute cost from token counts (the session file
# often stores cost=0). Keep in sync with packages/ai/src/models.generated.ts.
# Format: input output cacheRead cacheWrite  (USD per 1M tokens).
declare -A PRICING=(
  ["oca/gpt-5.5"]="5 30 0.5 0"        # nominal gpt-5.5 list price (OCA internal endpoint; cost is an estimate)
  ["openai/gpt-5.5"]="5 30 0.5 0"     # OpenRouter live pricing (per Mtok)
  ["openai/gpt-5-mini"]="0.25 2 0.025 0"
)
if [ -z "${PRICE:-}" ]; then
  if [ -n "${PRICING[$MODEL]:-}" ]; then
    PRICE="${PRICING[$MODEL]}"
  else
    PRICE="0 0 0 0"
    printf '\033[33m[bench:warn]\033[0m no pricing for MODEL=%s — costUsd will be 0. Add it to PRICING in config.sh.\n' "$MODEL" >&2
  fi
fi

# --- Arms -------------------------------------------------------------------
# classic-bash    : --exploration classic + bash sidekick output digest
# classic         : --exploration classic + raw bash output (baseline)
# ensemble-strict : --exploration sidekick + graph prebuilt + PI_REQUIRE_GRAPH=1 (enforced)
# graph-bash      : same strict graph setup, retained for old graph+bash experiments
# (sidekick-fs — filesystem results presented as explore/graph results — dropped: it muddies
#  the graph-vs-rg comparison. run-instance.sh still supports it if added back to ARMS.)
: "${ARMS:=classic-bash classic}"
ARMS="${ARMS//,/ }"

# --- Corpus -----------------------------------------------------------------
# Full Multi-SWE-bench stores small per-repo jsonl files grouped by language dir
# (go/, rust/, ts/, java/, js/, c/, cpp/). Python is empty here (it's the non-Python
# SWE-bench complement). fetch-instances.mjs pulls the smallest repo file per language.
: "${HF_DATASET:=ByteDance-Seed/Multi-SWE-bench}"
# Instances are fetched into bench/instances/*.json (see fetch-instances.mjs).
# run-all.sh runs every *.json there; suggested cross-language set: go rust ts java.

# --- Paths ------------------------------------------------------------------
WORK_DIR="$BENCH_DIR/work"          # per-instance cloned repos (one src per instance)
RAW_DIR="$BENCH_DIR/raw"            # per (instance,arm): session jsonl, patch, metrics
PATCH_DIR="$BENCH_DIR/patches"      # per-arm jsonl of model patches for the eval harness
INST_DIR="$BENCH_DIR/instances"     # fetched instance json + derived problem.md
RESULTS_DIR="$BENCH_DIR/results"    # final csv + summary + harness reports
mkdir -p "$WORK_DIR" "$RAW_DIR" "$PATCH_DIR" "$INST_DIR" "$RESULTS_DIR"

# --- Knobs ------------------------------------------------------------------
: "${AGENT_TIMEOUT:=1200}"          # seconds per agent run (wall-clock guard)
: "${MAX_REPO_MB:=400}"             # refuse to clone repos bigger than this (FORCE=1 overrides)
: "${GRAPHIFY:=graphify}"           # graphify binary (must be on PATH for strict arm)
: "${DRY_RUN:=0}"                   # 1 = skip the paid agent call; exercise plumbing only
: "${NO_CLASSIC:=0}"                # 1 = remove classic from ARMS
: "${REUSE_CLASSIC:=0}"             # 1 = skip classic agent runs but keep classic in reports
: "${SKIP_EVAL:=0}"                 # 1 = skip official Docker grading after agent runs
: "${REUSE_EVAL:=0}"                # 1 = keep existing final_report.json files instead of regrading
: "${TSX:=$REPO_ROOT/node_modules/.bin/tsx}"

# The headless pi/ensemble invocation. Mirrors pi-test.sh.
pi_cli() { "$TSX" --tsconfig "$REPO_ROOT/tsconfig.json" "$REPO_ROOT/packages/coding-agent/src/cli.ts" "$@"; }

log() { printf '\033[36m[bench]\033[0m %s\n' "$*" >&2; }
die() { printf '\033[31m[bench:err]\033[0m %s\n' "$*" >&2; exit 1; }

if [ "$NO_CLASSIC" = "1" ]; then
  read -r -a _ARM_FILTER_LIST <<< "$ARMS"
  _FILTERED_ARMS=()
  for _arm in "${_ARM_FILTER_LIST[@]}"; do
    [ "$_arm" = "classic" ] && continue
    _FILTERED_ARMS+=("$_arm")
  done
  [ "${#_FILTERED_ARMS[@]}" -gt 0 ] || die "NO_CLASSIC=1 removed every arm from ARMS='$ARMS'"
  ARMS="${_FILTERED_ARMS[*]}"
  unset _arm _ARM_FILTER_LIST _FILTERED_ARMS
fi
