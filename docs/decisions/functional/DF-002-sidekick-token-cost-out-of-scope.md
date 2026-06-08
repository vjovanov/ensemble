# DF-002-sidekick-token-cost-out-of-scope: Sidekick token cost is not measured or optimized

The sidekick (explore + bash digest) runs on a cheap ~24B model, so its token cost is
immaterial against the expensive lead model. We do not capture, price, or optimize sidekick
tokens; the only tracked metric is lead-model cost. See §RM-001-bash-sidekick.4. Grounded
per §REQ-001-decision-log.

## 1. Decision

Treat sidekick model usage as free. Benchmark accounting counts only lead-model
input/output/cacheRead/cacheWrite. Do not build an "honest accounting" sidecar to attribute
sidekick tokens.

## 2. Benchmark

- **Run:** ensemble-vs-pi (`bench/`, `oca/gpt-5.5`).
- **What happened:** `bench/lib/parse-session.mjs` tallies only lead `assistant` turns, so the
  bash digest's own `completeSimple` calls were never in the metrics. The cost question that
  actually moved choices was lead-model cost — e.g. the graph arm cut tokens far more than cost
  (`clap-5873` −8% tokens but +30% cost; aggregate over clap+logstash+jackson −31% tokens /
  −11% cost) because explore evidence shifts `cacheRead` into higher-priced input. Rather than
  build a sidecar to count digest tokens, we pin the sidekick to a ~24B model whose per-token
  price is far below the lead, so its usage cannot change a decision.

## 3. Status

Recorded in §RM-001-bash-sidekick.4 as a non-goal.
