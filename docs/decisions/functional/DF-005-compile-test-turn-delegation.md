# DF-005-compile-test-turn-delegation: Delegating compile/test must remove the lead *turn*, not just digest its output

**Status: Proposed — to explore next; folded into §DA-002-compile-test-fix-sidekick (this is the
test-delegation half of that role's green-loop).** Grounded per §REQ-001-decision-log; extends
§RM-001-bash-sidekick.2.3; relates to §DF-001-bash-sidekick-failure-only-digest.

## 1. Problem

The bash digest (§DF-001) compacts the *output* of a compile/test run, but each run is still a
**lead turn**. Because lead `cacheRead` scales with turn count, on hard tasks the lead's compile/test
loop *grows* under graph-bash and eats the read-only-bash saving — or inverts it.

## 2. Benchmark where it happened (biggest least-win analysis, benchmarks-20, graph-bash)

Explore eliminates read-only bash exactly as intended, but build/test turns rise:

| instance | turns cl→gb | read-only bash cl→gb | **build/test bash cl→gb** | Δcost | resolved |
|---|---|---|---|---|---|
| tokio-7124 | 34→**48** | 10→0 | **8→15** | **+4%** | neither |
| logstash-17021 | 23→**28** | 10→3 | **11→17** | **+29%** | neither |

On tokio the read-only bash went to 0 (good) but compile/test runs nearly doubled and 14 explore
round-trips were added on top — explore was **additive, not substitutive**. The lead did *more* work
on a task it never solved, and more turns = more `cacheRead`.

On the resolved-by-both set, build/test turns are **~half of all lead turns and 52% of graph-bash
`cacheRead`** ($0.59 of $1.13). They are the dominant remaining cost lever after explore injection.

## 3. Direction to explore

1. **Turn-removing delegation.** Run compile/test on the sidekick and return verdict + root-cause
   digest such that the lead **does not re-run** and the run is not a lead turn at all (today's digest
   still costs the lead the turn). This is the unrealized half of §RM-001-bash-sidekick.2.3 — the
   "lead keeps re-running" failure mode is what erodes it, so the lead must *trust the verdict*.
2. **Substitute-don't-supplement gate for explore.** Only route to explore when exploration breadth
   justifies it; on tokio the lead kept its full bash+edit loop and explore was pure overhead
   (+14 round-trips). See §DF-006-explore-giveup-and-supplement-guard.

## 4. Decision / next step

Not decided. Prototype turn-removing compile/test delegation and re-run the build/test-heavy
instances (tokio, logstash, zstd, jq-3238 — 14 build/test turns). Adopt only if it cuts lead turns
without correctness regression (§REQ-003-strictly-better-than-baseline). Record the result here.
