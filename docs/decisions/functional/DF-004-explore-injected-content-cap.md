# DF-004-explore-injected-content-cap: Cap the content `explore` injects into the caller

**Status: Mixed — static 24 KB cap is not adoptable as-is; higher-cap follow-up queued (§6).**

Open question: how to stop a single large `explore` return from dominating `cacheRead`.
Explore evidence is **persistent** — it stays in the caller's transcript and replays on every
later turn — so a large return is far more expensive than the same bytes from a (now-digested)
bash command. Grounded per §REQ-001-decision-log. Relates to §FS-001-ensemble-explore and
§RM-001-bash-sidekick.2.1.

## 1. Problem

`runSidekick` returns the sidekick's final message verbatim. When the lead opts into whole-file
reads (`wholeFiles`) — typically to *edit* — the sidekick can return tens of KB of complete file
content, which then replays into `cacheRead` for the rest of the run.

## 2. Benchmark where it happened

- **Run:** ensemble-vs-pi (`bench/`, `oca/gpt-5.5`), arms `classic-graph` / `classic-graph-bash`.
- **simdjson-2178 (+64% tokens vs classic):** the `classic-graph` run hit **2.24M tokens / 47
  turns** driven by explore returns the lead requested *for editing* —
  `"I need to edit the at_pointer implementations. Return complete code"` → **74.5 KB**, plus a
  **42.6 KB** whole-files return. A 74.5 KB persistent injection × ~30 later turns ≈ the 2.2M
  cacheRead. `classic-graph-bash` was a milder version of the same (one 38.3 KB
  `"provide complete content to edit"` pull → 740k, still +64% vs classic 451k).
- **go-zero-2787 (+46% tokens vs classic):** no single large return (max 7.3 KB) but **diffuse**
  overhead — 9 explore calls / 31 KB of evidence replayed across a 15-turn task where classic's
  plain grep (74 KB total cacheRead) was simply cheaper. Small tasks don't earn explore's fixed cost.

## 3. Proposed approach

1. **Hard cap on explore's returned content** (default ~24 KB, env `PI_EXPLORE_MAX_RESULT_BYTES`):
   keep the discovery evidence that fits, truncate at a line boundary, and append a pointer telling
   the lead to `read` the cited files for full content. A deterministic backstop to the sidekick's
   soft "≤120 lines / ≤4 excerpts" budget.
2. **Nudge usage:** explore is for *discovery* and returns minimal evidence; full file content for
   *editing* comes from `read` (ephemeral), not explore (persistent).

## 4. Alternatives considered

- **Cap per-excerpt / bound §2.2 whole-file substitution by absolute size** — more surgical, more
  code; the output-level cap subsumes the worst case.
- **Prompt-only** (tell the lead not to bulk-fetch via explore) — no guarantee; keep as a complement
  to the hard cap, not a replacement.
- **Gate explore on task size** (for go-zero) — can't be known upfront; deferred. go-zero's
  overhead is ~$0.05, far below simdjson's blowup.

## 5. Static 24 KB result

The 24 KB cap cut the worst simdjson cost but introduced a correctness regression: simdjson-2178
resolved with the uncapped graph-bash run and failed under the cap. The static cap is therefore
not adoptable as-is: it is cheaper, but it does not preserve graph-bash correctness.

## 6. Higher-cap follow-up

Before implementing adaptive deep-context escalation, run a no-code A/B with larger fixed caps
(`PI_EXPLORE_MAX_RESULT_BYTES=65536` and `131072`) on the regression/control set:
simdjson-2178, go-zero-2787, clap-5873, zstd-3438, jq-2919, logstash-17021, nushell-13870,
and svelte-15115.

Adopt neither value from this run directly. Use it only to decide whether the lost simdjson context
is recoverable by a modest cap increase, and whether any healthy graph-bash wins become materially
more expensive. If a higher fixed cap recovers correctness without broad cost regressions, the next
design should be adaptive escalation: default to the 24 KB cap, but allow targeted deeper context
only when the cheap path is insufficient.

## 7. Decision / next step (DF-004.6 result)

**Ran.** Higher caps on the sweep set, simdjson the anchor (it failed at the 24 KB cap):

| cap | simdjson resolved | simdjson cost |
|---|---|---|
| uncapped | ✓ | $1.15 |
| 24 KB | ✗ (lost the fix) | $0.37 |
| 64 KB | ✓ (recovered) | **$1.64** |
| 128 KB | ✓ (recovered) | $1.33 |

**Verdict: no fixed cap is adoptable.** 24 KB is cheap but breaks correctness; 64/128 KB recover the
fix but cost **more than no cap at all** ($1.64/$1.33 > $1.15) — the cap gives no cost win while
preserving correctness. Other instances are seed-noisy (nushell fails 64/128 KB; svelte flips). This
confirms the failure is **content-loss, not size**, so the fix is the edit-executor / green-loop
(§DA-001-edit-executor-sidekick, §DA-002-compile-test-fix-sidekick), not a static cap. Close DF-004 as
**not adopted**; production keeps the default and the lever moves to DA-002.

## 8. Injection cost on the resolved-by-both set (biggest least-win analysis)

Measured on benchmarks-20, graph-bash, the explore-injection `cacheRead` (cumulative injected
tokens replayed across remaining turns) tracks the per-instance cost regression almost linearly:

| instance (resolved by both) | Δcost vs classic | explore injected |
|---|---|---|
| clap-5873 | **+42%** | 62 KB / 5 calls |
| jq-2919 | **+28%** | 17 KB (small instance) |
| tracing-2897 | **+11%** | 17 KB |
| zstd-3438 | −3% (break-even) | **95 KB** |
| serde-2798 | −6% (unresolved) | 67 KB, edit:13 |

Across the 8 resolved-by-both instances, explore-injection `cacheRead` = **$0.47 (13% of graph-bash
cost)**. Removing it moves resolved-by-both from **−24% → −34%** vs classic. This is the lever that
§DA-001-edit-executor-sidekick (editing-pull subset — serde edit:13, clap whole-file) and a higher
cap (§6) target. Note: on these medium instances `cacheRead` is only ~31% of *cost* (input 43%,
output 26%) — `cacheRead` dominates *token count*, not *cost*, except on the large high-turn
instances (simdjson/tokio/serde).
