# DF-021 — caveman classic primitive ladder (frozen results)

Frozen record of DF-021: layer increasingly blunt primitive-discipline skills on the `classic-caveman`
arm (lead = `oca/gpt-5.5`, no graph, no sidekick) and find the floor. L1 trimmed → L2 caveman →
L3 stone-tool, K=3, on 9 scoped instances (4 retry-heavy + 2 controls + 3 JS/TS wide-read), vs the
frozen `classic` L0 base (`checkpoints/003-base002-30`, s1+s2). Findings + chart: `bench/README.md`
→ "DF-021 — Caveman Primitive Ladder".

`l{1,2,3}/s<k>/<inst>__classic-caveman/{metrics.json, patch.diff, manifest.json}` +
`s<k>/validation/classic-caveman/<inst>.json`. Session jsonl was not snapshotted (classic arm has no
explore-debug; lead session traces overwritten in raw/), so per-level `bash:read` attribution is not
recoverable from this freeze — total cost is reported instead.

**Result (negative).** Correctness held flat (pass@K: L0 8/9, L1 8/9, L2 9/9, L3 8/9 — even the
deliberately-too-primitive L3 did not break it; `svelte-15115` is flaky everywhere, L0 included).
But **cost did not fall** — every caveman level cost MORE per run than plain classic (L1 +15%,
L2 +5%, L3 +14% vs L0 $0.591/run). No monotonic L1→L2→L3 decline. **No keeper:** no level meets the
PASS gate (pass@K ≥ L0 AND cost down); plain `classic` (L0) remains the floor. L1-vs-L2 prose-vs-blunt
is within seed noise (one `svelte` seed-flip) → the blunt register carries no signal.

Caveat: L0 is a frozen 2-seed checkpoint on an earlier code state; the caveman levels ran 3-seed on
the current branch, so the L0↔Ln cost delta has a code-state confound. The internal L1/L2/L3 result
(more-primitive ≠ cheaper) does not depend on L0.
