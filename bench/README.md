# ensemble vs standard-pi benchmark

A small, cheap cross-language benchmark that measures what the ensemble `explore`
tool is supposed to buy: **resolving real issues for fewer tokens**. It runs the
same agent + model on the same [Multi-SWE-bench](https://github.com/multi-swe-bench/multi-swe-bench)
instances under three exploration strategies and grades the patches with the
official Docker eval harness.

## The three arms

| Arm | Flags | What it isolates |
|-----|-------|------------------|
| `ensemble-strict` | `--exploration sidekick` + graphify graph prebuilt, asserted graph-derived | graph-based explore |
| `sidekick-fs` | `--exploration sidekick`, graphify forced unavailable | same tool, filesystem fallback |
| `classic` | `--exploration classic` | pre-ensemble pi (read/grep/find/ls) |

> **"Strict mode" is enforced here, not in the CLI.** FS-001 §7.4 (required-graph)
> isn't implemented as a flag. Instead the `ensemble-strict` arm prebuilds the graph
> and `lib/parse-session.mjs` asserts every `explore` call was graph-derived — a run
> that fell back to the filesystem (marker `"Graphify unavailable"`, `explore.ts:617`)
> or never called `explore` is flagged `strictOk=false`.

## Prerequisites

- `graphify` on `PATH` (for `ensemble-strict`) — present at `~/.local/bin/graphify`.
- Docker running (for grading).
- `pip install multi-swe-bench` (provides the eval harness).
- Model creds in the env. Default `MODEL=openai.gpt-5.5` is **Bedrock-only** ($5.5/$33
  per Mtok) and needs AWS creds. Use `MODEL=gpt-5-mini` for cheap iteration.

## Run it

```bash
cd bench

# 1. Pick instances (one per language keeps it cheap). Preview, then fetch:
node fetch-instances.mjs --list                 # list language configs
node fetch-instances.mjs --list go              # preview go instances
node fetch-instances.mjs go 0                   # save instances/<id>.json
node fetch-instances.mjs rust 0 && node fetch-instances.mjs typescript 0 && node fetch-instances.mjs python 0

# 2. Dry run the plumbing first (no paid agent calls):
DRY_RUN=1 ./run-all.sh

# 3. Real runs (all instances x all arms):
./run-all.sh                                    # MODEL/ARMS overridable from env

# 4. Grade in Docker:
./eval/run-eval.sh

# 5. Collect:
node collect.mjs                                # -> results/results.csv + summary
```

The headline is the `collect.mjs` summary: **resolved-rate and $/run & tokens/run per
arm.** If `ensemble-strict` resolves the same issues as `classic` at lower tokens/cost,
that's the graph-explore win.

## Cost

Tiny by design. ~$0.5–2 per agent run on gpt-5.5; 4 instances × 3 arms ≈ **$6–25**.
It scales linearly — 50 instances would be $100+. Keep `instances/` small.

## Layout

```
config.sh            knobs: MODEL, ARMS, pricing, paths
fetch-instances.mjs  HF datasets-server -> instances/<id>.json
run-instance.sh      one (instance, arm): clone@sha, graphify, agent, diff, metrics
run-all.sh           loop instances x arms
lib/build-prompt.mjs resolved_issues -> leak-free problem statement
lib/parse-session.mjs session jsonl -> tokens/cost/turns + strict assertion
lib/inst-env.mjs     instance json -> shell vars
eval/run-eval.sh     wraps multi_swe_bench.harness.run_evaluation
collect.mjs          metrics + final_report.json -> results.csv + summary
work/  raw/  patches/  instances/  results/   (generated; git-ignored)
```

## Caveats

- **graphify language coverage** — verify it produces a non-trivial `graph.json` for each
  language (`run-instance.sh` warns if not). If a language yields an empty graph,
  `ensemble-strict` ≡ `sidekick-fs` for it and the comparison is void there.
- The agent is told not to touch test files; the grader applies the instance's own
  `test_patch`. `graphify-out/` is excluded from the captured patch.
- The eval harness config field names are verified against the current
  `multi-swe-bench` `CliArgs` schema (`mode`/`workdir`/`patch_files`/`dataset_files`/
  `log_dir` are the required ones); bump `eval/run-eval.sh` if the harness schema changes.
