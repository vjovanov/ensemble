// Parse codex (`cdx exec --json`) event JSONL into the same metrics shape parse-session.mjs emits.
// Codex reports usage on `turn.completed` events: {input_tokens, cached_input_tokens,
// output_tokens, reasoning_output_tokens}. input_tokens INCLUDES cached_input_tokens, so the
// fresh (uncached) input is input_tokens - cached_input_tokens. We sum across turns (exec is
// normally one turn) and price with the same [in out cacheR cacheW] $/Mtok vector as the pi arms.
// Usage: node codex-metrics.mjs <events.jsonl> --arm codex --model M --price "5 30 0.5 0"
import { readFileSync } from "node:fs";

const argv = process.argv.slice(2);
const o = { arm: "codex", model: "oca/gpt-5.5", price: [0, 0, 0, 0] };
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === "--arm") o.arm = argv[++i];
  else if (argv[i] === "--model") o.model = argv[++i];
  else if (argv[i] === "--price") o.price = argv[++i].split(/\s+/).map(Number);
  else if (!o.events) o.events = argv[i];
}
if (!o.events) { console.error("usage: codex-metrics.mjs <events.jsonl> --arm codex --model M --price 'in out cr cw'"); process.exit(2); }

const [pIn, pOut, pCacheR] = o.price;
let input = 0, output = 0, cacheRead = 0, turns = 0;
for (const line of readFileSync(o.events, "utf8").split("\n")) {
  if (!line.trim()) continue;
  let e; try { e = JSON.parse(line); } catch { continue; }
  if (e.type !== "turn.completed" || !e.usage) continue;
  const u = e.usage;
  const cached = u.cached_input_tokens || 0;
  cacheRead += cached;
  input += Math.max(0, (u.input_tokens || 0) - cached);   // fresh input only
  output += (u.output_tokens || 0) + (u.reasoning_output_tokens || 0);
  turns++;
}
const cost = (pIn * input + pOut * output + pCacheR * cacheRead) / 1e6;
console.log(JSON.stringify({
  model: o.model, arm: o.arm,
  input, output, cacheRead, cacheWrite: 0,
  totalTokens: input + output + cacheRead,
  costUsd: Number(cost.toFixed(4)),
  assistantTurns: turns, exploreCalls: 0, exploreFallbacks: 0,
  strictOk: null, strictNote: "",
}, null, 2));
