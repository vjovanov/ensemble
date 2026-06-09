# DF-011-explore-shared-chokepoint: When a behavior is reached via multiple paths, fix at the deepest shared callee

**Status: Proposed — scoped multi-seed experiment off base/001.** Grounded per §REQ-001-decision-log;
addresses the nushell graph-bash failure; relates to §DF-008-explore-root-cause-tracing,
§REQ-005-research-checkpoints.

## 1. Problem — wrong-location (too local), missing the convergence point

base/001: graph-bash fails nushell 0/3. The bug is **single-chokepoint**, not multi-site (prior
multi-site hypothesis refuted): all three graded assertions — `… | detect columns`, `… e>| str length`,
`… o+e>| str length` — funnel through one function, `ChildProcess::into_bytes` (`process/child.rs`); a
one-line edit there satisfies all three (classic-graphify/codex do exactly this).

graph-bash instead fixed `detect_columns.rs` (the surface path of assertion 1 only) every seed → covers
1/3 assertions, fails the two redirection paths. The sidekick *did* surface `into_bytes`/`check_ok`, but
never tied the three invocation syntaxes to that single convergence point (the `e>|`/`o+e>|` paths were
nearly absent from its trace), so the lead picked a locally-plausible edit.

## 2. Decision

When the reproducing test exercises a behavior through **multiple syntaxes/commands**, the sidekick
must trace each to the function that performs the operation, identify the **deepest shared callee**,
recommend fixing at or below it, and **flag any candidate edit that covers only a subset of the paths
as INCOMPLETE**. For nushell this names `ChildProcess::into_bytes` as the convergence of all three
commands and marks a `detect_columns`-only edit incomplete.

## 3. Validation

Scoped multi-seed experiment off `base/001`: **nushell** (target) + **go-zero, tracing-2897**
(regression-risk Rust/Go controls) × 3 seeds, vs the frozen base. Pass: nushell pass@3 improves with no
control regression (§REQ-003-strictly-better-than-baseline). Record here.
