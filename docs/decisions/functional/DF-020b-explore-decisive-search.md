# DF-020b-explore-decisive-search: for understanding/flow tasks, answer the whole local call-chain in one decisive response (compact pointers, not more source) and stop probing once answerable

**Status: ADOPT (cost) — but the full run exposed a correctness cost on case-set bugs; refine before
freezing (§DF-023-merge-016-017-018-020b-full-run).** In the K=3 merge, DF-020b's cost win held, but the
"once you can answer, **stop searching**" clause is the most consistent cause of two full-set regressions on
**content-not-location / case-set** bugs — **jq-3238 3/3→1/3** (edits the right file `src/builtin.c`; the fix
is just incomplete — a §DF-010 subset-fix) and **simdjson-2178 2/3→1/3**. Recommended fix: gate the
stop-clause **off failing-test / bug-fix tasks** (let §DF-008 root-cause tracing take precedence — case-set
bugs need *more* probing, not less); keep the directive for pure understanding/flow. See §DF-023.4.

**Status (prior): ADOPT — DF-020b v1 is win #2 (with §DF-016) for the merge-3-wins run.** At K=3 the broad v1
directive cuts cost **−12 to −22%** on every retry-heavy target, controls flat, and **grpc (the watch) holds
3/3** — so the v2 1-seed "grpc failed" and "dayjs-2399 over-trigger (+115%)" headlines were both seed noise,
and the v2 gate tightening is **unneeded** (do not ship it). The lone K=3 blemish — simdjson **0/3** — was
itself seed noise: a fresh **K=5 disambiguation resolved 3/5**, so v1's simdjson record is **3/8 over 8
seeds (~38%)** vs base **2/3 (~67%)** — a lower point estimate but **not distinguishable** (simdjson is the
single instance §REQ-005 documents as flipping between identical-code runs; both samples are tiny; Fisher's
exact ≈ n.s.), and the directive does not even engage there (no call collapse). **No hard regression; merge
v1.** Residual note: simdjson stays the seed-fragile instance — watch it on the full run, not a blocker.
Earlier K=1 framing retained below for the record.

**Status (prior): INCONCLUSIVE at K=1 — next: re-run v1 (broad) at K=3, scoped (queued, not yet run).** Two
1-seed screens gave opposite headlines on pure seed variance (v1 −40 to −63% on 5/6; v2 wins gone, grpc
3/3-at-base failed once), which is exactly why §REQ-005-research-checkpoints.0 now forbids single-seed
screens. **Decision: re-run the broad v1 directive at K=3 on the scoped set** (branch
`exp/explore-decisive-v1` @ `8c5bfac5a5`); **v2 is parked** (its gate fix removed the real dayjs-2399
over-trigger, but it also shrank the wins and may have starved grpc — revisit only if v1@K=3 confirms a
win worth tightening). Re-aim of the rejected §DF-020a (whiff-robustness was a
no-op: the sidekick navigates via `search`/`source_slice`, not `graph_query`/`graph_explain`). Grounded
per §REQ-001-decision-log; targets the explore re-ask storm measured on base/003 (grpc-go-3258,
simdjson-2178: 12–15 lead explore calls, ~15 internal `search`/`source_slice` ops each); relates to
§DF-008-explore-root-cause-tracing (bug-fix tracing), §DF-016-explore-anchor-validation-on-analogous-fix
(targeted prompt directive that worked), and is gated against §DF-015-explore-return-source-on-code-intent
(forcing more SOURCE backfired on cost — this returns more STRUCTURE, explicitly not more source).

## 1. Problem

On the retry-heavy set the lead makes **12–15 explore calls per instance**, each triggering ~15 internal
`search`/`source_slice` ops in the sidekick (grpc-go-3258: 15 lead calls / 166 internal; simdjson-2178: 15
/ 256). The original trace showed the lead **circling the same 3–5 entities 4–6 ways** (dns_resolver ×4,
ClientConn ×5, ccResolverWrapper/clientconn ×5 → a 48 KB whole-file dump, balancer ×6). The proximate
cause is in the sidekick prompt itself: for first-pass investigations it is told to return the minimal
edit site and *"the caller can ask a follow-up if needed"* (§FS-001-ensemble-explore.2.1.1). For
**chain-understanding** questions ("how does the resolver wire up", "where does this flow") that license
produces a narrow single-site answer that **obviously prompts the next hop** — so the lead re-asks, 15
times, and finally escalates to whole-file dumps. Each re-ask replays into cacheRead every later lead turn.

