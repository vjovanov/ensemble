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

import { existsSync, readFileSync } from "node:fs";

const FALLBACK_MARKER = "Graphify unavailable";

function parseArgs(argv) {
  const o = { price: [0, 0, 0, 0] };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--arm") o.arm = argv[++i];
    else if (argv[i] === "--price") o.price = argv[++i].split(/\s+/).map(Number);
    else if (argv[i] === "--sidekick-metrics") o.sidekickMetrics = argv[++i];
    else if (!o.session) o.session = argv[i];
  }
  return o;
}

function emptyMetrics(model = "") {
  return {
    model,
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 0,
    costUsd: 0,
    assistantTurns: 0,
  };
}

function combineMetrics(lead, sidekick) {
  const model = [lead.model, sidekick.model].filter(Boolean).join(" + ");
  return {
    model,
    input: lead.input + sidekick.input,
    output: lead.output + sidekick.output,
    cacheRead: lead.cacheRead + sidekick.cacheRead,
    cacheWrite: lead.cacheWrite + sidekick.cacheWrite,
    totalTokens: lead.totalTokens + sidekick.totalTokens,
    costUsd: Number((lead.costUsd + sidekick.costUsd).toFixed(4)),
    assistantTurns: lead.assistantTurns + sidekick.assistantTurns,
  };
}

function parseSidekickMetrics(file) {
  const metrics = emptyMetrics();
  if (!file || !existsSync(file)) return metrics;

  let rawCost = 0;
  const models = new Set();
  const lines = readFileSync(file, "utf8").split("\n").filter(Boolean);
  for (const line of lines) {
    let e;
    try { e = JSON.parse(line); } catch { continue; }
    if (e.type !== "sidekick_usage") continue;
    if (e.model) models.add(e.model);
    metrics.input += e.input || 0;
    metrics.output += e.output || 0;
    metrics.cacheRead += e.cacheRead || 0;
    metrics.cacheWrite += e.cacheWrite || 0;
    metrics.assistantTurns += e.assistantTurns || 0;
    rawCost += e.cost?.total ?? e.costUsd ?? 0;
  }
  metrics.model = [...models].join(", ");
  metrics.totalTokens = metrics.input + metrics.output + metrics.cacheRead + metrics.cacheWrite;
  metrics.costUsd = Number(rawCost.toFixed(4));
  return metrics;
}

export function parseSession(file, { arm = "", price = [0, 0, 0, 0], sidekickMetrics } = {}) {
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
  const lead = {
    model, input, output, cacheRead, cacheWrite,
    totalTokens: input + output + cacheRead + cacheWrite,
    costUsd: Number(cost.toFixed(4)),
    assistantTurns,
  };
  const sidekick = parseSidekickMetrics(sidekickMetrics);
  const total = combineMetrics(lead, sidekick);

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
    lead, sidekick, total,
    strictOk, strictNote,
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const o = parseArgs(process.argv.slice(2));
  if (!o.session) { console.error("usage: node parse-session.mjs <session.jsonl> --arm <arm> --price 'in out cr cw'"); process.exit(2); }
  console.log(JSON.stringify(parseSession(o.session, { arm: o.arm, price: o.price, sidekickMetrics: o.sidekickMetrics }), null, 2));
}
