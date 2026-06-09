# DF-007-lead-driven-graphify-skill: Lead-driven graphify (skill) is more correct than the sidekick but costs more

**Status: Measured — keep the arm; informs §DA-002-compile-test-fix-sidekick.** Grounded per
§REQ-001-decision-log; relates to §FS-001-ensemble-explore, §DF-006-explore-giveup-and-supplement-guard.

## 1. What was tested

A new `classic-graphify` arm: classic exploration (NO pi explore sidekick) + graphify's own shipped
`skill.md`, so the **lead drives graphify directly via bash** against an in-tree `graphify-out/` graph.
Compared to `classic` (no graph) and `classic-graph` (the graphify **sidekick**).

## 2. The passive skill is ignored; a hard directive is required

With the skill merely *available* (its description in the system prompt), the lead **never used
graphify** — 0 CLI calls / 0 skill reads on darkreader (small), tokio and serde (large); on tokio it
even excluded `graphify-out/` from ripgrep. Only a **hard `--append-system-prompt` directive** ("you
MUST use graphify to locate code before reading/editing") got it used (darkreader 0→2 calls; 2–8 calls
across the set). Lesson: a passive skill is not a behavior lever for pi's lead on fix tasks.

## 3. Result (hard directive, the 11 classic-resolved instances)

vs **classic**: graphify **$5.19 / 4.20M** vs classic **$6.45 / 5.62M** → **−19% cost / −25% tok,
resolved 11/11**. Strong on C/C++ (zstd-3438 −34%, zstd-3942 −35%, simdjson −30%, jq-3238 −21%);
loses on small cases (clap +44%, jq-2919 +49%, darkreader +14%, go-zero +18%).

vs **classic-graph (sidekick)**: graphify resolves **11/11 vs the sidekick's 9/11** — it fixes
**nushell** (the sidekick's cheap-give-up, §DF-006-explore-giveup-and-supplement-guard) and **bat**
(sidekick failed at $0.32; skill fixed at $0.14). But on the 9 both resolve, the skill is **+12% cost
/ +41% tok** more expensive — because lead-driven graphify output replays into the lead's persistent
`cacheRead`, whereas the sidekick **digests** it first.

## 4. Takeaway

Clean tradeoff: **the sidekick is cheaper (digestion) but more fragile (give-up, whiffs); the skill is
more correct/robust but pricier (no digestion).** The ideal combines the sidekick's digestion with the
skill's don't-give-up persistence and lead control — which is what §DA-002-compile-test-fix-sidekick's
lead-controlled green-loop targets. Surprising sub-result: lead-driven graphify is **strong on C/C++**,
the exact area where the sidekick is graphify-weak — driving graphify from the lead sidesteps the
sidekick's identifier-whiff problem (§RM-001-bash-sidekick.2.1).

## 5. Caveat (measurement integrity)

The −19% vs classic is approximate: the `classic` baseline metrics predate this run (cross-arm drift,
see §REQ-004-experiment-hygiene.6). A clean claim needs classic + classic-graphify from one consistent
run at the same commit.
