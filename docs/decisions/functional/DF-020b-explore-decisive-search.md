# DF-020b-explore-decisive-search: for understanding/flow tasks, answer the whole local call-chain in one decisive response (compact pointers, not more source) and stop probing once answerable

**Status: SCREENED (promising) — tightening the gate before adoption.** 1-seed screen: 6/6 correct,
−40 to −63% cost on five of six (the lead re-ask loop collapsed: grpc 15→8, simdjson 15→9, dayjs-2532
12→5, clap 7→2). One regression — **dayjs-2399 8→12 lead calls, +115% vs base** — the §DF-015 over-trigger
watch firing on a cross-plugin bug. Re-aim of the rejected §DF-020a (whiff-robustness was a
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
