# ensemble vs standard-pi benchmark

A small, cheap cross-language benchmark that measures what the bash sidekick or ensemble
`explore` tool is supposed to buy: **resolving real issues for fewer tokens**. It runs the
same agent + model on the same [Multi-SWE-bench](https://github.com/multi-swe-bench/multi-swe-bench)
instances under different benchmark arms and grades the patches with the
official Docker eval harness.

## Latest results — base/002 (oca/gpt-5.5, multi-seed)

**What we're doing.** The expensive lead model spends roughly half its turns on read-only
exploration (grep/read) and on build/test runs. We try to move that work onto a cheap sidekick
to cut lead-model cost **without losing correctness**. Three arms: `classic` (pre-ensemble
baseline, raw bash), `classic-graphify` (lead drives the graphify graph itself via a hard
directive), `classic-graph-bash` (graph-backed `explore` + bash verdict digests on a cheap
sidekick). We count **only real fixes** (patches that pass the Docker eval, `resolved=1`) and
ask the candidate to be **strictly better** than classic: resolve a superset and cost no more
on the fixes both make (methodology: `docs/requirements.md` §REQ-002, §REQ-003).

**Set:** 30 balanced instances under the multi-seed `base/002` (pass@K = resolved in any seed). We
compare on the **benchmarks `classic` resolves** and report the **total $ used** — the sum across
those benchmarks (and seeds: all $ used), not an average. All figures below are generated from the
data and **auto-refresh as seeds and the codex arm land** (`node lib/plot-results.mjs` for the
plots; `node lib/inject-readme.mjs` for the tables) — see the tables for exact, current numbers.

![Total cost on classic's wins](plots/cost.svg)

**Total cost.** `classic-graph-bash` is the cheapest in total; lead-driven `classic-graphify` is the
most expensive — its "always build the graph" directive inflates context, so on a balanced pool it
is *not* cheaper than the raw baseline.

![Total $ split by token type](plots/tokens.svg)

**Same total, split by token type** — input ×$5/Mtok + cached ×$0.5/Mtok + output ×$30/Mtok; this
reconciles to the cost graph. Output is few tokens but the priciest rate (~30% of the bill), which
is why the input+cached legs alone fall short. graph-bash cuts all three.

![Per-benchmark cost on classic's wins](plots/cost-vs-classic.svg)

**Per-benchmark.** graph-bash is the shortest bar on most rows but loses to classic on a handful —
mostly graph-noise cases (`jq-3238`, `darkreader-7241`). The *classic-capped where worse* row in the
table is the ceiling if graph-bash fell back to classic on those: the regressions are cheap, and the
worst are exactly what the explore noise-exclusion experiment targets.

<!-- AUTO:cost-tables -->
#### Total $ used on the 22 benchmarks classic resolves

| arm | resolved | input $ | cached $ | output $ | **total $** | Δ vs classic |
|---|---|---|---|---|---|---|
| classic | 22/22 | $3.87 | $2.37 | $2.80 | **$9.04** | — |
| classic-graphify | 22/22 | $5.15 | $3.56 | $3.17 | **$11.87** | 31.3% |
| classic-graph-bash | 22/22 | $3.06 | $1.54 | $2.17 | **$6.77** | -25.1% |
| graph-bash, classic-capped where worse | 22/22 | — | — | — | **$6.03** | -33.3% |

#### Per-benchmark cost on classic's wins ($)

| benchmark | classic | classic-graphify | classic-graph-bash |
|---|---|---|---|
| dayjs-2399 | $1.040 | $1.238 | $0.410 |
| zstd-3438 | $0.898 | $1.692 | $0.627 |
| core-11694 | $0.893 | $0.654 | $0.145 |
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
| **total** | **$9.04** | **$11.87** | **$6.77** |

(italic = arm ran but did not resolve that benchmark; "—" = no run)
<!-- /AUTO:cost-tables -->

### Where the money goes — spend attribution by source

To see *what* to optimize, we attribute each arm's spend to what produced it. For every assistant
turn the API bills `input + cacheRead` (the context read that turn) + `output` (what it generated);
we split those across the blocks present that turn, proportional to size, and sum per category over
classic's 22 wins. `classic`/`graphify` have no separate read tool — they read files by running
`ls`/`sed`/`rg`/`find` through **bash**, so we split bash by command (`bash:read` = file discovery,
`bash:build/test`, `bash:other`); `graphify`'s `graphify query` graph calls are counted as
`explore/graph`. Generated by `node lib/token-breakdown.mjs`. Two views (totals match the cost graph):

![Full spend by source](plots/breakdown-cost.svg)
![Context spend by source](plots/breakdown-context.svg)

<!-- AUTO:breakdown-tables -->
#### Full $ (input+cached+output) by source — over classic's wins

| source | classic | classic-graphify | classic-graph-bash |
|---|---|---|---|
| system+prompt | $1.35 | $1.72 | $1.64 |
| bash:read | $5.23 | $4.92 | $0.04 |
| bash:build/test | $0.37 | $0.56 | $0.41 |
| bash:other | $0.12 | $0.19 | $0.21 |
| explore/graph | $0.00 | $1.96 | $2.88 |
| edit | $0.63 | $0.80 | $0.56 |
| thinking | $1.17 | $1.52 | $0.87 |
| output | $0.17 | $0.21 | $0.16 |
| **total** | **$9.04** | **$11.87** | **$6.77** |

#### Context only (input+cached) by source — over classic's wins

| source | classic | classic-graphify | classic-graph-bash |
|---|---|---|---|
| system+prompt | $1.30 | $1.76 | $1.59 |
| bash:read | $4.42 | $4.31 | $0.01 |
| bash:build/test | $0.20 | $0.33 | $0.32 |
| bash:other | $0.03 | $0.05 | $0.09 |
| explore/graph | $0.00 | $1.85 | $2.34 |
| edit | $0.09 | $0.10 | $0.07 |
| thinking | $0.19 | $0.31 | $0.17 |
| **total** | **$6.24** | **$8.71** | **$4.60** |
<!-- /AUTO:breakdown-tables -->

**Reading it** (exact $ in the table above):
- **`bash:read` (file discovery) is the dominant cost** — ~58% of `classic`'s spend. This is the lead
  searching/reading source via shell, re-read into context every turn.
- **graph-bash replaces it with the explore sidekick**: `bash:read` collapses to ~zero, swapped for a
  smaller `explore/graph` (discovery done off the lead's context) — the source of its lead.
- **graphify is the most expensive because the graph *didn't replace* reading** — it still does
  `bash:read` **and** adds `explore/graph`. It pays for both.
- **build/test is tiny everywhere** — not a lever; the lead redirects build output to files.
- **Remaining levers**: for graph-bash, `explore/graph` (graph noise-exclusion) and the
  `system+prompt` overhead; for graphify, stop the lead's manual `bash:read` once it has the graph.

Method note: the split uses char/4 size estimates and the latest sessions, scaled to the seed-1
measured totals so all graphs reconcile; per-arm totals are exact, the split is approximate. codex
has no per-block session, so it is excluded from this view.

**Caveats:** multi-seed `base/002` (`resolved` is pass@K; per-instance cost is noisy). `graphify` is
the most *correct* arm but the most expensive. `codex` is an external reference (cost captured via
`cdx --json`, `lib/codex-metrics.mjs`); it auto-joins the cost graphs once its grade completes. The
historical single-seed benchmarks-20 milestone (graph-bash 11/20 ⊇ classic 8/20) is in
`docs/experiments.md`.

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
