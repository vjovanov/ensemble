# DF-016-explore-anchor-validation-on-analogous-fix: For "disallow/validate" tasks, anchor explore on the analogous existing diagnostic (analyze phase), not the feature's transform site

**Status: Proposed (correctness track, off base/003).** Grounded per §REQ-001-decision-log; targets the
lone pass@3 correctness miss in §REQ-005-research-checkpoints (base/003); relates to
§DF-008-explore-root-cause-tracing, §DF-010-explore-surface-test-caseset, §DF-006-explore-giveup-and-supplement-guard.

## 1. Problem

At pass@3 on base/003, `classic-graph-bash` resolves 25/26 of classic's wins; the lone miss is
**svelte-15115** (`classic-graphify` misses it identically — so it is graph-driven framing, not sidekick
digestion). It is a **JS/TS wrong-phase misdirection**, not a cost case:

- The task is *"disallow `$state`/`$derived` in `{@const}` tags"* — a **validation** (the grading test is a
  `tests/validator` case expecting a compile error).
- **classic (✓)** grep'd broadly, hit the sibling diagnostics (`rg "state_invalid_placement|rune_invalid_usage|effect_invalid_placement"`),
  recognized the fix class, and added a 13-line validation in `phases/**2-analyze**/visitors/CallExpression.js`.
- **graph-bash / graphify (✗)** reframed it as a runtime/codegen bug and wrote 106–121 lines in
  `phases/**3-transform**/.../ConstTag.js` — wrong phase.

Trace: EXPLORE #2 actually surfaced the right hint (*"analyze/index.js registers … CallExpression … ConstTag
calls `context.next()` so nested expressions are visited"*), but at EXPLORE #3 the lead **reframed** to
*"find transform code for ConstTag … why does `$derived` leak at runtime"* and committed to `3-transform`.
The sidekick then **obediently served transform code** (#3/5/6/8) instead of pushing back that a
*disallow* is a validation. The signal both missed: this fix mirrors an **existing sibling diagnostic** in
the analyze phase, not the feature's transform.

## 2. Decision (to validate)

Targeted addition to `exploreSidekickSystemPrompt` (graphify branch) — fires only for diagnostic tasks, so
it should not disturb behavior-fix cases (the §DF-015 lesson: blanket directives backfire):

> When the task is to **disallow / forbid / reject / validate / emit an error or warning** for some usage (a
> diagnostic, not a behavior change), the fix almost always mirrors an **existing sibling diagnostic** — added
> in the **analysis/validation** phase, not transform/codegen. Find how the nearest existing diagnostic of the
> same family is raised (search sibling error codes / validation helpers) and return THAT site and pattern as
> the edit target, even if the caller is asking about transform/runtime code.

## 3. Validation (planned)

Worktree `exp/explore-anchor-validation` off `base/current` (= `base/003-base002-30`), change only
`explore.ts`, re-run `classic-graph-bash` × 3 seeds on:
- **Target:** svelte-15115.
- **Controls (no-regression):** core-11694, dayjs-2399, express-5555, darkreader-7241 (JS/TS wins),
  plus jq-2919 (C, to confirm the diagnostic gate doesn't perturb non-validation bugs).

**PASS gate:** svelte-15115 resolves (≥1/3) **and** every control still resolves at its base rate and within
cost noise. **Watch (the §DF-015 failure mode):** that the directive does not over-trigger on non-diagnostic
tasks and inflate cost/turns on the controls.
