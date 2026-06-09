# DF-010-explore-surface-test-caseset: The sidekick must surface the test and enumerate the full case-set, not just the code

**Status: Proposed — scoped multi-seed experiment off base/001.** Grounded per §REQ-001-decision-log;
addresses the dominant graph-bash failure (subset-fix); supersedes the reverted
§DF-009-explore-complete-handler-evidence; relates to §FS-001-ensemble-explore, §REQ-005-research-checkpoints.

## 1. Problem — the unifying failure is a *subset-fix*

base/001 pass@3: graph-bash 9/11, systematically failing jq-3238 (0/3) and nushell (0/3). Deep analysis
of all graph-bash failures shows one root cause: **the fix covers only the case the lead saw, not the
full set of cases the test grades.**

- **jq-3238**: the lead fixed the *named*-capture path; the test also grades an *unnamed* group case
  (`[match("( )*"; "g")]`). The real predicate is name-independent (`region->beg[i] == -1`), but the
  sidekick foregrounded the named-capture machinery and never quoted the grading file `tests/onig.test`
  or its unnamed case.
- **simdjson**: the lead got the common path (`/42`→`NO_SUCH_FIELD`) but dropped the `~`-escape edge
  cases (`/4~`,`/~`→`INVALID_JSON_POINTER`) — a spec detail the test pins down.

In both, the sidekick returned the right *code* but never the *case-set*.

## 2. Decision

For bug-fix tasks, the sidekick must, in addition to the code: **locate and quote the relevant
test/assertion file, and enumerate every qualitatively distinct input the fix must satisfy** (named vs
unnamed group; each expected error code with a representative input). The lead then sees the full
case-set, not one case. Executor-only: it surfaces cases, it does not author the fix
(§DA-002-compile-test-fix-sidekick.2). This is the *sharper, cheaper* version of the reverted DF-009
("return more code") — surface the **cases**, not bulk code.

## 3. Validation

Scoped multi-seed experiment off `base/001`: instances **jq-3238, simdjson** (targets) + **jq-2919,
zstd-3438** (regression-risk, same language) × 3 seeds, vs the frozen base. Pass:
jq-3238/simdjson pass@3 improves with no regression and no cost blow-up on the controls
(§REQ-003-strictly-better-than-baseline). Record here.
