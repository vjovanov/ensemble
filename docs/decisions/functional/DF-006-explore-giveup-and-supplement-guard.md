# DF-006-explore-giveup-and-supplement-guard: An explore-only run that never edits or tests is a regression, not a saving

**Status: Proposed — to explore next.** Grounded per §REQ-001-decision-log; enforces
§REQ-002-benchmark-comparison-methodology; relates to §DF-005-compile-test-turn-delegation.

## 1. Problem

A graph-bash run can take explore evidence and **conclude prematurely** — no edit, no test, an empty
patch — and so reports a large "saving" that is actually a lost fix. This is the cheap-give-up trap
§REQ-002-benchmark-comparison-methodology warns about, now observed concretely.

## 2. Benchmark where it happened (biggest least-win analysis, benchmarks-20)

| instance | classic | graph-bash | what graph-bash did |
|---|---|---|---|
| nushell-13870 | **resolved**, 114-line patch, $1.04 | **unresolved**, **0-line (empty) patch**, $0.14 | 6 explore calls, **0 bash, 0 edit** |

The "−87%" is fake: the lead gathered explore evidence and bailed without ever building, testing, or
editing. (Also seed-noisy — it solved on seed A at ~915 KB, confirming the give-up is a behavioral
failure, not task-impossible.)

## 3. Direction to explore

1. **Scoring rule (measurement).** Per §REQ-002-benchmark-comparison-methodology, an unresolved run
   is never a saving; an explore-only run with **0 edits + 0 test runs + empty patch** is the
   detectable signature of cheap-give-up and must be scored as a **regression**, not silently dropped.
2. **Verify-before-conclude (policy).** The lead must not conclude "done/can't" without at least one
   build/test verification. An explore-only terminal state is a failure signal to surface, not accept.
3. **Substitute-don't-supplement (shared with §DF-005-compile-test-turn-delegation).** The opposite
   tail — explore added on top of a full bash+edit loop (tokio: +14 explore round-trips, bash+edit
   unchanged) — is the same misuse of explore in the other direction. Explore should replace the
   lead's discovery, not be appended to it.

## 4. Decision / next step

Not decided. Add the give-up signature to the benchmark report so these stop polluting the savings
average, and test a verify-before-conclude prompt change on nushell + the seed-flip regressions
(go-zero-2787). Adopt only if it restores correctness without raising cost on healthy instances.
Record the result here.
