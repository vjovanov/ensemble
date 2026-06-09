Requirements: rules every change must satisfy. Each item is a `REQ-` declaration; cite as `§REQ-NNN-slug`.

# REQ-001-decision-log: Decisions are grounded in benchmark evidence

We change ensemble behavior experiment-first. Every behavioral or design choice is
driven by a concrete benchmark observation, and is recorded so the reasoning survives —
both **what** we chose and the **evidence** that drove it. A choice we cannot tie to a
benchmark result is a guess, not a decision.

## 1. Every decision carries its example

Each decision (a `DF` or `DA` declaration) MUST cite its evidence:

- **which benchmark** — the run, the instance(s), and the arm(s) compared, and
- **what happened** — the metric or behavior observed that the decision responds to.

A decision without a benchmark example is not grounded. Record the example, or do not
record the decision as settled.

## 2. Where decisions live

- Product-behavior decisions and tradeoffs: `docs/decisions/functional` (`DF`).
- Architecture decisions and tradeoffs: `docs/decisions/architectural` (`DA`).

Every experiment — a benchmark run intended to inform a choice — must end in a decision
(`DF`/`DA`) so the result is not lost. This is enforced as a working rule in `AGENTS.md`.

# REQ-002-benchmark-comparison-methodology: Compare only real fixes; always analyze correctness regressions

A cheaper run that does not fix the issue is not a saving — it is a failure that happens
to be cheap. So cost and token comparisons are valid only between runs that actually
resolve the instance (pass eval, `resolved=1`). This methodology governs every benchmark
comparison; cite it as `§REQ-002-benchmark-comparison-methodology`.

The comparison is always **the candidate arm vs the `classic` baseline**. The candidate —
the real win we optimize and claim — is **`classic-graph-bash`** (graph and bash combined).
The `classic-graph` (graph-only) and `classic-bash` (bash-only) arms exist **only for
orientation**: to decompose how much each lever contributes. They are not deployment targets
and never a fallback — graph and bash are meant to compound, so we do not "route to
graph-alone." Savings and regression analysis below are always about `classic-graph-bash`.

## 1. Which instances count toward savings

Compute cost/token savings **only on instances the candidate resolves** — i.e.
**resolved by both classic and the candidate, or resolved by the candidate only**. An
instance the candidate does not resolve contributes nothing to a savings number; never let
a cheap-but-unsolved run inflate the result.

## 2. Always analyze candidate regressions

Instances that **classic resolves but the candidate does not** are correctness
regressions. They MUST always be analyzed and root-caused — never silently dropped. They
are the cost of adopting the candidate and gate any savings claim: a savings figure must
be reported alongside the count and analysis of these regressions.

## 3. Instances neither arm resolves

Out of scope for the comparison (they measure task difficulty, not the candidate). Report
the count, but they do not enter savings or regression analysis.

## 4. Cheap-give-up is a regression, not a saving

A run that gathers explore evidence and then concludes without acting — **0 edits, 0 test
runs, empty patch, unresolved** — is the cheap-give-up failure (nushell-13870: graph-bash
empty patch at $0.14 vs classic's 114-line fix at $1.04). Its low cost MUST be scored as a
correctness regression per §2, never as a saving. The empty-patch / explore-only signature is
the detection rule; see §DF-006-explore-giveup-and-supplement-guard.

# REQ-003-strictly-better-than-baseline: A modification ships only if it strictly dominates classic

A modification (the candidate, e.g. `classic-graph-bash`) is adopted **only if it is
strictly better than the `classic` baseline** — never merely cheaper. "Strictly better"
means it **Pareto-dominates** classic on the §REQ-002-benchmark-comparison-methodology
metrics: it gives up nothing on correctness and wins on cost (or correctness), with at
least one strict improvement. Cite as `§REQ-003-strictly-better-than-baseline`.

## 1. The bar (both must hold)

1. **No correctness regression (hard gate).** The candidate must resolve a **superset** of
   what classic resolves: every instance classic fixes, the candidate must also fix. Losing
   even one classic-resolved instance fails the bar outright, regardless of cost.
2. **A real win.** With correctness non-regressed, the candidate must be strictly better on
   at least one axis: resolve **more** instances than classic (unique wins), and/or cost
   **less** on the resolved-by-both set (§REQ-002-benchmark-comparison-methodology.1). A
   candidate that resolves no more and costs the same or more is not better.

## 2. Consequence

A modification that fails either condition is **not adopted** — it is sent back as an open
problem (a `DF`/`DA` with the failing benchmark), not shipped. Cheaper-but-resolves-fewer is
a regression, not progress.

## 3. Example (why this rule exists)

On the benchmarks-20 run (complete per-instance validation): `classic` resolved **8/20**.
`classic-graph` (graph-only) resolved **7/20** and **lost `svelte-15115` and `zstd-3438`**
(both resolved by classic) — a correctness regression — so under this requirement it is
**rejected** regardless of any cost gain. `classic-graph-bash` resolved **11/20**: a
**superset** of classic's 8 plus **3 unique wins** (`nushell-13870`, `ponyc-4593`,
`jq-2840`) with **zero regressions** — it clears the correctness gate (§1.1) and resolves
more (§1.2), so it passes; the cost-on-resolved-by-both check then settles the cost axis.

