# DF-021-caveman-classic-primitive-levels: probe the primitive floor of lead exploration — layer increasingly blunt "caveman" skills onto the `classic` arm and find where cost drops and where correctness breaks

**Status: PREPARED (not run) — parallel track, runs after the next exploration set merges.** Grounded per
§REQ-001-decision-log; this is the **primitive-end** counterpart to the sidekick-sophistication track
(§DF-022-sidekick-open-model-swap) and attacks the same cost lever from the opposite direction as
§DF-015-explore-return-source-on-code-intent / §DF-020b-explore-decisive-search. Scope per the operator:
**`classic` only**, several **levels of primitive** to test.

## 1. Problem

The per-run breakdown (§base/002, README §Latest results) shows `classic`'s cost is dominated by
**`bash:read` ~58% of spend** — the lead's own raw exploration (grep/cat/read), not build/test (~$0.4/run
everywhere). Every cost experiment so far has attacked this by making exploration *more sophisticated*
(graph, sidekick digests, decisive call-chain answers). The unanswered question is the floor from the other
side: **how primitive can the lead's own exploration discipline be before correctness breaks** — and does a
blunt "locate once, read small, fix" discipline cut the read-replay that inflates `classic`?

`classic` has no graph and no explore sidekick; it is the lead driving bash directly. So this is purely a
**prompt/skill** intervention on the lead, exactly the surface `--skill` + `--append-system-prompt` already
exposes (the §FS-001 `classic-graphify` arm is the wiring template).

## 2. Decision (to validate)

Run `classic` with a ladder of primitive-discipline skills layered via `--skill`, holding everything else
(model, base prompt commit, instances, seeds) fixed. Each level is strictly more restrictive than the last:

- **L0 — baseline `classic`** (no skill): the control, frozen base numbers.
- **L1 — trimmed toolbelt** (`bench/skills/caveman/level1-trimmed.md`): locate with `rg` first, read only the
  located span (`sed -n`), no directory tours, stop searching once the edit site is named. Normal prose.
- **L2 — caveman** (`bench/skills/caveman/level2-caveman.md`): the same discipline in terse ALL-CAPS
  imperative ("FIND. READ SMALL. FIX. STOP."). Isolates whether **blunt phrasing** alone tightens adherence
  and cuts read-replay versus L1's identical-content prose.
- **L3 — stone tool** (`bench/skills/caveman/level3-stone-tool.md`): hard budget — ≤3 searches and ≤3 narrow
  reads before the first edit, never re-read a file. Deliberately too primitive; finds where correctness
  starts to fall.

The three skill files exist (scaffolded under `bench/skills/caveman/`). The point is the **shape of the
curve**: cost should fall L0→L1→L2→L3 while correctness holds then breaks; the useful level is the most
primitive one that does not regress pass@K.

## 3. Validation (planned)

New arm wiring (mirror `classic-graphify`): add a `classic-caveman` arm to `bench/config.sh` whose
`run-instance.sh` setup passes `SKILL_ARGS=(--skill "$CAVEMAN_SKILL")` with `CAVEMAN_SKILL` selecting the
level file, no graphify, no sidekick (it is `classic` plumbing). Run each level as its own pass so the four
points are directly comparable.

- **Instances:** the §base/003 scoped set used by the other explore experiments — retry-heavy
  grpc-go-3258 / simdjson-2178 / dayjs-2532 / dayjs-2399 (where read-replay is largest) plus controls
  clap-5873 / express-5555. Add 2–3 `classic`-resolved JS/TS wins to catch correctness breakage on tasks
  that genuinely need wide reading (e.g. svelte-15115, the wrong-phase case from §DF-016).
- **Seeds:** K=3 directly, per §REQ-005-research-checkpoints.0 (no single-seed screens).
- **Arm:** `classic-caveman` at L1, L2, L3 vs frozen `classic` (L0) base.

**Metrics:** lead `bash:read` bytes/turns and total cost per level; pass@3 per instance per level.
**PASS gate (per level):** pass@3 ≥ base on every instance **and** cost down vs L0; the recommended level is
the most primitive that still passes the gate. **Watch:** L3 is expected to regress correctness on
wide-reading tasks — that is the floor, reported, not a failure of the experiment.

## 4. Prerequisites / open questions

- **Arm not yet wired.** `classic-caveman` and `CAVEMAN_SKILL` are specified here but not added to
  `config.sh` / `run-instance.sh`; do that on the post-merge branch so it sits on the merged base.
- **L1 vs L2 is the interesting A/B** (identical discipline, prose vs caveman register). If they are within
  seed noise, the blunt register carries no signal and L1 is the keeper.
- **Levels are a starting ladder, not final.** "Different levels of primitive" — refine the rungs after the
  first curve (e.g. add an L1.5, or vary the L3 budget) once we see where the floor is.
