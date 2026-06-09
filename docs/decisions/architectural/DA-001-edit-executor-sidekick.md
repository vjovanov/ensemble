# DA-001-edit-executor-sidekick: The sidekick applies lead-authored edits; the whole file never reaches the lead

**Status: Proposed — sequenced after §DF-004-explore-injected-content-cap.6.**

The DF-004 cacheRead blow-up happens because the **lead** pulls whole file content into its
**persistent** transcript "to edit," and that replays into `cacheRead` for the rest of the run.
The static cap (§DF-004) attacks the symptom by truncating, which loses content the lead needed
and broke correctness (simdjson). This proposes attacking the cause: let the **sidekick** apply
edits so the file bytes never enter the lead's context. Grounded per §REQ-001-decision-log;
relates to §FS-001-ensemble-explore, §RM-001-bash-sidekick, §DF-004-explore-injected-content-cap.

## 1. Decision

Add an **edit-executor** role to the sidekick:

- The **lead authors the change** — intent + target, or an `old→new` spec — from the bounded
  discovery evidence it already has.
- The **sidekick applies** it to the file (it holds the file in its cheap, ephemeral context) and
  returns only a **compact diff** to the lead.
- The whole file is never injected into the lead's persistent transcript.

## 2. Hard constraint: executor, not author

The lead decides **what** changes; the sidekick only **applies and reports**. This preserves the
standing non-goal §RM-001-bash-sidekick.4 ("don't change what the lead decides or which edits it
makes"). The cheap ~24B model must not author fixes — graph-bash correctness is already fragile
(§REQ-003-strictly-better-than-baseline), and handing fix-authorship to a weak model would worsen
it. If the lead's edit spec needs more code to be precise, that comes as bounded discovery
evidence — never a whole-file pull.

## 3. Why this over a static cap

The cap is lossy: simdjson failed under 24 KB because the truncation removed the content the lead
used to edit. The executor keeps that content **sidekick-side** and applies the change there, so
there is **no truncation and no injection** — it can preserve correctness where the cap could not.
Its incremental value is largest for **multi-site / large-file edits** (simdjson's "edit all
`at_pointer` implementations"): the lead specifies the change once; the sidekick applies it across
sites without ever shipping tens of KB to the lead. Single-site edits are already fine via the
`edit` tool (no whole-file injection), so the executor is not needed there.

## 4. Estimated savings (if it works)

Anchored on the measured editing injection (cap A/B, graph-bash, simdjson-2178):

- uncapped (what the lead actually held to edit): **912 KB cacheRead / $1.15**
- 24 KB cap: 125 KB / $0.37

So the whole-file editing injection cost **~787 KB cacheRead / ~$0.78 on that one instance (≈ −86%)**.
The executor reclaims that **while preserving correctness** (the cap reclaimed it but lost the fix).

- **Per affected instance: up to ~80–86%** cacheRead/cost reduction — but correctness-preserving.
- **Suite-wide: concentrated, modest on the current non-C/C++ mix.** Per §DF-004-explore-injected-content-cap.6's
  early scan, large editing injections are rare outside C/C++/large-file repos (0/3 new benches hit
  the 24 KB cap). On benchmarks-20, simdjson's ~$0.78 is ~8% of one run's graph-bash cost from a
  single instance; aggregate suite savings on a graphify-strong mix are likely single-digit %.
- **It is an outlier-fix, not a broad lever:** it makes the worst large-edit instances cheap
  *and correct*, rather than shaving every run.

## 5. Risks / open questions

- The explore sidekick is **read-only today**; this adds edit/write capability and a new role.
- Iterative edits (fix → test-fail → refine) add lead↔sidekick round-trips.
- The lead's `old→new`/intent must be precise enough to apply without ambiguity given only bounded
  evidence.

## 6. Decision / next step

Not decided. Run **after §DF-004-explore-injected-content-cap.6**: if a higher fixed cap does not
cleanly recover correctness (expected — the failure is content-loss, not size), prototype the
executor and test head-to-head against the cap on simdjson + the multi-site editing instances.
Adopt only if it preserves correctness (§REQ-003-strictly-better-than-baseline) while cutting the
injection cost. Record the result here.
