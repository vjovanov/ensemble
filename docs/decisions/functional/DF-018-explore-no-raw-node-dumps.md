# DF-018-explore-no-raw-node-dumps: The sidekick must not return raw graph-traversal node-name lists; convert to a path:line ref or small slice

**Status: MERGED & full-run-tested — carried in the net-positive bundle (§DF-023-merge-016-017-018-020b-full-run).**
No regression attributable to it in the K=3 merge (the lone solid-instance regression, jq-3238, is a DF-020b
case-set effect). Grounded per
§REQ-001-decision-log; refines (without the backfire) lever #1 of the rejected
§DF-015-explore-return-source-on-code-intent; pairs with §DF-017-graph-noise-node-exclusion.

## 1. Problem

Traces of the graph-bash cost regressions (simdjson-2178, jq-3238) show the sidekick returning **raw
graph traversals** verbatim to the lead — `Traversal: BFS depth=2 | 281 nodes found` followed by bare
`NODE jv_free()`, `NODE jv_copy()` … — when the lead asked for code. Node names are **not actionable**:
the lead re-asks 9–13× (each ~7KB replaying into cacheRead) and falls back to bash anyway.

§DF-015 tried to fix this by *forcing source bodies*, which **backfired** (jq bodies 11→72KB; disrupted
cheap controls). The lesson: the defect is the **node-name dump as the answer**, not "too little source."
The fix is to forbid the dump and let the sidekick return its normal *compact* evidence — a precise
`path:line` pointer or a *small* slice — **not** large bodies.

## 2. Decision (to validate in the batch)

Targeted addition to `exploreSidekickSystemPrompt` (graphify branch):

> Never return raw graph-traversal output (`Traversal:` / `N nodes found` / bare `NODE …` node-name lists)
> to the caller — node names are not actionable. Convert your findings into either a precise `path:line`
> reference (name the symbol and where it lives) or a small `source_slice`, whichever the task needs.
> Prefer compact pointers; do not dump large bodies.

Difference from §DF-015: it bans the *format* (node-name lists) and **explicitly prefers compact pointers
over large bodies**, so it cannot reproduce the §DF-015 inflation.

## 3. Validation

Held on `exp/suppress-node-dumps`; validated in the single batch full base/003 run alongside §DF-016 and
§DF-017. Expectation: fewer explore retries on the C-family (cost neutral-to-down), **no cost inflation**
(the §DF-015 failure mode — watched explicitly via per-instance cost) and no correctness regression.
