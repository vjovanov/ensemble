Planned milestones and sequencing. Each item is an `RM-` declaration; cite as `§RM-NNN-slug`.

# RM-001-bash-sidekick: Delegate read-only exploration and compile/test to a cheap sidekick

The expensive lead model spends roughly half its turns on read-only bash
(`rg`/`sed`/`cat`) and on build/test runs (`cargo`/`mvn`/`go test`). Because cached
conversation replay (`cacheRead`) dominates cost — 89–96% of all tokens in the
benchmark — and scales with the lead's turn count, moving these turns onto a cheap
(~24B) sidekick that returns tight digests should cut expensive-model cost by
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

The delegate request MUST include the caller's verification question, not just the raw shell
command. For test and check commands the default question is: did the tests/check pass; if not,
which command, test, file, or assertion failed, and what is the smallest diagnostic needed to act?
This lets the execution sidekick collapse large logs to a near-zero caller result when the
verdict is success, while still preserving the actionable failure root cause.

When the model digest is unavailable but bash summaries are enabled, the bash tool should
still keep broad output compact and useful by returning a very small bounded head/tail
preview plus the raw output path, including outputs below the normal raw truncation limit.
This prevents long minified lines or sourcemaps from falling back to an empty `(no output)`
truncation, and prevents broad `rg`/`sed` exploration from replaying hundreds of raw lines
into every subsequent lead turn. The fallback is not a replacement for the model digest:
the tool must record when summarization was attempted but unavailable so benchmark results
can distinguish a true digest from local compaction.

## 3. Sequencing

1. `search` + `node_at` locate-then-structure and whole-file fetch (landed — §2.1, §2.2);
   measure against the archived baseline on the curated worst/best instances.
2. Complete the structured NodeRef path, then make whole-file substitution a deterministic
   tool-level coverage heuristic — §2.2.
3. Run the sidekick on a dedicated cheap model (a ~24B explore/verify model). Today
   `runSidekick` and the bash digest use the caller's model (`context.model`); a separate,
   cheaper model is the precondition for the economics above.
4. Add the compile/test bash digest path (landed: bash returns verdict/root-cause digests
   when model context is available, while preserving raw logs for audit) — §2.3.
5. **Next experiment — width-preserving compaction of broad successful output.** Successful
   output is currently returned verbatim (§DF-001-bash-sidekick-failure-only-digest), which left
   a fat one-shot `rg` replaying into `cacheRead` (jackson-core-1309: +48% tokens from a single
   19 KB `rg`). Clip line *width*, preserve line *count* (keep every match location, trim long
   lines), re-run the rg-heavy classic-bash instances, and adopt only if bytes shrink without
   raising bash-call count. Discussion and benchmark: §DF-003-bash-success-output-compaction.
6. **Next experiment — cap the content `explore` injects.** Explore evidence is persistent
   (replays into `cacheRead`), so a single large whole-file return dominates cost — simdjson-2178
   blew up to 2.24M tokens on `classic-graph` from a 74.5 KB "return complete code to edit" explore
   call, and stayed +64% vs classic even on graph-bash. Add a hard byte cap on explore output
   (env `PI_EXPLORE_MAX_RESULT_BYTES`) that keeps fitted evidence and points the lead to `read` for
   full content, then re-run the worst graph-bash cases. Discussion and benchmark:
   §DF-004-explore-injected-content-cap.

## 4. Non-goals

- Changing what the lead decides or which edits it makes; the sidekick only gathers,
  runs, and reports.
- Accounting for sidekick tokens at all. The sidekick runs on a cheap ~24B model, so its
  token cost is immaterial against the expensive lead model — we do not capture, price, or
  optimize it. The only metric that matters is expensive lead-model cost (input/output/
  cacheRead/cacheWrite on the lead). Treat the sidekick's own usage as free; do not add it
  to benchmark cost or "honest accounting" sidecars.
