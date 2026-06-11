# DA-002-compile-test-fix-sidekick: A sidekick owns the build→test→apply green-loop; the lead's authority over fixes is a tunable dial

**Status: Deferred (revisit after explore is finished). Measured addressable = ~52% of lead cost.**
The verify/iterate tail (every turn from the first build onward — build runs + re-edit cycles + replayed
build output) is **$5.59 of $10.77/seed (52%)** on graph-bash's 26 classic-wins; 11/26 actually iterate.
Earlier shelving cited `bash:build/test` ≈ $0.4/run, but that is only build *execution* — the real cost
is the iteration *turns* (lead thinking/edits/replay), so the "~50% lever" framing holds. Dual lever:
cost (offload the tail) **and** correctness (iterate-to-green is what the fix-quality misses dayjs/jq/jib
need). Caveat: the grading test is hidden → needs a self-authored reproduction, which caps both gains.
Grounded per §REQ-001-decision-log. Subsumes §DA-001-edit-executor-sidekick (edit application) and
§DF-005-compile-test-turn-delegation (test delegation) into one role; gated by
§REQ-003-strictly-better-than-baseline; revisits §DF-002-sidekick-token-cost-out-of-scope.

## 1. Decision

Add a **compile-test-fix** sidekick role that owns the green-loop mechanics — run the project's
build/test, apply edits, iterate, and return **verdict + final diff** — so the build/test grind, the
re-runs, and (per §DA-001-edit-executor-sidekick) the file bytes never enter the lead's persistent
transcript. This targets the biggest cost bucket: on the resolved-by-both set, build/test turns are
**38% of graph-bash cost** ($1.39) and explore another 30% — only ~24% ($0.90) is irreducible
edit/reasoning (§DF-005-compile-test-turn-delegation.2). It is the load-bearing lever for the 50% target.

## 2. The authority dial — what "fix" means (the experiment)

How much fix-authority the sidekick holds trades savings against correctness risk. Run all three as
arms; let §REQ-003-strictly-better-than-baseline decide which is adoptable:

- **Mode A — apply + compile-fix only.** Sidekick applies lead-authored edits and iterates ONLY on
  **mechanical compile errors** (imports, types, signatures) to reach a compiling state. Any
  test/logic failure returns to the lead with a root-cause digest. Preserves the
  §DA-001-edit-executor-sidekick.2 executor-not-author constraint. Lowest risk; captures the re-run
  waste + compile grind. Suggested model tier: ~24B.
- **Mode B — bounded autonomous fix.** Also attempts small, local TEST fixes within a tight bound
  (≤N iterations), escalating to the lead if it can't go green. Captures more turns; introduces
  overfit/wrong-fix risk. Suggested tier: mid (e.g. ~70B).
- **Mode C — full green-loop authority.** Sidekick authors logic fixes until tests pass, returning
  verdict + diff. Maximum savings and can newly *resolve* large currently-unsolved instances.
  Directly relaxes executor-not-author, so it is only defensible on a **capable model (~120B)** and
  only if it survives §3's honest grading. Suggested tier: ~120B.

## 3. Why the benchmark is a fair, un-gameable gate

In Multi-SWE-bench the agent never sees the hidden f2p/p2p grading tests — it runs only the repo's
**existing** tests during the loop. So even Mode C cannot overfit to the grading target: a
green-but-wrong patch (existing tests pass, hidden tests fail) is graded **unresolved**. This makes
§REQ-003-strictly-better-than-baseline a fair correctness gate on all three modes — we measure which
authority level actually preserves correctness, not which one merely looks resolved. (Production
overfitting risk against the user's own tests remains real and is a separate adoption concern.)

## 4. Estimated savings (resolved-by-both, classic baseline $4.86; graph-bash today $3.68 = −24%)

- Mode A captures injection (§DA-001-edit-executor-sidekick) + re-run/compile waste — projected **~−40–45%**.
- Modes B/C capture most of the $1.39 build/test bucket and can resolve large unsolved instances
  (tokio/serde/insomnia, $1+ each, excluded from today's headline) — the path **past −50%**, with
  correctness variance rising with authority.

## 5. Risk: sidekick cost stops being free (revisits §DF-002)

§DF-002-sidekick-token-cost-out-of-scope treats sidekick tokens as immaterial because it is a cheap
~24B. A fix-authoring sidekick on a ~120B (Mode C) does real, expensive work — "sidekick tokens are
free" no longer holds for honest TOTAL cost. The benchmark headline stays lead-model cost, but for
Modes B/C we MUST also **report** sidekick token cost alongside, so a −50% lead saving that merely
shifts spend to a 120B sidekick is not mistaken for a real saving.

## 6. Decision / next step

Not decided. Implement the three modes (read-only explore sidekick gains apply/run capability and a
bounded loop), run arms `classic-graph-bash-ctf{A,B,C}` against classic + classic-graph-bash on the
resolved-by-both set plus the large unsolved instances (tokio-7124, serde-2798, Kong/insomnia-7734),
grade with hidden f2p, and record per-mode lead cost, sidekick cost (§5), and resolved count. Adopt
the highest-authority mode that still satisfies §REQ-003-strictly-better-than-baseline. Record here.