## 2. Decision (to validate)

Add one targeted directive to `exploreSidekickSystemPrompt` (graphify branch), firing only for
**understanding/flow** tasks (not single edit-site location, which stays minimal; not bug-fix, which
§DF-008 already covers). Per the §DF-015 lesson, blanket "return more" backfires, so this is narrowly
gated and returns **structure, not source**:

> When the task is to UNDERSTAND how code works, flows, or connects (a "how/where/why does X …" question,
> or tracing a call path / resolver / data flow rather than locating one edit site), be DECISIVE: answer
> the whole **local chain in ONE response** — the central function plus the adjacent hops on the relevant
> path (its key caller(s) and callee(s)) — each as a compact `path:line — one-line role` pointer, with at
> most the single most relevant excerpt. Anticipate the obvious next hop so the caller need not re-ask it.
> This overrides the "let the caller ask a follow-up" minimality for understanding tasks; it does NOT
> raise the excerpt budget — give more **pointers**, not more source. Once you can answer, **stop
> searching**; do not keep probing the same area.

Change is confined to `explore.ts` (prompt only). The expected effect is **fewer lead explore calls**
(15 → single digit) at roughly flat per-answer bytes (pointers are cheap), so net cacheRead replay drops.

## 3. Validation (planned)

Worktree `exp/explore-decisive-search` off `base/current` (= `base/003-base002-30`), change only
`explore.ts`, re-run `classic-graph-bash` (cheap 1-seed screen) on:

- **Targets (retry-heavy):** grpc-go-3258, simdjson-2178, dayjs-2532, dayjs-2399.
- **Controls (no-regression):** clap-5873, express-5555 (already converge in 1–7 lead calls).

**Metrics:** lead explore-call count and cost vs base/003 on targets; correctness unchanged on all six;
cost flat on controls. **PASS gate:** lead explore calls drop on the retry-heavy targets with cost
flat-to-down and no correctness regression; controls stay flat. **Watch (the §DF-015 failure mode):** the
"answer the whole chain" directive must not over-trigger on edit-site tasks and inflate per-answer bytes —
the controls (which are not understanding tasks) catch that. If it over-triggers or backfires on cost, the
directive's gate is too broad; tighten or reject.

### Result — SCREENED (promising, 1 seed vs base/003); gate too broad on cross-cutting bugs

`classic-graph-bash`, 1 seed. Correctness **6/6**. The re-ask loop collapsed on the linear-chain targets;
one cross-plugin instance over-triggered.

| instance | lead calls (base-behavior → b) | base/003 $ (3-seed mean) | DF-020b $ | Δ |
|---|---|---|---|---|
| grpc-go-3258 | 15 → **8** | $0.67 | $0.38 | **−43%** |
| simdjson-2178 | 15 → **9** | $1.03 | $0.62 | **−40%** |
| dayjs-2532 | 12 → **5** | $0.59 | $0.32 | **−46%** |
| clap-5873 (ctrl) | 7 → **2** | $0.43 | $0.16 | **−63%** |
| express-5555 (ctrl) | 1 → **1** | $0.09 | $0.06 | −33% |
| **dayjs-2399** | 8 → **12** | $0.60 | $1.29 | **+115%** ⚠ |

**Root cause of the dayjs-2399 regression.** Its bug is **cross-plugin** (utc / timezone / locale /
badMutable / core index.js) — there is no single "local chain". The clause *"anticipate the obvious next
hop"* + "return the whole chain" makes the sidekick **expand** into adjacent subsystems (each next hop
opens another plugin), so the lead chases more leads: products grew 11.5 KB → 20.4 KB and calls 8 → 12.
On the linear chains (grpc resolver wiring, simdjson parser path) the same directive converges and wins.

