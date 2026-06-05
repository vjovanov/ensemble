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

> **Strict mode is genuinely enforced via `PI_REQUIRE_GRAPH=1`** (FS-001 §7.4 required-graph
> — an env var, not a CLI flag). With it set, pi fail-fasts at startup if graphify isn't
> enabled and `explore` throws rather than ever falling back (`explore.ts:842`, `main.ts:592`).
> The `ensemble-strict` arm sets it and prebuilds the graph; `lib/parse-session.mjs`
> additionally asserts every `explore` call was graph-derived as a belt-and-suspenders check
> (`strictOk`).

## Prerequisites

- `graphify` on `PATH` (for `ensemble-strict`) — present at `~/.local/bin/graphify`.
- Docker running (for grading).
- `pip install multi-swe-bench` (provides the eval harness).
- Model creds in the env. Default is **gpt-5.5 via OpenRouter** (`PROVIDER=openrouter
  MODEL=openai/gpt-5.5`, needs `OPENROUTER_API_KEY`; ~$5/$30 per Mtok). Override
  `PROVIDER`/`MODEL` for anything else, e.g. `PROVIDER=openrouter MODEL=openai/gpt-5-mini`.

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

## Run bundle format

Every `(instance, arm)` run writes a self-describing bundle under `raw/<id>__<arm>/`,
pinned to the product commit it ran against:

```
manifest.json          commit (+ dirty flag), model/provider, arm, exploration, require_graph
prompts/
  lead-explore-tool.txt    the explore tool as the LEAD agent sees it (desc + guidelines + params)
  sidekick-graph.txt       explore sub-agent prompt, graph-backed mode
  sidekick-filesystem.txt  explore sub-agent prompt, filesystem-fallback mode
  NOTE.txt                 (classic arm only — no sidekick; base prompt pinned by commit)
session/*.jsonl        all LEAD-agent turns + tool calls
explore-debug.jsonl    all SIDEKICK tool calls (PI_EXPLORE_DEBUG=full; sidekick arms only)
agent.out / agent.err  logs    graphify.log   graph build log (strict arm)
metrics.json           tokens/cost/turns/strict     patch.diff / patch.jsonl
```

So each run carries **both prompts + all tool calls (lead & sidekick) + logs, linked to a
commit**. Prompts are dumped from source via `lib/dump-prompts.mjs` (which imports the exported
`exploreSidekickSystemPrompt` / `createExploreToolDefinition`), so they match the committed code
exactly. `manifest.json.dirty=true` warns that the tree had uncommitted changes — commit before
runs you intend to publish, so `commit` fully pins the prompts. Archive a set with
`snapshots/<name>/` (tracked; the live `raw/` is git-ignored).

## Caveats

- **graphify language coverage** — verify it produces a non-trivial `graph.json` for each
  language (`run-instance.sh` warns if not). If a language yields an empty graph,
  `ensemble-strict` ≡ `sidekick-fs` for it and the comparison is void there.
- The agent is told not to touch test files; the grader applies the instance's own
  `test_patch`. `graphify-out/` is excluded from the captured patch.
- The eval harness config field names are verified against the current
  `multi-swe-bench` `CliArgs` schema (`mode`/`workdir`/`patch_files`/`dataset_files`/
  `log_dir` are the required ones); bump `eval/run-eval.sh` if the harness schema changes.
