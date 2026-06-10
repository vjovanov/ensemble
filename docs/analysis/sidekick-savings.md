# Sidekick savings analysis (from classic, passing benchmarks)

Where the three sidekicks can save, and how much, across the **11 classic-passing** benchmarks
(classic pass@3 on base/001). Modeled from each classic session: a tool result of T tokens produced
at assistant-turn k of N costs **T input** (first appearance) + **T×(N−k) cacheRead** (replayed every
later turn); attributed by tool category. Reproduce with `bench/lib/sidekick-savings.mjs`. Prices:
input $5/Mtok, cacheRead $0.5/Mtok. Relates to §RM-001-bash-sidekick, §DF-013-graphify-amalgamation-awareness,
§DA-002-compile-test-fix-sidekick.

## Per-instance ideal savings (vs classic)

| instance | classic $ | explore $ | build/test $ | offloadable % |
|---|---|---|---|---|
| nushell-13870 | 0.81 | **0.44** | 0.09 | 65% |
| bat-3189 | 0.21 | 0.10 | 0.02 | 57% |
| tracing-2897 | 0.43 | 0.07 | **0.14** | 49% |
| simdjson-2178 | 0.72 | 0.29 | 0.01 | 42% |
| zstd-3438 | 0.90 | 0.35 | 0.02 | 41% |
| zstd-3942 | 0.22 | 0.09 | 0.00 | 41% |
| jq-2919 | 0.31 | 0.09 | 0.02 | 36% |
| jq-3238 | 0.44 | 0.11 | 0.02 | 30% |
| darkreader-7241 | 0.18 | 0.05 | 0.00 | 29% |
| go-zero-2787 | 0.21 | 0.06 | 0.00 | 28% |
| clap-5873 | 0.46 | 0.11 | 0.00 | 24% |
| **TOTAL** | **$4.91** | **$1.76** | **$0.33** | |

## The three sidekicks

1. **Explore sidekick (graphify) — the dominant lever; applicable to all 11.**
   Ideal **$1.76 = 36% of classic** = **input $0.65 + cached $1.10**. The win is overwhelmingly
   **cacheRead** — read-only exploration (rg/sed/cat) replays into every later turn; killing the replay
   matters far more than first-appearance input. **Net** ≈ $1.2–1.3 after the sidekick's own returns
   persist (measured ~$0.47 explore-injection on graph-bash).

   - **Sub-category — run-time + analysis-trimmed graph.** Trimming the graph to (a) run-time-touched
     nodes (the code path the failing test exercises) + (b) static analysis from the edit sites shrinks
     what the sidekick *returns* → reclaims a large share of the ~$0.47 residual (**~+$0.2–0.3 net**),
     and **fixes the C/C++ failure mode** (§DF-013-graphify-amalgamation-awareness): the simdjson graph
     query returned vendored `dependencies/jsoncppdist` + doc nodes; a trimmed graph excludes those.

2. **Bash sidekick (compact long output) — minor; ~4 instances (tracing, bat, jq×2).**
   Ideal **$0.33 (input $0.17 + cached $0.16)**, ~85% recoverable. Small because **the lead redirects
   build output itself** (`make >log && echo ok || tail`), so floods are intermittent
   (§DF-014-bash-success-verdict-digest is the safety net for the unredirected case).

3. **Compile-fix loop — same target as #2, bigger; ~4 instances.**
   ≥ the bash figure: removes build/test *turns* and collapses iterative re-runs. Absolute ceiling on
   *classic* is still ~$0.3–0.5 (build/test isn't the bulk in classic). It matters more on graph-bash,
   where explore-offload makes build/test the dominant remainder (the ~38% measured earlier).

## Conclusions
- **Explore is ~5× the other two combined** ($1.76 vs $0.33), almost all cacheRead — prioritize it.
- **Graph-trim is the multiplier on explore** — turns "offload" into "offload + return minimal", and is
  the concrete fix for the C/C++ weakness.
- Combined ideal ~43% of classic; realistic net ~35–40% after sidekick returns — consistent with the
  historical non-C/C++ −30 to −47%.