Caveat that motivated this rule: an earlier read off a *partial* (6-instance) eval report
showed graph-bash at "5/20 with regressions" and would have rejected it — only the
complete, correctness-filtered data showed it actually dominates. Always compare on the
full resolved set, never a partial report.

# REQ-004-experiment-hygiene: Preserve results, one commit per experiment, track and re-verify

Experiments accrete knowledge only if their results survive and are traceable, and a change
is trustworthy only if it does not quietly break a related bench. Cite as
`§REQ-004-experiment-hygiene`.

## 1. Preserve previous results

Never overwrite a prior experiment's recorded results. Reruns archive the previous raw
bundle (`raw-history/`); A/B conditions are snapshotted to their own directory (e.g.
`cap-experiment/capoff` vs `capon`). Any `results`/validation an experiment relied on must
be captured before a later run can overwrite it.

## 2. One commit per experiment

Each experiment — a benchmark run plus its decision/analysis — is its own git commit, so the
git history *is* the experiment log. The message names the experiment and its outcome
(worked / failed / mixed) and references the `DF`/`DA` it produced.

## 3. Experiment ledger

Maintain `docs/experiments.md`: one dated row per experiment — what was tried, arms and
instances, outcome, and a link to the decision. The at-a-glance record of what we tried and
what worked; update it when an experiment lands.

## 4. Per-bench profile

Maintain `docs/bench-profiles.md`: the file types and shell commands (build/test/explore)
each instance uses, grouped by command/file profile. It defines which benches are *related*
(§5) and makes results interpretable (e.g. C/C++ graphify-weak vs JS/Java/Rust graphify-strong).

## 5. Re-verify related benches on change

When a change alters sidekick behavior, re-run the benches it could affect — those sharing
its language and command/file profile (§4) — and confirm no correctness regression before
adopting. This extends §REQ-003-strictly-better-than-baseline from one baseline to the
related set: a change that fixes one bench but breaks a sibling is not adopted.

## 6. The canonical baseline is immutable; experiments must not clobber `raw/`

`raw/` and `results.csv` are a **live working area** — every run overwrites the per-(instance,arm)
bundle. So a sweep that re-runs a subset (e.g. the cap A/B re-ran 8 `classic-graph-bash` instances at
64/128 KB) leaves `raw/` a *palimpsest*: one instance at cap128 next to others at default, and
`collect.mjs` then builds a `results.csv` that is not a single consistent run. This actually happened
and produced inverted numbers (clap "+156%" was a cap128 run; the canonical was −23%).

Rules:
- The headline benchmark run is snapshotted to an **immutable** dir (`raw-canonical/`) and is the
  source of truth for published numbers; `raw/` is never trusted for a headline without checking it
  against the snapshot.
- An experiment that re-runs a subset must **restore** the affected `raw/` bundles afterward (or run
  off its own snapshot dir), so `raw/`/`results.csv` always reflect one consistent run.
- Cross-arm integrity: a comparison is only valid when **all arms were run at the same commit**.
  Mixing a fresh arm with a stale baseline (the `classic` drift behind the `classic-graphify` −19%,
  §DF-007-lead-driven-graphify-skill.5) understates/overstates savings — re-run the baseline arm at the
  same commit before claiming a delta.