**Tightening (v2, to re-screen).** Narrow the gate and remove the expansion driver: fire only when the
caller names a **concrete** symbol / function / path (not an open-ended "how does this whole feature
work"); answer **only that path** (named function + immediate caller/callee hop on it); **do NOT volunteer
adjacent subsystems / plugins / files** the caller did not ask about; if the answer genuinely spans
several subsystems, **name them in one line and let the caller pick** rather than fetching them all. Drop
"anticipate the obvious next hop". Re-screen on the same six; PASS gate now also requires **dayjs-2399 ≤
base** (no expansion).

### Next experiment (queued — DO NOT run until the machine is back): v1 broad directive @ K=3, scoped

Per §REQ-005-research-checkpoints.0 (no single-seed screens), get the verdict at K=3 on the broad v1
directive (the version with the big wins). Branch `exp/explore-decisive-v1` is pinned at the v1 commit
`8c5bfac5a5`. Scoped set = the retry-heavy targets + controls; compare against base/003's frozen 3 seeds.

```sh
git worktree add /home/vjovanov/p/ensemble-exp-decisive-v1 exp/explore-decisive-v1
# seed node_modules/instances/pristine as in bench/run-decisive-screen.sh, then:
cd /home/vjovanov/p/ensemble-exp-decisive-v1/bench
./multiseed.sh decisive-v1-3seed \
  --instances grpc__grpc-go-3258,simdjson__simdjson-2178,iamkun__dayjs-2532,iamkun__dayjs-2399,clap-rs__clap-5873,expressjs__express-5555 \
  --arms classic-graph-bash --seeds 3 --conc 4
```

**PASS gate:** pass@3 ≥ base on every instance (no correctness regression — watch grpc, which is 3/3 at
base) **and** mean cost down on the retry-heavy targets, controls flat. If it passes → DF-020b is win #2
(with §DF-016) toward the merge-3-wins full run. If grpc regresses at K=3 → the broad directive is unsafe;
fall back to evaluating v2 at K=3.

### Result v2 — gate fix worked on the target, but 1-seed screens hit the noise floor

`classic-graph-bash`, 1 seed (fresh seed vs v1). dayjs-2399 — the deliberate target — **fixed**, but the
v1 headline wins did not reproduce and grpc-go-3258 failed.

| instance | base/003 (3-seed) | v1 broad (calls/$) | v2 tight (calls/$) | resolved v2 |
|---|---|---|---|---|
| **dayjs-2399** | YYY, ~$0.60 | 12 / $1.29 | **8 / $0.36** | Y ✓ (over-trigger gone) |
| grpc-go-3258 | **YYY**, ~$0.67 | 8 / $0.38 | 7 / $0.49 | **N** |
| simdjson-2178 | YYN, ~$1.03 | 9 / $0.62 | 14 / $1.01 | Y |
| dayjs-2532 | YYY, ~$0.59 | 5 / $0.32 | 14 / $1.01 | Y |
| clap-5873 | YYY, ~$0.43 | 2 / $0.16 | 3 / $0.22 | Y |
| express-5555 | —, ~$0.09 | 1 / $0.06 | 2 / $0.07 | Y |

**Reading.** The one cleanly-attributable change — the dayjs-2399 gate — landed: 12→8 calls, −72% cost, no
expansion. But the v1→v2 swings on simdjson (9→14) and dayjs-2532 (5→14) **exceed any plausible directive
effect** — they are **seed noise**. Two single seeds now tell opposite headlines, and grpc (3/3 at base)
failed once in v2. **1-seed screens cannot decide this**; v1 and v2 differ by seed as much as by directive.
Either v2 over-tightened (starved grpc, shrank the wins) or it is all variance — indistinguishable at K=1.
**Next: a 3-seed run on the targets is required to get a real verdict**, per §REQ-005; or shelve DF-020b
as too seed-fragile given the modest absolute cost ($0.4–1.0) on this set. The v2 gate fix stands
regardless (it removed a real over-trigger).

### Result v1 — K=3 (the queued verdict): cost win confirmed, grpc safe; lone simdjson 0/3 on the seed-noise instance

`classic-graph-bash`, **K=3**, run from `exp/explore-decisive-v1` @ `8c5bfac5a5` (worktree
`/home/vjovanov/p/ensemble-exp-decisive-v1`), graded against the frozen `multiseed/base002` 3-seed base
(the canonical source of base/003's numbers; the `checkpoints/003-base002-30` freeze holds only 2 of those
seeds). Completed 2026-06-12T12:02Z.

| instance | base pass@3 | base $/run | v1 pass@3 | v1 $/run | Δ cost | correctness |
|---|---|---|---|---|---|---|
| grpc-go-3258 (watch) | **3/3** | $0.67 | **3/3** | $0.52 | **−22%** | **HELD ✓** |
| dayjs-2532 | 3/3 | $0.59 | 3/3 | $0.48 | **−19%** | held |
| dayjs-2399 | 3/3 | $0.60 | 3/3 | $0.53 | **−12%** | held (no over-trigger at K=3) |
| clap-5873 (ctrl) | 3/3 | $0.43 | 3/3 | $0.40 | −7% | flat |
| express-5555 (ctrl) | 3/3 | $0.09 | 3/3 | $0.11 | +$0.02 | flat |
| **simdjson-2178** | **2/3** | $1.03 | **0/3** | $0.81 | −21% | **REGRESSED ✗** |

**Reading.**
- **The cost win is real, not seed noise.** Every retry-heavy target drops −12 to −22% at K=3; controls
  flat. The big v1 headline from the 1-seed screen reproduces at 3 seeds.
- **grpc is safe at K=3.** The v2 1-seed run where grpc (3/3 at base) failed once was variance — at K=3 the
  broad directive holds grpc 3/3 while cutting it −22%. Likewise **dayjs-2399 holds 3/3 with no
  over-trigger** (−12%): the v1 1-seed "+115% expansion" and the worry that motivated v2's tightening were
  both seed noise, not a real gate failure. **This retires v2's reason to exist** — the broad v1 directive
  does not over-expand at K=3. (The v2 gate fix is harmless but unnecessary; do not ship the tighter gate.)
- **The lone failure is simdjson 0/3.** Per the PASS gate ("pass@3 ≥ base on *every* instance"), this blocks
  a clean pass. But the evidence points to the instance's own noise, not the directive: simdjson is the one
  case §REQ-005 documents as flipping between identical-code runs (base itself is only 2/3), it is a
  **content-not-location** bug with no clean "local chain" for the directive to answer, and the directive's
  signature **does not appear** there — explore-call counts are `14/9/9` (v1) vs `6/13/10` (base), i.e. **no
  decisive collapse** (contrast grpc, where the loop collapses 15→8), and patch sizes are comparable
  (362/290/200 vs 320/148/200). So the directive barely engages on simdjson; the 0/3 is most consistent
  with bad luck on the pre-existing seed-flippy instance.

**Verdict.** Win #2 (with §DF-016): real cost cut where it fires, grpc safe, v2's concerns retired. The lone
simdjson 0/3 was disambiguated and is seed noise — see below.

### Disambiguation — simdjson K=5 (settles the K=3 0/3)

Ran simdjson-2178 alone at **K=5** on the same v1 worktree (`decisive-v1-simdjson-k5`), completed
2026-06-12T13:26Z. Result: **3/5 resolved** (s1✓ s2✓ s3✗ s4✗ s5✓), mean **$0.94/run** (still ≤ base $1.03).

Combining with the K=3 run's 0/3, v1's full simdjson record is **3/8 ≈ 38%** vs base **2/3 ≈ 67%**.

- The K=3 **0/3 was seed noise**, not a hard regression: the same code resolves simdjson 3 of 5 on a fresh
  batch. A 0/3 draw at a ~38% per-seed rate happens ~24% of the time — unlucky, not broken.
- v1's 38% is a **lower point estimate** than base's 67%, but the two are **not statistically
  distinguishable**: simdjson is the one instance §REQ-005 documents as flipping between *identical-code*
  runs (base's own 2/3 is a noisy 3-seed point), the samples are tiny, and Fisher's exact on 3/8 vs 2/3 is
  ≈ n.s. The directive also does not engage on simdjson (no call collapse — `14/9/9` then `12/5/7/6` explore
  calls, like base), so there is no mechanism for it to systematically hurt this content-not-location bug.
- **Decision: merge v1 as win #2.** Correctness ≥ base on 5/6 with grpc held 3/3; simdjson is noise-equal,
  not regressed. **Residual watch:** simdjson stays the seed-fragile instance — track it on the full
  merge-3-wins run; if it trends below base there with the call-collapse signature, only then gate the
  directive off content-not-location bugs (no local chain). v2's whole-gate tightening remains unnecessary.
