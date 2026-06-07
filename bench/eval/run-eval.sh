#!/usr/bin/env bash
# Grade the per-arm model patches with the official Multi-SWE-bench harness
# (builds/pulls Docker images, applies fix_patch + the instance's own test_patch,
# runs f2p/p2p tests). Writes final_report.json per arm under bench/results/<arm>/.
#
# Prereqs:  Docker running, and `pip install multi-swe-bench` (provides
#           multi_swe_bench.harness.run_evaluation).
#
#   ./eval/run-eval.sh                 # all arms that have a patch jsonl
#   INSTANCES='instances/a.json instances/b.json' ./eval/run-eval.sh
source "$(dirname "${BASH_SOURCE[0]}")/../config.sh"

EVAL_DIR="$BENCH_DIR/eval"
DATASET="$EVAL_DIR/dataset.jsonl"
mkdir -p "$EVAL_DIR/workdir" "$EVAL_DIR/repos"

if [ -n "${INSTANCES:-}" ]; then
  read -r -a INSTANCE_LIST <<< "$INSTANCES"
else
  INSTANCE_LIST=("$INST_DIR"/*.json)
fi
[ -e "${INSTANCE_LIST[0]}" ] || die "no instances found. Run: node fetch-instances.mjs <lang> <index>"

if [ "$SKIP_EVAL" = "1" ]; then
  log "skipping Docker grading because SKIP_EVAL=1"
  exit 0
fi

instance_id_for() {
  (
    eval "$(node "$BENCH_DIR/lib/inst-env.mjs" "$1")"
    printf '%s\n' "$ID"
  )
}

EVAL_PREREQS_READY=0
ensure_eval_prereqs() {
  [ "$EVAL_PREREQS_READY" = "1" ] && return 0
  command -v docker >/dev/null || die "docker not found"
  python -c "import multi_swe_bench" 2>/dev/null \
    || die "multi_swe_bench not installed. Run: pip install multi-swe-bench"

  # The Python docker SDK defaults to /var/run/docker.sock. Under rootless Docker
  # the daemon is on a user socket; point the SDK at whatever the CLI's active
  # context uses (else: PermissionError on the root socket).
  if [ -z "${DOCKER_HOST:-}" ]; then
    ctx_host="$(docker context inspect 2>/dev/null | python -c 'import sys,json; print(json.load(sys.stdin)[0]["Endpoints"]["docker"]["Host"])' 2>/dev/null)"
    [ -n "$ctx_host" ] && export DOCKER_HOST="$ctx_host" && log "DOCKER_HOST=$DOCKER_HOST (from active docker context)"
  fi
  EVAL_PREREQS_READY=1
}

archive_existing_arm_report() {
  local arm="$1" out="$RESULTS_DIR/$1" stamp archive
  [ -s "$out/final_report.json" ] || return 0
  stamp="$(date -u +%Y%m%dT%H%M%SZ)"
  archive="$RESULTS_HISTORY_DIR/reports/$arm/$stamp"
  mkdir -p "$archive"
  cp "$out/final_report.json" "$archive/final_report.json"
  rm -f "$out/final_report.json"
  log "archived previous final report: $archive/final_report.json"
}

persist_arm_validation() {
  local arm="$1" out="$RESULTS_DIR/$1"
  [ -s "$out/final_report.json" ] || { log "no final_report.json for $arm; validation records unchanged"; return 0; }
  node "$BENCH_DIR/lib/persist-validation.mjs" \
    --arm "$arm" \
    --report "$out/final_report.json" \
    --out-dir "$VALIDATION_DIR/$arm" \
    --history-dir "$RESULTS_HISTORY_DIR/validation/$arm" \
    --instances "${INSTANCE_LIST[*]}"
  log "validation records: $VALIDATION_DIR/$arm"
}

# Dataset = the full instance records (need test_patch + f2p/p2p for grading).
: > "$DATASET"
for j in "${INSTANCE_LIST[@]}"; do
  node -e 'const fs=require("fs"); process.stdout.write(JSON.stringify(JSON.parse(fs.readFileSync(process.argv[1],"utf8")))+"\n")' "$j" >> "$DATASET"
done
log "dataset: $(wc -l < "$DATASET") instances -> $DATASET"

read -r -a ARM_LIST <<< "$ARMS"
for arm in "${ARM_LIST[@]}"; do
  # Assemble the per-arm patch jsonl from the per-(instance,arm) records.
  patch="$PATCH_DIR/${arm}.jsonl"
  : > "$patch"
  for inst in "${INSTANCE_LIST[@]}"; do
    id="$(instance_id_for "$inst")"
    rec="$RAW_DIR/${id}__${arm}/patch.jsonl"
    [ -e "$rec" ] && cat "$rec" >> "$patch"
  done
  [ -s "$patch" ] || { log "skip $arm (no patches)"; continue; }
  out="$RESULTS_DIR/$arm"; mkdir -p "$out/logs"
  if [ "$REUSE_CLASSIC" = "1" ] && [ "$arm" = "classic" ] && [ -s "$out/final_report.json" ]; then
    log "reuse classic (existing report: $out/final_report.json)"
    persist_arm_validation "$arm"
    continue
  fi
  if [ "$REUSE_EVAL" = "1" ] && [ -s "$out/final_report.json" ]; then
    log "reuse $arm (existing report: $out/final_report.json)"
    persist_arm_validation "$arm"
    continue
  fi
  # Per-arm workdir: the harness caches reports by instance id within workdir, so a
  # shared workdir makes later arms reuse the first arm's report. Isolate per arm.
  awork="$EVAL_DIR/workdir/$arm"; rm -rf "$awork"; mkdir -p "$awork"
  cfg="$EVAL_DIR/config.${arm}.json"
  node -e '
    const fs=require("fs");
    // node -e has no script-path slot: argv = [node, ...userArgs].
    const [patch,dataset,workdir,repos,out,cfgPath]=process.argv.slice(1);
    const cfg={
      mode:"evaluation",
      workdir, repo_dir:repos, need_clone:true, force_build:false,
      patch_files:[patch], dataset_files:[dataset],
      output_dir:out, log_dir:out+"/logs", log_level:"INFO",
      clear_env:true, stop_on_error:false,
      max_workers:2, max_workers_build_image:2, max_workers_run_instance:2,
      global_env:[], specifics:[], skips:[],
    };
    fs.writeFileSync(cfgPath, JSON.stringify(cfg,null,2));
  ' "$patch" "$DATASET" "$awork" "$EVAL_DIR/repos" "$out" "$cfg"
  ensure_eval_prereqs
  archive_existing_arm_report "$arm"
  log "evaluating arm=$arm (config: $cfg)"
  python -m multi_swe_bench.harness.run_evaluation --config "$cfg" \
    || log "harness returned nonzero for $arm (check $out/logs)"
  log "report: $out/final_report.json"
  persist_arm_validation "$arm"
done
