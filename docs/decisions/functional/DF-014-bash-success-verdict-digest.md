# DF-014-bash-success-verdict-digest: Digest successful broad build/test output to a verdict; capture the raw out-of-band

**Status: Proposed — experiment off base/001.** Grounded per §REQ-001-decision-log; revises
§DF-001-bash-sidekick-failure-only-digest for build/test commands; relates to §RM-001-bash-sidekick.2.3,
§REQ-005-research-checkpoints.

## 1. Problem

§DF-001-bash-sidekick-failure-only-digest made the bash digest **failure-only** (success returns
verbatim) because compacting successful *exploration* output (rg/grep/sed) dropped matches the lead
re-fetched. But that leaves **successful build/test logs flooding the lead**: a `autoreconf && ./configure
&& make` success returned **51,066 chars / 735 lines** verbatim (20× perl-locale warnings, every
`checking for X… yes`, every libtool line) — it slipped 134 bytes under the 50 KB truncation cap, so
nothing trimmed it. That ~50 KB then replays into `cacheRead` every later turn, for one bit of signal:
*did it build?* (Observed via `explore-pairs.sh --sidekick bash`.)

## 2. Decision

Two changes:
1. **Success-verdict digest for build/test commands only.** On a *broad successful* run whose command
   matches a build/test shape (`cargo`/`make`/`cmake`/`ctest`/`configure`/`autoreconf`/`go test|build`/
   `mvn`/`gradle`/`npm|pnpm|yarn test|run|ci|build`/`pytest`/`meson`/`bazel`/…), digest to a verdict
   instead of returning verbatim. `rg`/`grep`/`cat`/`sed` successes stay verbatim (their exact values
   matter — the §DF-001 concern). A verdict ("built OK / N tests passed") does not invite re-grepping
   the way width-compaction did, *as long as the lead trusts it* (the risk to validate).
2. **Out-of-band raw capture.** When `PI_BASH_DIGEST_DEBUG_LOG` is set, append `{command, status,
   rawLines, rawBytes, rawOutput(clipped), digest}` to a per-run JSONL — like `explore-debug.jsonl`.
   Never reaches the lead (keeps the savings); lets `explore-pairs.sh --sidekick bash` show
   ORIGINAL → PROCESSED.

## 3. Validation

Scoped multi-seed off `base/001` on build-heavy instances (jq-3238 autoconf/make, simdjson cmake,
zstd-3438 make, tracing-2897/clap-5873 cargo) × 3 seeds, vs the frozen base. Pass: **no correctness
regression** (the lead must not start re-running builds because it distrusts the verdict —
§REQ-003-strictly-better-than-baseline) and **lower cost** on the build-heavy instances. Record here.
