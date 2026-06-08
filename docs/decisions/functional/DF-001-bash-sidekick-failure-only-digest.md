# DF-001-bash-sidekick-failure-only-digest: Bash sidekick digests failures only; successful output is verbatim

The bash output sidekick (§RM-001-bash-sidekick.2.3) acts only on **failing** commands.
A failed command's large output may be digested to verdict + root cause; a **successful**
command's output is returned unchanged (standard truncation), identical to the no-sidekick
arm. Successful output is never head/tail-compacted or model-digested. Grounded per §REQ-001-decision-log.

## 1. Decision

- **Success (exit 0):** return output as-is — standard tail truncation only (last
  `DEFAULT_MAX_LINES`/`DEFAULT_MAX_BYTES`, plus the full-output path for very large output).
  No model digest, no head/tail compaction.
- **Failure (non-zero exit, timeout, abort):** if output is broad (> ~40 lines / 16 KB),
  digest to verdict + smallest actionable diagnostic; otherwise return it raw.

## 2. Benchmark

- **Run:** ensemble-vs-pi (`bench/`, `oca/gpt-5.5`), arms `classic` (digest off) vs
  `classic-bash` (digest on).
- **What happened — why success is not compacted:** head/tail-compacting *successful*
  exploration output (`rg`/`grep`/`sed`) dropped middle matches, so the lead re-ran narrower
  commands. Bash-call count rose `clap-rs/clap-5873` 14→24 and `tokio-rs/tokio-7124` 28→74.
  Because `cacheRead` scales with turn count, the extra turns erased the per-turn saving:
  tokio netted −5% tokens but **+18% cost**; clap **+18% tokens**.
- **What happened — why the failure digest stays:** the saving only appeared where a large
  *failing* log was collapsed — `serde-rs/serde-2798` −44% tokens, `zeromicro/go-zero-2787`
  −51%.
- **Confirmation:** after scoping to failures, a fresh `clap-5873` run showed `classic-bash`
  behaving identically to `classic` (17/17 bash results raw, 0 compactions); the regression
  source was gone and the residual delta was run-to-run trajectory noise.

## 3. Status

Implemented in `packages/coding-agent/src/core/tools/bash.ts`. Supersedes the
"compact broad successful output" behavior from the initial §RM-001-bash-sidekick.2.3 landing.
