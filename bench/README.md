# ensemble vs standard-pi benchmark

A small, cheap cross-language benchmark that measures what the bash sidekick or ensemble
`explore` tool is supposed to buy: **resolving real issues for fewer tokens**. It runs the
same agent + model on the same [Multi-SWE-bench](https://github.com/multi-swe-bench/multi-swe-bench)
instances under different benchmark arms and grades the patches with the
official Docker eval harness.

## Latest results — benchmarks-20 (oca/gpt-5.5)

**What we're doing.** The expensive lead model spends roughly half its turns on read-only
exploration (grep/read) and on build/test runs. We move that work onto a cheap sidekick —
graph-based code discovery (`explore`) plus bash verdict digests — to cut lead-model cost
**without losing correctness**. The candidate arm is `classic-graph-bash` (graph + bash
combined); `classic` is the pre-ensemble baseline. We count **only real fixes** (patches that
pass the Docker eval, `resolved=1`) and require the candidate to be **strictly better** than
the baseline: resolve a superset of classic's instances and cost no more on the fixes both
make (methodology: `docs/requirements.md` §REQ-002, §REQ-003).

**Result: `classic-graph-bash` resolves 11/20 vs `classic`'s 8/20** — a superset (every
classic fix, plus 3 unique wins: `nushell`, `ponyc-4593`, `jq-2840`), **zero regressions** —
and is cheaper on the fixes both make: resolved-by-both **−10% cost / −20% tokens** (or
**−32% / −47%** excluding the two C-family losers `simdjson`/`jq-2919`). Every instance
graph-bash resolved:

| instance | classic (tok / $) | graph-bash (tok / $) | |
|---|---|---|---|
| clap-5873 | 199,138 / $0.26 | 142,921 / $0.20 | both |
| tracing-2897 | 834,799 / $0.95 | 209,256 / $0.38 | both |
| go-zero-2787 | 99,388 / $0.23 | 144,713 / $0.28 | both |
| simdjson-2178 | 451,378 / $0.72 | 982,210 / $1.15 | both |
| svelte-15115 | 488,804 / $0.57 | 163,540 / $0.33 | both |
| darkreader-7241 | 80,302 / $0.18 | 23,192 / $0.09 | both |
| zstd-3438 | 1,007,996 / $0.97 | 765,198 / $0.88 | both |
| jq-2919 | 144,221 / $0.22 | 202,397 / $0.40 | both |
| nushell-13870 | 1,023,608 / $0.95 ✗ | 914,978 / $1.12 | unique win |
| ponyc-4593 | 282,007 / $0.67 ✗ | 188,896 / $0.39 | unique win |
| jq-2840 | 655,314 / $0.72 ✗ | 412,973 / $0.52 | unique win |

`✗` = classic failed to resolve (its spend wasted). **Caveats:** single seed (n=1);
per-instance cost is noisy (`simdjson`, `jq-2919` are genuine losses, both C-family — the
known graphify-on-C/C++ weakness); the five cap-set rows' graph-bash cost is provisional
pending a clean re-pull.

## Cost & tokens per benchmark — `classic` vs `classic-graphify` vs `classic-graph-bash`

Per-benchmark lead-model spend across the three arms, restricted to **successful instances**
(resolved by at least one arm; all three arms ran each). One row per benchmark, three bars (one
per arm). A **solid** bar means that arm passed the instance, **hollow** means it failed or
isn't graded yet. The dashed vertical line is each arm's **mean over the instances it passed**;
the legend shows that mean and **how many it resolved** (`n=`). Regenerate with
`node lib/plot-results.mjs`.

![Cost per benchmark](plots/cost.svg)

**Cost.** Mean success cost per arm: `classic` **$0.459** (n=21), `classic-graphify` **$0.491**
(n=22), `classic-graph-bash` **$0.333** (n=22). On the big spenders (zstd-3438, dayjs, ponyc,
grpc-go) graph-bash's green bar is consistently the shortest; lead-driven graphify is the
longest on most rows (its "always build the graph" directive), tracking or exceeding the raw
baseline rather than beating it.

![Token cost per benchmark, input + cached](plots/tokens.svg)

**Tokens scaled by price** (input ×$5/Mtok solid, cached ×$0.5/Mtok faded). Mean input+cached
per arm: `classic` **$0.331**, `classic-graphify` **$0.351**, `classic-graph-bash` **$0.232**.
graph-bash cuts both legs on nearly every benchmark, which is where its cost lead comes from.
(Remaining gap to the cost plot is output tokens at $30/Mtok, excluded here.)

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
