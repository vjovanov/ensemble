# DF-008-explore-root-cause-tracing: The explore sidekick must trace symptom → root cause, not return the first symptom site

**Status: Worked (misdirection class).** Grounded per §REQ-001-decision-log; addresses the correctness
regression in §DF-007-lead-driven-graphify-skill / the uncapped-rerun; relates to §FS-001-ensemble-explore.

## 1. Problem (the dominant graph-bash correctness regression)

On the uncapped current-code rerun, `classic-graph-bash` resolved only 8/11 of the classic-resolved
set. Root-causing the 3 regressions showed **two mechanisms**, the dominant one being **misdirection**:

| instance | classic/skill (resolved) fixed | sidekick (failed) fixed | mechanism |
|---|---|---|---|
| **nushell-13870** | `nu-protocol/src/process/child.rs` (root cause: exit-code handling) | `nu-command/src/strings/detect_columns.rs` (**a symptom site**) | wrong file — misdirection |
| simdjson-2178 | element-inl.h, value-inl.h … | **same files** | right file, wrong fix (variance) |
| jq-3238 | src/builtin.c | **same file** | right file, wrong fix (variance) |

The autonomous sidekick, prompted for "the likely edit site and at most 3 supporting facts" with "do
not pull in neighbors speculatively," returned the **first site matching the symptom text** and the
lead fixed there. classic and the lead-controlled skill (§DF-007) traced to the true cause and
resolved. So the sidekick's minimality bias *causes wrong-location fixes*.

## 2. Decision

Add a root-cause-tracing instruction to the graph-mode sidekick prompt: for bug/wrong-behavior tasks,
do not stop at the first symptom match — trace symptom → cause via callers/definitions
(`node_at`, `graph_explain`) and return the originating site plus the path. This **takes precedence
over the 3-fact minimality** when the cause is not the symptom site. Still executor-only: the sidekick
locates, it does not author the fix (§DA-002-compile-test-fix-sidekick.2).

## 3. Validation

Re-run the 3 regressions (uncapped, current code). Pass criteria: nushell now traces to
`process/child.rs` (not `detect_columns.rs`) and the set returns toward 11/11 without raising cost on
the healthy instances (§REQ-003-strictly-better-than-baseline).

**Result (uncapped, current code, conc=5):** 8/11 → **9/11**. **nushell RESOLVED** and now touches
`nu-protocol/.../process/child.rs` + `run_external.rs` (the root cause), **not** `detect_columns.rs`
(the symptom) — the misdirection is fixed exactly as designed. Real-fix cost −17% / −35% tok (ALL),
−19% non-C/C++, no regression on the healthy instances. **simdjson and jq-3238 remain unresolved** —
they are the right-file/wrong-fix class (not misdirection), so DF-008 correctly does not address them;
that is fix-quality/seed variance and needs a separate lever (verification depth or multi-seed
confirmation), tracked next.
