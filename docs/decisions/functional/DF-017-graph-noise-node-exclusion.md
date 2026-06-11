# DF-017-graph-noise-node-exclusion: Drop vendored / test / generated nodes from graph traversal results

**Status: Proposed (fix 2/3 — held on branch for batch merge + full test).** Grounded per
§REQ-001-decision-log; salvages lever #2 of the rejected §DF-015-explore-return-source-on-code-intent;
subsumes §DF-013-graphify-amalgamation-awareness.

## 1. Problem

§DF-015 (rejected) bundled two changes; the failure was **lever #1** (forcing the sidekick to return
source bodies) which inflated cost and disrupted well-behaved cases. **Lever #2 — noise-node exclusion —
worked in isolation**: it shrank simdjson's explore injection **189KB→50KB** and halved its cacheRead
(1020k→467k) with no correctness loss. It just didn't move *total* cost when bundled, because lever #1
dominated and the lead bashes heavily on C regardless.

The underlying defect stands: `graph_query`/`graph_explain` traversals return nodes from files that are
never edit sites — simdjson pulls **vendored `dependencies/jsoncppdist/json/json.h`** and `tests/*.cpp`;
jq pulls generated `parser.c`. These bloat the sidekick's navigation (and any pass-through).

## 2. Decision (to validate in the batch)

Re-introduce **only** the filter (no forced-source). `filterGraphNoise` drops graph result lines for
nodes whose `source_file` is vendored/third-party (`dependencies/`, `vendor/`, `third_party/`,
`node_modules/`, `*dist*`), test (`tests?/`, `*_test.*`, `*.test.*`), or generated
(`parser.c`/`lexer.c`/`*.tab.c`/`*.generated.*`), applied to `graph_query` and `graph_explain` output.
Non-NODE lines (headers, code) are untouched.

## 3. Validation

Per the batch policy (3 fixes → merge all → one full test): this change is **held on
`exp/graph-noise-node-exclusion`** and validated together with the other two fixes in the single full
base/003 run. Expectation: neutral-to-small cost improvement on C-family (simdjson/jq), **no correctness
or cost regression** anywhere (the lever #1 backfire is excluded). Watch: the filter must not drop a
genuine edit site (e.g. a real fix that lives in a `tests/` helper) — the regex is conservative and only
removes NODE lines, never source the sidekick explicitly sliced.
