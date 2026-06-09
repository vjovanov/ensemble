Where: project direction and outcomes. Each item is a `GOAL-` declaration; cite as `§GOAL-NNN-slug`.

# GOAL-001-ensemble-beats-pi-and-references: >2× cheaper and >2× faster than baseline pi, more correct than Codex and Claude Code

The ensemble — `classic-graph-bash` plus the dedicated cheap (~24B) sidekick and the
§DA-002-compile-test-fix-sidekick green-loop — must beat **baseline pi** (the `classic` arm: lead
does its own bash, no graph) on cost and speed, and beat the **external reference agents** (Codex,
Claude Code, same model where possible) on correctness. Measured on the cross-language benchmark
(`bench/`), under §REQ-002-benchmark-comparison-methodology (compare only real fixes) and
§REQ-003-strictly-better-than-baseline (no correctness regression vs classic).

## 1. Cost: >2× cheaper than baseline pi

Ensemble lead-model cost ≤ **50%** of `classic` on the candidate-resolved set (resolved-by-both or
candidate-only, per §REQ-002-benchmark-comparison-methodology.1). Per
§DF-002-sidekick-token-cost-out-of-scope the headline is lead-model cost; for fix-authoring sidekick
modes the sidekick cost is **reported alongside** (§DA-002-compile-test-fix-sidekick.5) so a lead
saving that merely shifts spend to a 120B is not counted.

- **Standing:** resolved-by-both today is **−24%**. Path to −50%: explore-injection removal
  (§DF-004-explore-injected-content-cap.8, →−34%) + the build→test→apply green-loop
  (§DA-002-compile-test-fix-sidekick, the load-bearing lever).

## 2. Speed: >2× faster wall-clock than baseline pi

Ensemble wall-clock to resolution ≤ **50%** of `classic`.

- **Standing:** projected ~2× from moving the sidekick off gpt-5.5 to a ~24B at ~1k tok/s — today
  the explore sidekick is **61%** of wall-clock and runs on gpt-5.5 (§RM-001-bash-sidekick.3, item 3).
  Bounded below by the lead's 37% (it stays on gpt-5.5). Not yet measured head-to-head — the 24B is
  not wired in (§4).

## 3. Correctness: higher resolve rate than Codex and Claude Code

Ensemble resolves **strictly more** instances than both reference agents on the suite, with no
regression vs `classic` (§REQ-003-strictly-better-than-baseline). Codex runs on the same model
(gpt-5.5, matched effort) for a clean per-token comparison.

- **Standing:** vs Codex we have data (codex 11/31; graph-bash correctness is seed-noisy —
  dominates one seed, regresses another). vs Claude Code: **no data yet** (§4). The give-up/thrash
  fixes (§DF-006-explore-giveup-and-supplement-guard) and the green-loop are aimed at raising the
  resolve rate, especially on the large currently-unsolved instances.

## 4. Measurement gaps to close before the goal can be claimed

- **Claude Code reference arm** — does not exist yet (we have `classic`/`-bash`/`-graph`/
  `-graph-bash`/`codex`). Needed for §3.
- **Dedicated 24B sidekick** — not wired in; the ~2× speed (§2) and the cost economics are
  projections until the sidekick runs on its own cheap model (§RM-001-bash-sidekick.3, item 3).
- **Head-to-head speed** — once the 24B is wired, measure ensemble vs `classic` wall-clock directly,
  not from the gpt-5.5-sidekick projection.