# REQ-005-research-checkpoints: A frozen base is the only comparison reference; explore in parallel, promote winners

Research advances by branching experiments from an immutable **base** and comparing every result
against the base's *frozen* numbers — never against live `raw/`. The contamination that inverted clap
to "+156%" (§REQ-004-experiment-hygiene.6) and the `classic` drift (§DF-007-lead-driven-graphify-skill.5)
both came from comparing across un-frozen runs; a frozen base eliminates the whole class. Cite as
`§REQ-005-research-checkpoints`.

## 0. Multi-seed is the verdict (not single runs)

Resolution is **seed-noisy**: the same code resolves a *different* 8–9 of 11 each run (simdjson and
tracing-2897 flipped between two identical-code runs). So a single run is not a verdict — every result
is **multi-seed**: run each (instance, arm) K times (default K=3). Report **pass@K** (resolved in ≥1 of
K = capability) and the resolved-rate; cost = mean over the resolved seeds. This is *cheaper long-run*
because it stops us chasing seed noise with prompt tweaks (the DF-008/DF-009 loop). `bench/multiseed.sh`.

**Reuse and don't-redo, to keep multi-seed cheap:**
- **Count existing runs as a seed.** An arm's existing `raw/` run (at the *current* code) counts as seed 1;
  multi-seed then only adds K−1 fresh seeds (`multiseed.sh --reuse <arms>`, per-arm — a stale-code run must
  not be reused, e.g. the DF-009 graph-bash run cannot seed a DF-008 base).
- **Don't re-run `classic`.** `classic` is code-invariant to the explore/bash changes (no explore sidekick,
  no digest), so it is multi-seeded **once** in the base and **reused** by every experiment — never re-run.
- **Arms tracked at multi-seed:** `classic` (baseline, once), `classic-graph-bash` (sidekick candidate),
  `classic-graphify` (lead-skill candidate). Experiments run only the candidate arm(s) they touch.

## 1. A base checkpoint = code tag + frozen multi-seed results

A base is a blessed commit with frozen **multi-seed** results: git tag `base/NNN-slug` (plus a moving
`base/current`), and `bench/checkpoints/<NNN-slug>/` holding the **lightweight** artifacts per
(instance, arm, seed) — `metrics.json`, `patch.diff`, `manifest.json`, the validation resolved record,
`results.csv`, and a `META` (commit, date, K, headline pass@K). Heavy `session/`/`graph.json` stay
local (gitignored). Given the tag you recover the exact code *and* its measured behavior, forever.
Create with `bench/checkpoint.sh <slug>`.

## 2. Experiments are SCOPED + multi-seed; full run only on success

Each experiment is a worktree off `base/current` on branch `exp/<slug>` (`bench/experiment.sh <slug>`),
changes **one thing** (a `DF`/`DA`), and — to stay cheap — runs **only the relevant cases × K seeds**:
the instances the change could **win** (its targets) plus the ones it could **lose** (regression-risk:
same language/command profile, §REQ-004-experiment-hygiene.5). It is judged by `bench/compare.sh`
**against the base's frozen multi-seed numbers** for those cases (pass@K), so parallel experiments at
different times stay valid. **Only if the scoped experiment passes** do we then do a **full run**
(all instances) before merging — never a full run per iteration.

## 3. Pick winners; combine; the base advances

An experiment ships only if strictly better than the base on its scoped multi-seed set
(§REQ-003-strictly-better-than-baseline: no pass@K regression, ≥1 gain or cheaper). Winners are
**combined** and validated together in **one full multi-seed run**; `bench/promote.sh <slug>` then
merges, cuts `base/NNN+1`, moves `base/current`, re-freezes. Loser: keep the `exp/<slug>` branch/tag
and its decision doc for the record; do **not** merge.

## 4. Tags

`base/NNN-slug` (immutable reference line) · `base/current` (latest) · `exp/slug` (endpoints, kept
win-or-lose so we never re-explore them).

## 5. Locked choices

Freeze **lightweight** (metrics + patch + manifest + validation; never session/graph blobs) — gittable,
and avoids the 5.2 M-insertion bloat the full-bundle cap-experiment commit caused. Checkpoints live
**in-repo** (`bench/checkpoints/`) for simplicity; revisit an orphan `results` branch only if they grow
large.
