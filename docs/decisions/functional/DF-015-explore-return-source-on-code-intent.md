# DF-015-explore-return-source-on-code-intent: When the task asks for code, return source — not a graph traversal; exclude vendored/test/generated nodes

**Status: REJECTED (failed — cost worse, not merged).** Grounded per §REQ-001-decision-log; targets the
cost regression measured in §REQ-005-research-checkpoints (base/002-30); subsumes
§DF-013-graphify-amalgamation-awareness (lever #2); relates to §DF-004-explore-injected-content-cap,
§DF-008-explore-root-cause-tracing.

## 1. Problem

On base/002 (2 seeds, $ per run on classic's 24 wins) `classic-graph-bash` is the cheapest arm overall
(−22% vs classic) but **loses to classic on the tight C/C++ instances** — its two biggest cost
regressions are **simdjson-2178 (+30%)** and **jq-3238 (+33%)**, ~93% of all its excess spend.

Trace analysis (`explore-pairs.sh --sidekick explore`) shows the mechanism — it is **not** generic
"graph noise", it is that **the sidekick answers the wrong question**:

- The lead repeatedly asks the graph for **source code** ("show the control flow / exact source text for
  `f_match`"; "Find the exact source code for `at_pointer` … bodies, not graph only").
- graphify keeps returning **BFS node-name traversals** verbatim — `Traversal: BFS depth=2 | 281 nodes
  found` followed by bare `NODE jv_free()`, `NODE jv_copy()`, `NODE yyparse()` … — which the lead cannot
  act on.
- So the lead **re-asks 9–13 times** (each ~7 KB of node lists that replay into `cacheRead` every later
  turn) **and still falls back to `bash`** to read the real code. It pays for both.

Measured (graph-bash vs classic): jq-3238 9 explore calls / 72 KB injected; simdjson **13 calls / 144 KB
injected → cacheRead 1.24M vs classic 0.53M (2.35×)** and 2× output. The node lists also pull in
irrelevant nodes: simdjson's **vendored `dependencies/jsoncppdist/json/json.h`** and `tests/*.cpp`; jq's
generated `parser.c yyparse()` and unrelated `jv_dtoa.c`.

The sidekick prompt's *intent* is already correct (`search` → `source_slice` → graph only when needed,
"reproduce code verbatim"). The cheap sidekick model just **passes the raw `graph_query` result through
as its final answer** instead of resolving it to source.

## 2. Decision (to validate)

Two levers, in priority order:

1. **Never return raw graph traversal as the answer; return source for code-intent tasks.** Strengthen
   `exploreSidekickSystemPrompt` (graphify branch): graph traversal is for the sidekick's *own*
   navigation only — it must not emit `Traversal:`/`N nodes found`/bare `NODE …` lines to the caller.
   When the task asks for an implementation/body/source/"show the code", resolve the located nodes to
   actual code via `source_slice` and return the **code**. This is the big lever: it collapses the 9–13
   retry calls toward ~2–3 and removes the bulk of injected node-list bytes.
2. **Exclude noise nodes from graph results** (folds §DF-013): filter `graph_query`/`graph_explain`/`node_at`
   output to drop nodes whose `source_file` is vendored/third-party (`dependencies/`, `vendor/`,
   `third_party/`, `node_modules/`, `*dist*`), test (`tests?/`, `*_test.*`, `*.test.*`), or generated
   (`parser.c`/`lexer.c`/`*.tab.c`/`*.generated.*`). Shrinks every traversal the sidekick does navigate.

## 3. Validation — FAILED

Worktree `exp/explore-source-on-intent` (both levers), `classic-graph-bash` × 3 seeds on the targets +
controls vs the 3-seed base. **$ per run (exp vs base-gb):**

| | classic | base-gb | exp-gb | Δ vs base |
|---|---|---|---|---|
| simdjson-2178 | $0.823 | $1.028 | $1.003 | −2% (flat) |
| jq-3238 | $0.448 | $0.608 | **$0.804** | **+32%** |
| clap-5873 | $0.430 | $0.433 | $0.478 | +10% |
| tracing-2897 | $0.446 | $0.403 | **$0.733** | **+82%** |
| go-zero-2787 | $0.222 | $0.159 | $0.200 | +26% |

Correctness held (all still resolve) but **cost got worse on every instance**, including the controls
— a clear §REQ-003 regression. **Rejected; not merged.**

**Why it backfired** (from the sessions):
- Lever #2 (noise exclusion) worked in isolation — simdjson explore injection **189KB→50KB**, cacheRead
  **1020k→467k** — but total cost stayed flat (the lead still does the same bash; seed-noise dominates).
- Lever #1 (force source) **backfired**: returning function bodies is often *bigger* than node lists
  (jq-3238 explore **11KB→72KB**), and the blanket "never return graph traversal" directive disrupted the
  cases where explore was already cheap (tracing bash 10→18, turns 15→26 → +82%).

**Learnings.** The C-family cost regressions are **not** an explore-prompt problem — the lead does heavy
`bash` on tight C source regardless, so explore tweaks don't move the total. The pragmatic lever is the
**classic-capped routing** (−26.6% vs classic, already measured) — i.e. detect graph-noisy / explore-not-
helping cases and fall back to classic — rather than reshaping what explore returns. Lever #2 alone
(noise-node exclusion, no forced-source) is the only salvageable piece and could be retried narrowly, but
is low priority.
