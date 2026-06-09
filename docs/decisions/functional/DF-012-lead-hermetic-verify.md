# DF-012-lead-hermetic-verify: The lead must hermetically recompile + run tests and check case-coverage before submitting

**Status: Proposed — scoped multi-seed experiment off base/001.** Grounded per §REQ-001-decision-log;
addresses the jq-3238 compile failure and the subset-coverage gap; relates to
§DF-010-explore-surface-test-caseset, §DA-002-compile-test-fix-sidekick.

## 1. Problem — weak verification ships broken / incomplete patches

- **jq-3238 (one seed)**: shipped a **non-compiling** patch (`len`/`blen` undeclared in the zero-width
  branch). The lead's gate was `make src/builtin.o && echo builtin-o-ok` — it reported OK without a
  clean rebuild actually failing, so the broken patch was submitted.
- **subset-fixes generally** (DF-010/DF-011): nothing checks that each known case is actually covered,
  so partial fixes pass the lead's self-check and only fail at hidden f2p grading.

## 2. Decision

Before finalizing, the lead must: (a) force a **clean/hermetic recompile** (remove the object / touch
the source) and treat any non-zero exit as a hard block; (b) **run the existing tests** (`make check`
/ the repo's test target), not a bare object compile; (c) **map each known case** (from
§DF-010-explore-surface-test-caseset's enumerated case-set) to the patch lines that satisfy it and
refuse to submit if any case is unmapped. The lead cannot see the hidden f2p tests, but a real recompile
+ existing-test run + case-coverage check catches the compile error and the subset gap.

## 3. Validation

Scoped multi-seed experiment off `base/001`: **jq-3238, nushell** (the systematic failures) + **clap,
zstd-3942** (controls) × 3 seeds, vs the frozen base. Best run **on top of DF-010** (which supplies the
case-set the coverage check needs). Pass: fewer broken/subset submissions, pass@3 up, no control
regression (§REQ-003-strictly-better-than-baseline). Record here.
