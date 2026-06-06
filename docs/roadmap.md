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
on two. Worse, the sidekick used graphify poorly — ~40% of its graph calls whiffed (≈75–86%
on Java), because graphify cannot locate arbitrary text and it kept guessing node identifiers.

**Implemented (rg-locate + graph-structure):** the graph-mode sidekick now has a `search`
(ripgrep-like) tool to locate by any string, and `node_at(path, line)` to resolve a search
hit to its graph node — eliminating identifier guessing while keeping results graph-derived
(§FS-001-ensemble-explore.2.1). It also got `graph_fetch_node` so it can return a whole file
when most of it is needed (interim form of §2.2-below). Prompts updated to drive the
locate→resolve→structure flow and to trust the result. To measure against the archived
old-prompt baseline on the curated worst/best instances.

### 2.2 Whole-file when mostly covered

When the selected nodes cover most of a file, returning the whole file once beats many
fragment fetches (avoids per-fragment framing and re-fetches; the benchmark showed graphify
pulling 2.5× more context than classic on high-coverage files). The deterministic form — the
tool computes per-file coverage and substitutes a whole-file read above a threshold — belongs
in the tool's composition step and **depends on the structured NodeRef path (deferred)**.
Interim: the sidekick has `graph_fetch_node` and is prompted to fetch whole files when most of
one is needed.

### 2.3 Compile/test delegation (new)

A new verification delegate: run the project's compile and tests on the cheap model and
return **verdict + root-cause digest** (e.g. serde's 131-error trybuild dump collapses to
its 2–3 root causes). Higher-confidence than exploration delegation because the output is
large yet the lead needs only the verdict, and it is cleanly substitutive — the lead will
not re-run `cargo`/`mvn` once a trusted sidekick has reported the result, avoiding the
"lead keeps grepping" failure mode that erodes §2.1.

## 3. Sequencing

1. `search` + `node_at` locate-then-structure and whole-file fetch (landed — §2.1, §2.2);
   measure against the archived baseline on the curated worst/best instances.
2. Complete the structured NodeRef path, then make whole-file substitution a deterministic
   tool-level coverage heuristic — §2.2.
3. Run the sidekick on a dedicated cheap model. Today `runSidekick` uses the caller's
   model (`context.model`); a separate, cheaper explore/verify model is the precondition
   for the economics above.
4. Capture sidekick token usage for honest accounting. Today the sidekick runs as a
   detached agent and its usage is discarded; surface it (e.g. a per-run sidecar) so cost
   reflects all model calls.
5. Add the compile/test delegate tool — §2.3.

## 4. Non-goals

- Changing what the lead decides or which edits it makes; the sidekick only gathers,
  runs, and reports.
- Pricing sidekick tokens at the lead model's rate — the sidekick is a cheap model, and
  the comparison that matters is expensive-model cost.
