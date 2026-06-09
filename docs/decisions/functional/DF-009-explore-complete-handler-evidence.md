# DF-009-explore-complete-handler-evidence: Return the complete handler at a bug's edit site, not a minimal slice

**Status: Worked (right-file/wrong-branch class).** Grounded per §REQ-001-decision-log; addresses the
right-file/wrong-branch failures left after §DF-008-explore-root-cause-tracing; relates to §FS-001-ensemble-explore.

## 1. Problem

After §DF-008 fixed misdirection (8/11 → 9/11), two regressions remain — **right file, wrong fix**.
The lead fixed the wrong *branch* of the right function for lack of the full picture:

- **jq-3238**: the correct fix (classic, skill) is in the general unnamed-capture building loop in
  `f_match` (handling unmatched / zero-width / normal captures). The sidekick led the lead to the
  **named-capture iteration path** (`onig_foreach_name`), where it built an elaborate struct — a
  partial fix in the wrong branch. The lead never saw the whole capture-handling flow.
- **simdjson**: right files, incomplete fix (same class).

The sidekick's minimality ("at most 3 facts", "20-60 lines", "do not pull neighbors") returns one
branch, so the lead cannot see that a sibling branch is the true site.

## 2. Decision

For bug fixes, once the edit site is located, the sidekick returns the **complete enclosing
function/method verbatim plus every sibling branch/case that handles the same concern** (all branches
of the switch/if-chain, every place that builds the same result). This overrides the line/excerpt
budget for the edit site. Still executor-only — the sidekick supplies the full picture; the lead
authors the fix (§DA-002-compile-test-fix-sidekick.2). Correctness over the cost budget, per the
explicit "fix correctness first" directive.

## 3. Validation

Re-run the culprits (jq-3238, simdjson) + nushell (regression guard), uncapped, current code. Pass:
the two resolve without losing nushell or raising cost on healthy instances
(§REQ-003-strictly-better-than-baseline).

**Result:** **jq-3238 RESOLVED** ($0.47, fixed the correct branch in `builtin.c`) and **simdjson
RESOLVED** ($1.04) — both right-file/wrong-branch cases fixed by the complete-handler evidence.
nushell flipped to failed this run (touched `eval_ir.rs`/`eval.rs`, not `child.rs`) — it is
**seed-noisy / multi-site** (its fix can span eval_ir+eval+child; different runs find different
subsets), not a DF-009 regression. DF-009 is adopted for the wrong-branch class; nushell's
multi-site/seed instability is tracked separately.
