# DF-013-graphify-amalgamation-awareness: The C/C++ graph must not collapse generated duplicates or drop overloads

**Status: Proposed — graphify-tool change (separate from the prompt experiments).** Grounded per
§REQ-001-decision-log; addresses the C-family weakness (correctness + the +31% cost); relates to
§DF-010-explore-surface-test-caseset, §REQ-005-research-checkpoints.

## 1. Problem — the C/C++ graph under-represents edit sites

On simdjson, `graph.json` is structurally lossy: `value::at_pointer` (one of the three required edit
sites) is **absent as a node**, and the ~16 architecture-specialized copies of `at_pointer` in the
amalgamated `singleheader/simdjson.h` are **collapsed into a single node**. So graph-only discovery
misses edit sites and hides the source→amalgamation mapping; success on simdjson came from the **bash**
half (grep), not the graph. This is the mechanism behind graphify being weak on C/C++ (the +31% cost on
the C-family subset and the noisy resolution).

## 2. Decision

Make the C/C++ graph backend: (a) emit a **node per overload / per `*-inl.h` definition** (so
`value::at_pointer`, ondemand `object::at_pointer`, etc. are addressable); (b) **not collapse repeated
definitions** in a generated single-header into one node — either keep them distinct or tag the node
`generated`/`duplicate_count>1` with a pointer to the source `*-inl.h` to edit and regenerate.

## 3. Validation

Re-extract the simdjson graph and assert it contains distinct `value_inl_at_pointer` /
`ondemand_object_inl_at_pointer` nodes and a `generated`-tagged singleheader node. Then scoped
multi-seed off `base/001` on the C-family subset (simdjson, zstd-3438, jq-2919/3238) × 3 seeds: pass if
graph-derived discovery reaches the same sites bash currently finds, reducing the C-family cost gap
without correctness regression (§REQ-003-strictly-better-than-baseline). Record here.
