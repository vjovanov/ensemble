# DF-020b-explore-decisive-search: for understanding/flow tasks, answer the whole local call-chain in one decisive response (compact pointers, not more source) and stop probing once answerable

**Status: PROPOSED — cheap-screen scheduled.** Re-aim of the rejected §DF-020a (whiff-robustness was a
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

### Result — (pending screen)
