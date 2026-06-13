#!/usr/bin/env bash
# DF-022: add a new sidekick model to the graph-bash sidekick experiment.
# Full base002-30 cascade x K seeds: run active set -> EJECT instances that loop
# (hit the agent/run wall-clock or produce no session) -> grade survivors -> snapshot.
# Survivors carry to the next seed. Mirrors how devstral2-120b/gpt-oss-120b were run.
#
# Usage: ./df022-qwen-cascade.sh
set -uo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"

# the agent requires Node >= 22.19.0; pin nvm's v22 (default PATH may be Node 20)
N22_BIN="$(ls -d "$HOME"/.nvm/versions/node/v22*/bin 2>/dev/null | sort -V | tail -1)"
[ -n "$N22_BIN" ] && export PATH="$N22_BIN:$PATH"

MODEL_LABEL="${MODEL_LABEL:-qwen3-coder-30b}"
EXPLORE_MODEL="${EXPLORE_MODEL:-openrouter:qwen/qwen3-coder-30b-a3b-instruct}"
ARM="graph-bash"
RUN_ROOT="multiseed/df022-graph-bash-sidekicks"
OUT="$RUN_ROOT/$MODEL_LABEL"
K="${K:-3}"
CONC="${CONC:-5}"
export AGENT_TIMEOUT="${AGENT_TIMEOUT:-1200}"   # agent wall-clock (read by run-instance.sh)
RUN_TIMEOUT="${RUN_TIMEOUT:-1800}"              # hard per-instance guard (kill loops, then eject)
DROP_AT="$((AGENT_TIMEOUT - 30))"               # elapsed >= this => looped to the cap => eject
export PI_EXPLORE_MODEL="$EXPLORE_MODEL"
export PI_EXPLORE_MAX_RESULT_BYTES=1073741824   # uncapped, same as devstral2/gpt-oss runs
# §DF-022 repeat-guard (pass-through; 0/unset = disabled, baseline behaviour)
export PI_EXPLORE_MAX_CALLS="${PI_EXPLORE_MAX_CALLS:-0}"
export PI_EXPLORE_MAX_REPEAT="${PI_EXPLORE_MAX_REPEAT:-0}"

mkdir -p "$OUT" graphify-all-logs "$OUT/.status"
LOG="$RUN_ROOT/df022-${MODEL_LABEL}-cascade.setsid.log"
DROPPED="$RUN_ROOT/dropped.tsv"
log(){ echo "[df022-$MODEL_LABEL $(date +%H:%M:%S)] $*" | tee -a "$LOG"; }

# verify the override actually resolves (registry) so we never silently fall back to the lead
REG="../node_modules/@earendil-works/pi-ai/dist/models.generated.js"
grep -q "id: \"${EXPLORE_MODEL#*:}\"" "$REG" 2>/dev/null \
  || { log "FATAL: ${EXPLORE_MODEL} not in model registry (would fall back to lead)"; exit 1; }

mapfile -t ACTIVE < <(grep -v '^[[:space:]]*$' base002-ids.txt)
log "START $MODEL_LABEL: $EXPLORE_MODEL  seeds=$K conc=$CONC agent_timeout=${AGENT_TIMEOUT}s run_timeout=${RUN_TIMEOUT}s active=${#ACTIVE[@]}"

# wait out any other heavy bench jobs
while pgrep -f "run_evaluation|graphbash-rerun.sh" >/dev/null 2>&1; do sleep 60; done

for k in $(seq 1 "$K"); do
  [ "${#ACTIVE[@]}" -eq 0 ] && { log "no active instances left; stopping at seed $k"; break; }
  log "seed $k/$K for $MODEL_LABEL on ${#ACTIVE[@]} active instances"
  rm -f "$OUT/.status/s${k}/"* 2>/dev/null; mkdir -p "$OUT/.status/s${k}"

  running=0
  for id in "${ACTIVE[@]}"; do
    (
      t0=$(date +%s)
      timeout --signal=TERM --kill-after=30 "${RUN_TIMEOUT}s" \
        ./run-instance.sh "instances/${id}.json" "$ARM" \
        >"graphify-all-logs/${MODEL_LABEL}-s${k}-${id}.log" 2>&1
      rc=$?
      t1=$(date +%s)
      echo "$rc $((t1 - t0))" >"$OUT/.status/s${k}/${id}"
    ) &
    running=$((running+1)); [ "$running" -ge "$CONC" ] && { wait -n; running=$((running-1)); }
  done
  wait

  # classify: eject loopers / failed-session before grading
  SURV=()
  for id in "${ACTIVE[@]}"; do
    read -r rc elapsed < "$OUT/.status/s${k}/${id}" 2>/dev/null || { rc=99; elapsed=0; }
    m="raw/${id}__${ARM}/metrics.json"
    has_session=0
    if [ -f "$m" ]; then
      python3 -c "import json,sys; d=json.load(open('$m')); sys.exit(0 if d.get('sidekick',{}).get('model') else 1)" 2>/dev/null && has_session=1
    fi
    drop=""
    if [ "$rc" = "124" ] || [ "$rc" = "137" ]; then drop="run-timeout"; fi
    [ -z "$drop" ] && [ "${elapsed:-0}" -ge "$DROP_AT" ] && drop="agent-timeout-or-watchdog"
    [ -z "$drop" ] && [ "$rc" != "0" ] && drop="run-error-rc${rc}"
    [ -z "$drop" ] && [ "$has_session" = "0" ] && drop="no-session"
    if [ -n "$drop" ]; then
      printf '%s\t%s\t%s\t%s\t%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$MODEL_LABEL" "$k" "$id" "$drop" >>"$DROPPED"
      log "EJECT $id after $MODEL_LABEL seed $k: $drop (rc=$rc elapsed=${elapsed}s)"
    else
      SURV+=("$id")
    fi
  done
  ACTIVE=("${SURV[@]}")
  log "seed $k: ${#ACTIVE[@]} survivors -> grading"
  [ "${#ACTIVE[@]}" -eq 0 ] && { log "all ejected at seed $k"; break; }

  # grade survivors only
  INST_PATHS=""; for id in "${ACTIVE[@]}"; do INST_PATHS+="instances/${id}.json "; done
  INSTANCES="$INST_PATHS" ARMS="$ARM" ./eval/run-eval.sh >>"$LOG" 2>&1 || log "grade nonzero (seed $k)"

  # snapshot survivors (incl. explore debug/metrics) + validation
  for id in "${ACTIVE[@]}"; do
    sd="$OUT/s${k}/${id}__${ARM}"; mkdir -p "$sd"
    for f in metrics.json patch.diff manifest.json explore-metrics.jsonl explore-debug.jsonl; do
      [ -f "raw/${id}__${ARM}/$f" ] && cp "raw/${id}__${ARM}/$f" "$sd/"
    done
    v="results/validation/${ARM}/${id}.json"
    [ -f "$v" ] && { mkdir -p "$OUT/s${k}/validation/${ARM}"; cp "$v" "$OUT/s${k}/validation/${ARM}/"; }
  done
  log "seed $k snapshot -> $OUT/s${k}"
done

./reclaim-docker.sh >/dev/null 2>&1 || true
log "DF022-${MODEL_LABEL}-CASCADE-DONE (K=$K, survivors=${#ACTIVE[@]}: ${ACTIVE[*]:-none})"
