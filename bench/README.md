# ensemble vs standard-pi benchmark

A small, cheap cross-language benchmark that measures what the bash sidekick or ensemble
`explore` tool is supposed to buy: **resolving real issues for fewer tokens**. It runs the
same agent + model on the same [Multi-SWE-bench](https://github.com/multi-swe-bench/multi-swe-bench)
instances under different benchmark arms and grades the patches with the
official Docker eval harness.

## Latest results — base/002 seed 1 (oca/gpt-5.5)

**What we're doing.** The expensive lead model spends roughly half its turns on read-only
exploration (grep/read) and on build/test runs. We try to move that work onto a cheap sidekick
to cut lead-model cost **without losing correctness**. Three arms: `classic` (pre-ensemble
baseline, raw bash), `classic-graphify` (lead drives the graphify graph itself via a hard
directive), `classic-graph-bash` (graph-backed `explore` + bash verdict digests on a cheap
sidekick). We count **only real fixes** (patches that pass the Docker eval, `resolved=1`) and
ask the candidate to be **strictly better** than classic: resolve a superset and cost no more
on the fixes both make (methodology: `docs/requirements.md` §REQ-002, §REQ-003).

**Set:** 30 balanced instances, **seed 1** of the in-progress multi-seed `base/002`. Resolved:
`classic` **22/30**, `classic-graphify` **25/30**, `classic-graph-bash` **24/30**; 25 instances
resolved by ≥1 arm. The plots are per-benchmark — one row each, a bar per arm (mean cost), a dot
per individual run; **only the arms that passed a benchmark are drawn**. The dashed line is each
arm's mean over its own passes, labelled with how many it resolved. Regenerate with
`node lib/plot-results.mjs`.

![Cost per benchmark](plots/cost.svg)

**Cost** — mean over each arm's passes: `classic` **$0.411**, `classic-graphify` **$0.580**
(**+41%**), `classic-graph-bash` **$0.323** (**−21%**). graph-bash is the shortest bar on almost
every row; lead-driven graphify is the longest on most (its "always build the graph" directive
inflates context), so on a balanced pool it is *not* cheaper than the raw baseline.

![Token cost per benchmark, input + cached](plots/tokens.svg)

**Tokens scaled by price** (input ×$5/Mtok solid, cached ×$0.5/Mtok faded). Mean input+cached:
`classic` **$0.283**, `classic-graphify` **$0.424**, `classic-graph-bash` **$0.217**. graph-bash
cuts both legs on nearly every benchmark, which is where its cost lead comes from. (Remaining gap
to the cost plot is output tokens at $30/Mtok, excluded here.)

![Cost on classic's wins only](plots/cost-vs-classic.svg)

**Strict-domination view — on the 22 benchmarks `classic` resolves:** both candidates also
resolve **all 22** (zero regressions), and `classic-graph-bash` solves them at **−25% cost**
while `classic-graphify` costs **+31%**. So graph-bash strictly dominates classic here (same
fixes + 2 more, cheaper); graphify is the most *correct* arm (25/30) but the most expensive.

#### Successful instances (resolved by ≥1 arm) — cost per arm ($, "—" = arm did not resolve it)

| benchmark | classic | classic-graphify | classic-graph-bash |
|---|---|---|---|
| dayjs-2399 | $1.040 | $1.238 | $0.410 |
| zstd-3438 | $0.898 | $1.692 | $0.627 |
| core-11694 | $0.893 | $0.654 | $0.145 |
| simdjson-2178 | — | $1.075 | $0.583 |
| ponyc-4593 | — | $0.784 | $0.406 |
| logstash-17021 | — | $0.768 | — |
| grpc-go-3351 | $0.490 | $0.471 | $0.387 |
| grpc-go-3258 | $0.480 | $0.759 | $0.419 |
| fd-1394 | $0.469 | $0.451 | $0.084 |
| clap-5873 | $0.462 | $0.546 | $0.450 |
| core-11761 | $0.450 | $0.500 | $0.367 |
| jq-3238 | $0.444 | $0.498 | $0.877 |
| tracing-2897 | $0.433 | $0.551 | $0.268 |
| dayjs-2532 | $0.397 | $0.815 | $0.408 |
| bytes-732 | $0.355 | $0.379 | $0.289 |
| github-readme-stats-2844 | $0.316 | $0.479 | $0.276 |
| core-11680 | $0.315 | $0.378 | $0.328 |
| jq-2919 | $0.312 | $0.563 | $0.333 |
| core-11813 | $0.222 | $0.258 | $0.111 |
| zstd-3942 | $0.219 | $0.239 | $0.194 |
| bat-3189 | $0.212 | $0.220 | $0.083 |
| go-zero-2787 | $0.211 | $0.238 | $0.046 |
| darkreader-7241 | $0.185 | $0.488 | $0.406 |
| rayon-986 | $0.122 | $0.192 | $0.161 |
| express-5555 | $0.115 | $0.267 | $0.102 |
| **mean over passes** | **$0.411** (n=22) | **$0.580** (n=25) | **$0.323** (n=24) |

#### On classic's wins only (the 22 benchmarks classic resolved)

| arm | also resolved | mean cost on its wins | Δ vs classic |
|---|---|---|---|
| classic | 22/22 | $0.411 | — |
| classic-graphify | 22/22 | $0.540 | +31.3% |
| classic-graph-bash | 22/22 | $0.308 | **−25.1%** |

**Caveats:** seed 1 of an in-progress 2-seed run (`resolved` is pass@1 so far; per-instance cost
is noisy). The historical single-seed benchmarks-20 milestone (graph-bash 11/20 ⊇ classic 8/20)
is recorded in `docs/experiments.md`.

## Benchmark Arms

| Arm | Flags | What it isolates |
|-----|-------|------------------|
| `classic` | `--exploration classic` + raw bash output | baseline: pre-ensemble pi (read/grep/find/ls) |
| `classic-bash` | `--exploration classic` + bash sidekick output digest | bash digest only, with classic file exploration |
| `classic-graph-bash` | `--exploration sidekick` + graphify graph prebuilt + bash sidekick output digest | graph-backed explore with bash digest |
| `classic-graph` | `--exploration sidekick` + graphify graph prebuilt, asserted graph-derived | graph-backed explore |
| `sidekick-fs` | `--exploration sidekick`, graphify forced unavailable | same tool, filesystem fallback |

Legacy names still work for old runs: `graph-bash` = `classic-graph-bash`,
`ensemble-strict` = `classic-graph`.

> **Strict mode is genuinely enforced via `PI_REQUIRE_GRAPH=1`** (FS-001 §7.4 required-graph
> — an env var, not a CLI flag). With it set, pi fail-fasts at startup if graphify isn't
> enabled and `explore` throws rather than ever falling back (`explore.ts:842`, `main.ts:592`).
> The `classic-graph` and `classic-graph-bash` arms set it and prebuild the graph; `lib/parse-session.mjs`
> additionally asserts every `explore` call was graph-derived as a belt-and-suspenders check
> (`strictOk`).

## Prerequisites

- `graphify` on `PATH` (for graph arms) — present at `~/.local/bin/graphify`.
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

# 3. Real runs (all instances x all arms), then Docker grade + collect automatically:
./run-all.sh                                    # MODEL/ARMS overridable from env
```

Useful flags:

```bash
./run-all.sh --langs cpp,js --arms classic,classic-bash
./run-all.sh --instances simdjson__simdjson-2178 --arms classic,classic-bash
./run-all.sh --csv /tmp/bench-instances.csv --arms classic,classic-bash
BENCH_LANGS='cpp js' ARMS='classic-bash classic' ./run-all.sh
BENCH_INSTANCES='simdjson__simdjson-2178,sveltejs__svelte-15115' ./run-all.sh

NO_CLASSIC=1 ./run-all.sh        # run configured arms except classic
REUSE_CLASSIC=1 ./run-all.sh     # skip classic agent runs, but keep old classic rows
SKIP_EVAL=1 ./run-all.sh         # skip Docker grading; collect from existing reports if present
REUSE_EVAL=1 ./run-all.sh        # run agents, but keep existing final_report.json per arm
```

Stable 20-case benchmark:

```bash
./run-all.sh --csv benchmarks-20.csv --arms classic,classic-bash,classic-graph-bash,classic-graph
```

Rerun one fixed benchmark and update only that benchmark's current number:

```bash
./run-all.sh --instances clap-rs__clap-5873 --arms classic-graph-bash
node collect.mjs
```

Prebuilt sweeps:

```bash
./run-hard.sh          # curated mixed-language hard cases
./run-hard-diverse.sh  # large mixed-language repos, including jq/zstd/ponyc C coverage
./verify-batch-2-graphify.sh  # graphify-only preflight for batch 2
./run-batch-2.sh      # batch 2: C-only sweep across jq, zstd, and ponyc
./verify-batch-3-graphify.sh  # graphify-only preflight for batch 3
./run-batch-3.sh      # batch 3: known graph-win cases
./run-hard-all.sh      # run-hard + run-hard-diverse
```

The headline is the `collect.mjs` summary: **resolved-rate and $/run & tokens/run per
arm.** If `classic-bash` resolves the same issues as `classic` at lower tokens/cost,
that's the isolated bash-sidekick win. If `classic-graph` resolves the same issues as
`classic` at lower tokens/cost, that's the graph-explore win.

`run-all.sh` invokes `eval/run-eval.sh` after real runs (skipped for `DRY_RUN=1`) and then
runs `collect.mjs`, so `results/results.csv` is produced immediately. `eval/run-eval.sh` can
still be run directly to re-grade existing patches.

## Cost

Tiny by design. ~$0.5–2 per agent run on gpt-5.5; 4 instances × 3 arms ≈ **$6–25**.
It scales linearly — 50 instances would be $100+. Keep `instances/` small.

## Layout

```
config.sh            knobs: MODEL, ARMS, pricing, paths
fetch-instances.mjs  HF datasets-server -> instances/<id>.json
run-instance.sh      one (instance, arm): clone@sha, graphify, agent, diff, metrics
run-all.sh           loop instances x arms, then Docker grade + collect
lib/build-prompt.mjs resolved_issues -> leak-free problem statement
lib/parse-session.mjs session jsonl -> tokens/cost/turns + strict assertion
lib/inst-env.mjs     instance json -> shell vars
eval/run-eval.sh     wraps multi_swe_bench.harness.run_evaluation
collect.mjs          metrics + final_report.json -> results.csv + summary
work/  raw/  raw-history/  patches/  instances/  results/   (generated; git-ignored)
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
  NOTE.txt                 (classic/classic-bash arms — no explore sidekick; base prompt pinned by commit)
session/*.jsonl        all LEAD-agent turns + tool calls
explore-debug.jsonl    all SIDEKICK tool calls (PI_EXPLORE_DEBUG=full; sidekick arms only)
agent.out / agent.err  logs
graphify.log           initial graph build log (strict arm)
graphify-watch.log     continuous graph update log (strict arm)
metrics.json           tokens/cost/turns/strict     patch.diff / patch.jsonl
```

So each run carries **both prompts + all tool calls (lead & sidekick) + logs, linked to a
commit**. Prompts are dumped from source via `lib/dump-prompts.mjs` (which imports the exported
`exploreSidekickSystemPrompt` / `createExploreToolDefinition`), so they match the committed code
exactly. `manifest.json.dirty=true` warns that the tree had uncommitted changes — commit before
runs you intend to publish, so `commit` fully pins the prompts. Archive a set with
`snapshots/<name>/` (tracked; the live `raw/` is git-ignored).

Reruns are preserved automatically. Before `raw/<id>__<arm>/` is replaced, the previous bundle is
moved to `raw-history/<id>__<arm>/<timestamp>/`. Docker validation writes
`results/validation/<arm>/<id>.json`; older validation records and overwritten arm-level reports
are copied under `results/history/`. `collect.mjs` reads these per-instance validation records, so
partial reruns update only the rerun benchmark's resolved number.

## Caveats

- **graphify language coverage** — verify it produces a non-trivial `graph.json` for each
  language (`run-instance.sh` warns if not). If a language yields an empty graph,
  `classic-graph` ≡ `sidekick-fs` for it and the comparison is void there.
- The agent is told not to touch test files; the grader applies the instance's own
  `test_patch`. Strict runs keep graph artifacts under `raw/<id>__<graph-arm>/graphify/`
  and update them with `graphify watch`; `graphify-out/` is also excluded from the captured
  patch as a fallback.
- The eval harness config field names are verified against the current
  `multi-swe-bench` `CliArgs` schema (`mode`/`workdir`/`patch_files`/`dataset_files`/
  `log_dir` are the required ones); bump `eval/run-eval.sh` if the harness schema changes.
