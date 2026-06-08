Why: project motivation. Each item is a `GRUND-` declaration; cite as `§GRUND-NNN-slug`.

# GRUND-001-cheap-sidekick-economics: Move read-only work off the expensive lead onto a cheap sidekick

The expensive lead model spends roughly half its turns on read-only exploration (grep/read)
and on build/test runs, and cached conversation replay (`cacheRead`) dominates total cost.
Delegating that work to a cheap (~24B) sidekick that returns tight digests — graph-based
code discovery and bash verdicts — should cut expensive-model cost substantially **without
changing what the lead decides or edits**. This is why the ensemble `explore` sidekick and
bash digest exist (§RM-001-bash-sidekick, §FS-001-ensemble-explore).

How we validate that claim — and the bar a modification must clear — lives in the
requirements: §REQ-001-decision-log, §REQ-002-benchmark-comparison-methodology, and
§REQ-003-strictly-better-than-baseline.
