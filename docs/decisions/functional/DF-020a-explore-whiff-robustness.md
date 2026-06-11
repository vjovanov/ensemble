# DF-020a-explore-whiff-robustness: when a graph call whiffs (miss or near-empty), the explore tool completes it from filesystem search instead of returning a dead-end stub

**Status: REJECTED (no-op) — the whiff fallback never fired on the retry-heavy set.** First of three
bits split out of the grpc-go-3258 retry-storm analysis (DF-020); grounded per §REQ-001-decision-log;
targeted the explore retry storms measured on base/003; relates to §DF-008-explore-root-cause-tracing,
§DF-006-explore-giveup-and-supplement-guard, §DF-004-explore-injected-content-cap. The §DF-015 lesson
(blanket bundling backfires) is why DF-020 is broken into independently-screened bits A/B/C; this is bit
**A** — the cheapest, lowest-risk, independent one. **The screen falsified its premise:** the sidekick
navigates these repos almost entirely via `search`+`source_slice`, calling `graph_query`/`graph_explain`
**once total across all six instances**, so the whiff fallback (which only touches those two handlers)
had nothing to act on. The retry storm is a `search`/`source_slice` fan-out problem, not a graph-whiff
problem → re-aimed as **§DF-020b**.

## 1. Problem

On grpc-go-3258 the explore sidekick made **20 explore calls** that cluster into 4 re-ask loops
(dns_resolver ×4, ClientConn interface ×5, ccResolverWrapper/clientconn ×5 ending in a 48 KB whole-file
dump of clientconn.go, balancer ×6). The proximate driver is the **whiff**: `graph_query`/`graph_explain`
either misses (`undefined`) or returns near-nothing, and in required-graph mode the handler returns a
**dead-end stub** —

> `No graph result for "...". (Required-graph mode: filesystem fallback disabled.)`

— which forces the sidekick to re-ask the same thing several ways and finally escalate to whole-file
dumps. The filesystem tools (`search`, `source_slice`, `node_at`) are already exposed to the sidekick
**even under `PI_REQUIRE_GRAPH`**, so the stub is not protecting any invariant the lead sees — it just
costs a round-trip every time the graph comes up short.

## 2. Decision (to validate)

In the `graph_query`/`graph_explain` handlers, treat a result that is `undefined` **or** below a small
char threshold as a **whiff**. On a whiff, run the filesystem `search` (`fallbackSearch`) ourselves and
return labeled evidence in the same tool result, instead of the stub:

- `undefined` → `(No graph node for "…"; filesystem search instead:)` + ranked snippets.
- thin result → keep it, then append `(Graph returned little for "…"; completing from filesystem search:)`
  + ranked snippets.

This deliberately relaxes §FS-001-ensemble-explore.7.4.4 (no filesystem degrade in required-graph mode)
**for the whiff case only**: since `search`/`source_slice` are already callable under `PI_REQUIRE_GRAPH`,
this widens nothing the lead ultimately sees (it only ever gets the sidekick's digest) — it removes a
wasted re-ask. Tunables: `PI_EXPLORE_WHIFF_FALLBACK=0` to disable; `PI_EXPLORE_WHIFF_MIN_CHARS` (default
200) for the near-empty threshold. Change is confined to `explore.ts` (`resolveGraphResult`).

## 3. Validation (planned)

Worktree `exp/explore-whiff-robustness` off `base/current` (= `base/003-base002-30`), change only
`explore.ts`, re-run `classic-graph-bash` (cheap 1-seed screen) on:

- **Targets (retry-heavy):** grpc-go-3258, clap-5873, dayjs-2532, simdjson-2178.
- **Controls (no-regression):** dayjs-2399, express-5555 (cheap JS/TS wins that do not whiff).

**Metrics:** explore call count and cost vs base/003 on the targets; correctness (resolved) unchanged on
all six; cost flat-to-down on controls. **PASS gate (screen):** the retry-heavy targets show fewer explore
calls / lower cost with no correctness regression, and controls stay flat. **Watch (the §DF-015 failure
mode):** that the always-on filesystem completion does not *inflate* cost by attaching snippets to calls
that did not actually need them (controls catch this). If the screen passes, promote to a 3-seed run and
queue for the merge-3-wins batch; bits **B** (fuller call-chain answers) and **C** (no whole-file
escalation) are sequenced after, screened separately.

### Result — REJECTED (no-op), 1-seed screen vs base/003

`classic-graph-bash`, 1 seed, on the planned six. Correctness **6/6** (no regression) and cost within
base/003 seed noise — **but the change never executed on the graph path.**

| instance | base/003 (3-seed mean) | exp (1 seed) | sidekick `graph_query`+`graph_explain` | `search` | `source_slice` | whiff-fired |
|---|---|---|---|---|---|---|
| grpc-go-3258 | $0.67 (.42/.72/.88) | $0.59 | 0 | 66 | 96 | **0** |
| simdjson-2178 | $1.03 (.58/1.39/1.11) | $1.42 | 0 | 131 | 123 | **0** |
| dayjs-2532 | $0.59 (.41/.50/.86) | $1.02 | 0 | 121 | 75 | **0** |
| dayjs-2399 | $0.60 (.41/.82/.57) | $1.08 | 0 | 63 | 60 | **0** |
| clap-5873 | $0.43 (.45/.35/.50) | $0.55 | 1 | 49 | 59 | **0** |
| express-5555 | $0.09 | $0.05 | 0 | 9 | 9 | **0** |

**Finding:** the sidekick called the graph relationship tools **once total** (clap). It locates and reads
via `search`+`source_slice` (ripgrep/sed style) — 162 internal calls on grpc-go-3258, 254 on simdjson.
The whiff fallback only wraps `graph_query`/`graph_explain`, so it is **inert** here. The retry storm is a
**`search`/`source_slice` fan-out + lead re-ask** problem, not a graph whiff. Re-aimed as
**§DF-020b-explore-decisive-search**. Code (`resolveGraphResult`, toggle `PI_EXPLORE_WHIFF_FALLBACK`)
remains on `exp/explore-whiff-robustness` as a harmless defensive net for genuinely graph-heavy repos,
but is **not adoptable on its own evidence** (zero firings).
