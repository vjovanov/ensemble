Why: project motivation. Each item is a `GRUND-` declaration; cite as `§GRUND-NNN-slug`.

# GRUND-001-decision-log: Ensemble decisions are grounded in benchmark evidence

We change ensemble behavior experiment-first. Every behavioral or design choice is
driven by a concrete benchmark observation, and is recorded so the reasoning survives —
both **what** we chose and the **evidence** that drove it. A choice we cannot tie to a
benchmark result is a guess, not a decision.

## 1. Every decision carries its example

Each decision (a `DF` or `DA` declaration) MUST cite its evidence:

- **which benchmark** — the run, the instance(s), and the arm(s) compared, and
- **what happened** — the metric or behavior observed that the decision responds to.

A decision without a benchmark example is not grounded. Record the example, or do not
record the decision as settled.

## 2. Where decisions live

- Product-behavior decisions and tradeoffs: `docs/decisions/functional` (`DF`).
- Architecture decisions and tradeoffs: `docs/decisions/architectural` (`DA`).

Every experiment — a benchmark run intended to inform a choice — must end in a decision
(`DF`/`DA`) so the result is not lost. This is enforced as a working rule in `AGENTS.md`.
