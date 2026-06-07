# DF-004-explore-injected-content-cap: Cap the content `explore` injects into the caller

**Status: Proposed — under discussion, pending experiment (§RM-001-bash-sidekick.3 item 6).**

Open question: how to stop a single large `explore` return from dominating `cacheRead`.
Explore evidence is **persistent** — it stays in the caller's transcript and replays on every
later turn — so a large return is far more expensive than the same bytes from a (now-digested)
bash command. Grounded per §GRUND-001-decision-log. Relates to §FS-001-ensemble-explore and
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

## 5. Decision / next step

Not decided. Implement the cap (§RM-001-bash-sidekick.3 item 6), re-run simdjson-2178 and
go-zero-2787 (and a healthy graph instance to check for regressions), track `cacheRead` and total
explore bytes injected. Adopt if it cuts the simdjson blowup without degrading the graph wins;
record the outcome here.
