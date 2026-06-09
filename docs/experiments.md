# Experiment ledger

What we tried and what worked. One row per experiment, newest first. Maintained per
§REQ-004-experiment-hygiene.3. Outcome ∈ worked / mixed / failed / proposed / running.

| date | experiment | arms · instances | outcome | decision |
|---|---|---|---|---|
| 2026-06-09 | **higher explore injected-content caps** (`PI_EXPLORE_MAX_RESULT_BYTES=64KB/128KB`) | classic-graph-bash · simdjson/go-zero/clap/zstd/jq-2919/logstash/nushell/svelte | **running** | §DF-004-explore-injected-content-cap.6 |
| 2026-06-08 | **graph-bash vs classic correctness** (the headline) | 4 arms · benchmarks-20 | **worked** — graph-bash 11/20 ⊇ classic 8/20, +3 unique wins, 0 regressions; cheaper on resolved-by-both (−10%$/−20%tok, −32%/−47% ex-C-family) | (pending DF: graph-bash strictly dominates classic) |
| 2026-06-08 | **explore injected-content cap** (24 KB, `PI_EXPLORE_MAX_RESULT_BYTES`) | classic-graph, classic-graph-bash · cap A/B on simdjson/zstd/jq/go-zero/clap/logstash | **mixed/failed** — simdjson cacheRead −86% / $1.15→$0.37 but **simdjson FAILED to resolve under the cap** (was resolved without it); no-op elsewhere | §DF-004-explore-injected-content-cap (not adoptable as-is; needs editing→`read` split or higher cap, ≥3 seeds) |
| 2026-06-08 | **bash sidekick: digest failures only, success verbatim** | classic-bash, classic-graph-bash | **worked** — removed the success-compaction re-grep inflation; success now identical to no-sidekick arm | §DF-001-bash-sidekick-failure-only-digest |
| 2026-06-08 | **sidekick token cost out of scope** (cheap ~24B model) | n/a (policy) | **worked** (policy) — only lead-model cost is tracked | §DF-002-sidekick-token-cost-out-of-scope |
| — | width-preserving success compaction | — | **proposed** | §DF-003-bash-success-output-compaction |
| — (queued) | run-hard-all (4 arms, 13 hard instances) | 4 arms | **running** | — |
| — (queued) | codex reference (effort=medium, same model) | codex · all fetched | **queued** | — |
| — (queued) | 6 new non-C/C++ large benches | 4 arms · fastjson2, mockito, material-ui, insomnia, ripgrep, bat | **queued** | — |
