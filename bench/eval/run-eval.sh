#!/usr/bin/env bash
# Grade the per-arm model patches with the official Multi-SWE-bench harness
# (builds/pulls Docker images, applies fix_patch + the instance's own test_patch,
# runs f2p/p2p tests). Writes final_report.json per arm under bench/results/<arm>/.
#
# Prereqs:  Docker running, and `pip install multi-swe-bench` (provides
#           multi_swe_bench.harness.run_evaluation).
#
#   ./eval/run-eval.sh                 # all arms that have a patch jsonl
source "$(dirname "${BASH_SOURCE[0]}")/../config.sh"

EVAL_DIR="$BENCH_DIR/eval"
DATASET="$EVAL_DIR/dataset.jsonl"
mkdir -p "$EVAL_DIR/workdir" "$EVAL_DIR/repos"

command -v docker >/dev/null || die "docker not found"
python -c "import multi_swe_bench" 2>/dev/null \
  || die "multi_swe_bench not installed. Run: pip install multi-swe-bench"

# Dataset = the full instance records (need test_patch + f2p/p2p for grading).
: > "$DATASET"
for j in "$INST_DIR"/*.json; do node -e 'process.stdout.write(JSON.stringify(require(process.argv[1]))+"\n")' "$j" >> "$DATASET"; done
log "dataset: $(wc -l < "$DATASET") instances -> $DATASET"

read -r -a ARM_LIST <<< "$ARMS"
for arm in "${ARM_LIST[@]}"; do
  # Assemble the per-arm patch jsonl from the per-(instance,arm) records.
  patch="$PATCH_DIR/${arm}.jsonl"
  : > "$patch"
  for rec in "$RAW_DIR"/*__"${arm}"/patch.jsonl; do
    [ -e "$rec" ] && cat "$rec" >> "$patch"
  done
  [ -s "$patch" ] || { log "skip $arm (no patches)"; continue; }
  out="$RESULTS_DIR/$arm"; mkdir -p "$out/logs"
  cfg="$EVAL_DIR/config.${arm}.json"
  node -e '
    const fs=require("fs");
    const [,,patch,dataset,workdir,repos,out]=process.argv;
    const cfg={
      mode:"evaluation",
      workdir, repo_dir:repos, need_clone:true, force_build:false,
      patch_files:[patch], dataset_files:[dataset],
      output_dir:out, log_dir:out+"/logs", log_level:"INFO",
      clear_env:true, stop_on_error:false,
      max_workers:2, max_workers_build_image:2, max_workers_run_instance:2,
      global_env:[], specifics:[], skips:[],
    };
    fs.writeFileSync(process.argv[8], JSON.stringify(cfg,null,2));
  ' "$patch" "$DATASET" "$EVAL_DIR/workdir" "$EVAL_DIR/repos" "$out" "$cfg"
  log "evaluating arm=$arm (config: $cfg)"
  python -m multi_swe_bench.harness.run_evaluation --config "$cfg" \
    || log "harness returned nonzero for $arm (check $out/logs)"
  log "report: $out/final_report.json"
done
