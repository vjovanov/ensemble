# DF-003-bash-success-output-compaction: Width-preserving compaction of broad successful output

**Status: Proposed — under discussion, pending experiment (§RM-001-bash-sidekick.3 item 5).**

Open question: how to bound the size of *broad successful* bash output without dropping the
information the lead needs. §DF-001-bash-sidekick-failure-only-digest settled that successful
output is returned verbatim (digest reserved for failures); this revisits the size of that
verbatim output. Grounded per §GRUND-001-decision-log.

## 1. The trade-off

A broad successful exploration command (e.g. a repo-wide `rg`) produces a large result that
the lead does not fail on. Two prior behaviors, each wrong in one direction:

- **Head/tail compaction (original §RM-001-bash-sidekick.2.3 landing):** shrank the output but
  dropped the **middle** — and for `rg`/`grep` the middle is *matches*. The lead re-ran narrower
  commands to recover them (see §DF-001-bash-sidekick-failure-only-digest benchmark: clap 14→24,
  tokio 28→74 bash calls).
- **Verbatim (current, §DF-001-bash-sidekick-failure-only-digest):** no dropped matches, no
  re-greps — but a fat one-shot result replays into `cacheRead` on every later lead turn.

We want both: bounded bytes **and** no dropped match locations.

## 2. Benchmark where it happened

- **Run:** ensemble-vs-pi (`bench/`, `oca/gpt-5.5`), arm `classic-bash`, instance
  `fasterxml/jackson-core-1309`.
- **What happened:** classic and classic-bash both ran 7 turns, yet classic-bash cost +48%
  tokens (36k → 53k). The entire gap was one opening `rg`: classic typed a narrowed
  `rg "looksLikeValidNumber" -n . && rg "class NumberInput…"` → **8.3 KB**; classic-bash typed a
  broader `rg -n "looksLikeValidNumber|NumberInput" ."` → **19.3 KB**, returned verbatim (per
  §DF-001-bash-sidekick-failure-only-digest), and that 19 KB replayed across the remaining turns.
  The bloat is dominated by a few long match lines (matches in generated/large files), not by the
  number of matches.

## 3. Proposed approach: clip line *width*, preserve line *count*

`rg`/`grep` output is `path:line:match`; the lead needs the *match locations*, which live at the
start of each line. So compact along the axis that is not information:

- Keep **every** line (every match location survives → no re-grep).
- Clip each line to a max width (`clipLineBytes` / `BASH_COMPACT_FALLBACK_LINE_BYTES`, ~240 B) —
  removes the byte bloat from long lines.
- Only if the line *count* is very large (e.g. > 200) tail-truncate the overflow and keep the
  full-output path.

Lossless for "where are the matches", bounded in bytes. If the lead needs a long match line in
full, it reads that `file:line` directly — cheaper than a re-grep.

## 4. Alternatives considered

- **Route broad `rg` output to the 24B sidekick to summarize** ("matches in A:12, B:40…"):
  lossy in the match-content dimension and risks the same re-grep; rejected in favor of a
  deterministic clip.
- **Leave verbatim:** the current state; loses the one-shot saving (this benchmark).
- **Strategic alternative — drive discovery through `explore` so the lead never `rg`s.** This is
  the real cure (graph arms win by replacing lead grepping), but it does not exist in the
  `classic`/`classic-bash` arms (exploration=classic, `explore` calls = 0). Width-preserving
  compaction is the fix that also helps those arms; it does not replace the explore lever.

## 5. Decision / next step

Not decided. Run the experiment in §RM-001-bash-sidekick.3 (item 5): implement width-preserving
compaction for broad successful output, re-run the rg-heavy `classic-bash` instances (jackson,
tokio, clap), and track **bash-call count and tokens**. Adopt only if it shrinks bytes without
raising call count; record the outcome here.
