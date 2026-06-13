# DF-022 — explore-sidekick model comparison (frozen results)

Frozen lightweight record of the DF-022 experiment (swap the `explore` sidekick model, lead fixed
at `oca/gpt-5.5`, arm `graph-bash`, `base/002-30`, K=3 cascade). Findings + chart:
`bench/README.md` → "DF-022 — Sidekick Model Comparison".

Per model subdir (`devstral2-120b`, `gpt-oss-120b`, `qwen3-coder-30b`, `qwen3-coder-30b-guarded`):
`s<k>/<inst>__graph-bash/{metrics.json, patch.diff, manifest.json, explore-metrics.jsonl}` and
`s<k>/validation/graph-bash/<inst>.json`, plus `REPORT.txt`. Run-level: `dropped.tsv` (ejects),
`active-ids.txt`, `*-cascade.setsid.log`, `df022-loop-killer.log`, `SCHEDULER.log`.

Heavy `explore-debug.jsonl` tool-call traces are **excluded** (≈14 MB; per the checkpoint
convention — heavy blobs stay local under `multiseed/df022-graph-bash-sidekicks/`). The loop
statistics derived from them are summarized in the README.

Headline: the repeat-guard (`PI_EXPLORE_MAX_CALLS=64`, `PI_EXPLORE_MAX_REPEAT=4`) converts
Qwen-30B's loops into completions (seed-1 eject 73%→3%, pass@3 23/27, stable@3 19/27). Cheap
sidekicks cut lead-model tokens vs classic (devstral2 −42%) except guarded Qwen (+1%).
