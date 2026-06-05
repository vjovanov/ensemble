Planned milestones and sequencing. Each item is an `RM-` declaration; cite as `§RM-NNN-slug`.

# RM-001-bash-sidekick: Delegate read-only exploration and compile/test to a cheap sidekick

The expensive lead model spends roughly half its turns on read-only bash
(`rg`/`sed`/`cat`) and on build/test runs (`cargo`/`mvn`/`go test`). Because cached
conversation replay (`cacheRead`) dominates cost — 89–96% of all tokens in the
benchmark — and scales with the lead's turn count, moving these turns onto a cheap
(e.g. 8B) sidekick that returns tight digests should cut expensive-model cost by
~50–55% **without changing what the lead decides or edits**. This extends the
§FS-001-ensemble-explore sidekick from graph/file discovery to also covering shell
exploration and verification.

## 1. Motivation from the benchmark

Measured in the ensemble-vs-pi benchmark (`bench/`, oca/gpt-5.5) across
darkreader/grpc/serde/gson/clap/nushell, classic arm (lead does its own bash):

- Read-only bash is **46–69%** of lead turns; build/test is another **~10–36%**.
- Delegating both bounds lead-turn reduction at **~53–56%**, and likely more on
  `cacheRead` because the removed bash output (compile/test logs are 50–166 KB) also
  shrinks every surviving turn it would otherwise persist in.
- The cost moves to the cheap model, so the expensive-model saving is the full value
  of the delegated turns, not just their `cacheRead`.

## 2. Scope

### 2.1 Exploration delegation

The §FS-001-ensemble-explore sidekick already returns exploration results, but in the
benchmark it returned too much and the lead re-grepped anyway, so it did **not** realize
the saving: vs classic it helped −20 to −100% on three instances but cost +81 to +132%
on two. Realizing it needs (a) the sidekick returning a tight, minimal digest and (b) the
lead trusting it instead of re-grepping. Both are targeted by the current explore prompt
changes (lead: "prefer one explore call, trust the result, don't re-grep"; sidekick:
"think about what the task truly needs, fetch only that") and will be measured by the
next benchmark run against the archived old-prompt baseline.

### 2.2 Compile/test delegation (new)

A new verification delegate: run the project's compile and tests on the cheap model and
return **verdict + root-cause digest** (e.g. serde's 131-error trybuild dump collapses to
its 2–3 root causes). Higher-confidence than exploration delegation because the output is
large yet the lead needs only the verdict, and it is cleanly substitutive — the lead will
not re-run `cargo`/`mvn` once a trusted sidekick has reported the result, avoiding the
"lead keeps grepping" failure mode that erodes §2.1.

## 3. Sequencing

1. Tighten explore digests and induce lead trust (prompts landed; measure next run) — §2.1.
2. Run the sidekick on a dedicated cheap model. Today `runSidekick` uses the caller's
   model (`context.model`); a separate, cheaper explore/verify model is the precondition
   for the economics above.
3. Capture sidekick token usage for honest accounting. Today the sidekick runs as a
   detached agent and its usage is discarded; surface it (e.g. a per-run sidecar) so cost
   reflects all model calls.
4. Add the compile/test delegate tool — §2.2.

## 4. Non-goals

- Changing what the lead decides or which edits it makes; the sidekick only gathers,
  runs, and reports.
- Pricing sidekick tokens at the lead model's rate — the sidekick is a cheap model, and
  the comparison that matters is expensive-model cost.
