# DF-022-sidekick-open-model-swap: run the explore sidekick on a small cheap open model (gpt-oss-120b / Devstral 2 / Qwen3-Coder-30B) while the lead stays gpt-5.5 — test whether bounded retrieval can be delegated to a cheaper model

**Status: PREPARED (not run) — parallel track, runs after the next exploration set merges.** Grounded per
§REQ-001-decision-log; this is the **sidekick-economics** counterpart to the primitive-lead track
(§DF-021-caveman-classic-primitive-levels). Tests the core ensemble thesis directly: the explore sidekick
is a **bounded retrieval task** (locate evidence, return compact pointers — §FS-001-ensemble-explore,
§DF-018-explore-no-raw-node-dumps), so it may not need a frontier model. Relates to every explore-cost
decision (§DF-015, §DF-016, §DF-020b) because it changes who pays for the explore replay they all measure.

## 1. Problem

Today the explore sidekick runs on **the lead's model** — `explore.ts:949` sets `const model =
context.model`, used to construct the sidekick `Agent` (`explore.ts:1102`). So in the `classic-graph(-bash)`
arms the gpt-5.5 sidekick does the heavy `search` / `source_slice` / `graph_*` fan-out (grpc-go-3258: 166
internal ops; simdjson-2178: 256 — §DF-020a), all billed at gpt-5.5 rates. If a small open model can return
**evidence of equal quality** for that bounded task, the ensemble's cost story improves structurally: lead
reasoning stays frontier-grade, retrieval gets cheap.

## 2. Decision (to validate)

Make the sidekick model independently selectable and benchmark three open models against the gpt-5.5
sidekick, **lead unchanged (oca/gpt-5.5)**.

**Candidate sidekick models (OpenRouter — provider `openrouter`, api `openai-completions`, key
`OPENROUTER_API_KEY`, already in the generated registry):**

| label | OpenRouter id | reasoning | note |
|---|---|---|---|
| control | `oca/gpt-5.5` | yes | current behaviour (sidekick = lead) |
| gpt-oss-120b | `openai/gpt-oss-120b` | yes | open MoE, large |
| devstral-2 | `mistralai/devstral-2512` | no | "Mistral: Devstral 2 2512", code-tuned |
| qwen3-coder-30b | `qwen/qwen3-coder-30b-a3b-instruct` | no | "Qwen3 Coder 30B A3B Instruct" |

(Qwen alternatives if the coder variant underperforms: `qwen/qwen3-30b-a3b`,
`qwen/qwen3-30b-a3b-instruct-2507`, `…-thinking-2507`.)

### Mechanism — `PI_EXPLORE_MODEL` override (code, apply on the post-merge branch)

In `runSidekick` (`explore.ts`), replace the unconditional `const model = context.model` with an env-gated
override resolved from the static registry via `getModel(provider, id)` (pi-ai), falling back to the lead
model. `getApiKeyAndHeaders` already resolves the OpenRouter key from `OPENROUTER_API_KEY`
(`env-api-keys.ts:112`), and the existing `streamFn` (`explore.ts:1107`) is provider-agnostic, so no other
change is needed. The thinking level is already clamped per-model (`clampThinkingLevel(model, "low")`,
`explore.ts:1098`) — for the `reasoning: false` candidates (Devstral, Qwen-coder) it clamps to off,
which is correct.

```
// explore.ts, top of runSidekick (replaces `const model = context.model;`)
//   PI_EXPLORE_MODEL format: "<provider>:<modelId>", e.g. "openrouter:qwen/qwen3-coder-30b-a3b-instruct".
//   Unset → sidekick uses the lead model (current behaviour).
const model = resolveExploreModel(context) ?? context.model;
if (!model) return undefined;
```

`resolveExploreModel` parses the env var, splits on the first `:`, calls `getModel(provider, id)`, and
returns `undefined` (with a one-line warn) on an unknown id so the run degrades to the lead model rather
than crashing. Top-level `import { getModel } from "@earendil-works/pi-ai"` (no inline import, per AGENTS).

### Bench wiring (apply on the post-merge branch)

Run the heaviest-sidekick arm, `classic-graph-bash`, once per candidate by setting `PI_EXPLORE_MODEL`.
Either a per-candidate arm alias in `config.sh` or a loop in a `multiseed`-style driver that exports
`PI_EXPLORE_MODEL` before each pass. The lead stays `oca/gpt-5.5`.

## 3. Validation (planned)

- **Instances:** the §base/003 scoped retry-heavy set (grpc-go-3258, simdjson-2178, dayjs-2532,
  dayjs-2399) + controls (clap-5873, express-5555) — the set where sidekick fan-out is largest and most
  costly.
- **Seeds:** K=3 directly per §REQ-005-research-checkpoints.0.
- **Arm:** `classic-graph-bash`, lead `oca/gpt-5.5`, sidekick ∈ {gpt-5.5 control, gpt-oss-120b,
  devstral-2512, qwen3-coder-30b}.

**Metrics:** pass@3 per instance per sidekick; **total cost split into lead vs sidekick** (the whole point —
a cheap sidekick should cut sidekick spend hard while lead spend is roughly flat); sidekick internal op
count and product bytes (does the small model probe more, or return worse evidence the lead must re-ask?).
**PASS gate:** pass@3 ≥ control on every instance **and** total cost down (cheaper sidekick not offset by
extra lead re-asks). **Watch:** a weak sidekick can *raise* total cost by returning thin/wrong evidence that
triggers the very re-ask loop §DF-020b fights — so judge on **total**, not sidekick price alone.

> **Note — the cost split this experiment needs does not exist yet (see §4).** A current
> `classic-graph-bash` run records only the **lead's** turns in its session jsonl (`metrics.json`:
> `assistantTurns: 5`, all `oca/gpt-5.5`); the sidekick's two explore calls leave **no token usage** in the
> session or metrics (`explore-debug.jsonl` logs tool calls, not tokens). So today `costUsd` is lead-only
> and the sidekick's compute is **uncounted**. This experiment's headline metric must be built first.

## 4. Prerequisites / open questions

- **GATING PREREQUISITE — sidekick usage is not captured at all today; it must be instrumented before this
  experiment can be measured.** Verified: `bench/lib/parse-session.mjs` sums per-message `usage` from the
  session jsonl and applies a single `--price` vector, and a `classic-graph-bash` session contains **only
  lead turns** (sidekick LLM calls live in `sidekick.state.messages` inside `explore.ts` and are never
  flushed to the session file). So the sidekick's tokens are neither counted nor model-tagged. Two changes
  are needed: (1) surface sidekick usage per call (e.g. have `runSidekick` emit its `sidekick.state` usage
  to a sink like the existing `PI_EXPLORE_DEBUG` log, tagged with the sidekick model id); (2) make the cost
  builder group usage **by `m.model`** and price each group from `PRICING` (add OpenRouter list prices for
  `openai/gpt-oss-120b`, `mistralai/devstral-2512`, `qwen/qwen3-coder-30b-a3b-instruct`). Each message
  already carries `m.model`, so the split is feasible once sidekick usage reaches the pipeline.
- **Past explore-cost results are unaffected but lead-only.** §DF-015/§DF-020b cost deltas are real (they
  measure lead `cacheRead` replay), but they never included sidekick compute — consistent with their
  framing, worth stating so DF-022's numbers are not compared against a different cost basis.
- **OpenRouter availability/throughput.** Key is present (`OPENROUTER_API_KEY` in env); confirm the three
  ids are live and rate limits tolerate K=3 × 6 instances × heavy fan-out.
- **`oca:` vs `openrouter:` provider prefix** in `PI_EXPLORE_MODEL` — the control keeps the lead's `oca/`
  model; the open models use `openrouter/`. The parser must handle both provider namespaces.
- **Tool-format compatibility.** The sidekick toolset (`graph_query`, `search`, `source_slice`, …) is
  function-calling; verify Devstral and Qwen-coder honour the same tool schema over OpenRouter's
  `openai-completions` wire before reading too much into a poor result.
