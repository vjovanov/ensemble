// Parse a pi/ensemble session .jsonl into benchmark metrics.
//
// Session shape (verified against ~/.pi/agent/sessions):
//   { type:"message", message:{ role, usage:{input,output,cacheRead,cacheWrite,...}, model, content } }
//   assistant turns carry usage; toolResult entries carry { role:"toolResult", toolName, content[].text }
//
// Cost is computed from the pricing passed in (the in-file usage.cost is often 0).
// Strict-mode check: the explore tool appends "Graphify unavailable; used filesystem
// nodes" to its result text whenever it fell back (see explore.ts:617). For the
// ensemble-strict/graph-bash arms, that marker — or zero explore calls — fails the run.
//
// Usage: node parse-session.mjs <session.jsonl> --arm <arm> --price "in out cr cw"

import { readFileSync } from "node:fs";

const FALLBACK_MARKER = "Graphify unavailable";

function parseArgs(argv) {
  const o = { price: [0, 0, 0, 0] };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--arm") o.arm = argv[++i];
    else if (argv[i] === "--price") o.price = argv[++i].split(/\s+/).map(Number);
    else if (!o.session) o.session = argv[i];
  }
  return o;
}

export function parseSession(file, { arm = "", price = [0, 0, 0, 0] } = {}) {
  const [pIn, pOut, pCacheR, pCacheW] = price;
  const lines = readFileSync(file, "utf8").split("\n").filter(Boolean);

  let input = 0, output = 0, cacheRead = 0, cacheWrite = 0;
  let assistantTurns = 0;
  let exploreCalls = 0, exploreFallbacks = 0;
  let model = "";

  for (const line of lines) {
    let e;
    try { e = JSON.parse(line); } catch { continue; }
    if (e.type !== "message") continue;
    const m = e.message || e;

    if (m.role === "assistant" && m.usage) {
      assistantTurns++;
      model = m.model || model;
      input += m.usage.input || 0;
      output += m.usage.output || 0;
      cacheRead += m.usage.cacheRead || 0;
      cacheWrite += m.usage.cacheWrite || 0;
    }

    if (m.role === "toolResult" && m.toolName === "explore") {
      exploreCalls++;
      const text = (m.content || []).map((c) => c.text || "").join("\n");
      if (text.includes(FALLBACK_MARKER)) exploreFallbacks++;
    }
  }

  const cost =
    (pIn * input + pOut * output + pCacheR * cacheRead + pCacheW * cacheWrite) / 1e6;

  // Strict assertion only meaningful for graph-backed strict arms.
  let strictOk = null, strictNote = "";
  if (arm === "ensemble-strict" || arm === "graph-bash") {
    if (exploreCalls === 0) { strictOk = false; strictNote = "no explore calls (graph never exercised)"; }
    else if (exploreFallbacks > 0) { strictOk = false; strictNote = `${exploreFallbacks}/${exploreCalls} explore calls fell back to filesystem`; }
    else { strictOk = true; strictNote = `${exploreCalls} graph-derived explore calls`; }
  }

  return {
    model, arm,
    input, output, cacheRead, cacheWrite,
    totalTokens: input + output + cacheRead + cacheWrite,
    costUsd: Number(cost.toFixed(4)),
    assistantTurns, exploreCalls, exploreFallbacks,
    strictOk, strictNote,
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const o = parseArgs(process.argv.slice(2));
  if (!o.session) { console.error("usage: node parse-session.mjs <session.jsonl> --arm <arm> --price 'in out cr cw'"); process.exit(2); }
  console.log(JSON.stringify(parseSession(o.session, { arm: o.arm, price: o.price }), null, 2));
}
