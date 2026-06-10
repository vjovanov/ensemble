// Attribute each pi arm's lead-model spend to WHAT produced it (system/prompt, explore, bash,
// read/grep, edit, thinking, output), so we can see what to optimize. Two stacked-bar views:
//   plots/breakdown-cost.svg     — full $ (input + cached + output) by source.
//   plots/breakdown-context.svg  — context only (input + cached) by source — the replayed bulk.
//
// Model: for each assistant turn the API billed input_t (fresh) + cacheRead_t (replayed context).
// That context = system+prompt + every prior tool result + prior thinking/text. We split input_t
// and cacheRead_t (separately, since they're priced differently) across the blocks present,
// proportional to each block's token size, and sum per category over all turns. output_t is split
// across the blocks generated that turn (thinking / text / tool-call args). This reconciles to each
// session's measured totals; block sizes (chars/4) only set the split. codex has no per-block
// session, so it is excluded. Computed over the benchmarks classic resolves (seed-1 verdict),
// using the latest available sessions.
// Usage: node lib/token-breakdown.mjs [--table]
import { readFileSync, existsSync, readdirSync, writeFileSync, mkdirSync } from "node:fs";

const ARMS = [
  { key: "classic", label: "classic" },
  { key: "classic-graphify", label: "classic-graphify" },
  { key: "classic-graph-bash", label: "classic-graph-bash" },
];
const IN = 5e-6, CR = 0.5e-6, OUT = 30e-6;
const TABLE = process.argv.includes("--table");

const CATS = [
  { key: "system+prompt", color: "#BAB0AC" },
  { key: "bash:read", color: "#F28E2B" },        // file discovery via shell (ls/cat/sed/rg/find/git diff…)
  { key: "bash:build/test", color: "#9D5C0E" },  // compile/test (make/cargo/npm/configure…)
  { key: "bash:other", color: "#FBC79A" },       // misc shell (mkdir/echo/git add…)
  { key: "explore/graph", color: "#4E79A7" },     // graph discovery: explore sidekick OR lead-driven `graphify` queries
  { key: "edit", color: "#E15759" },
  { key: "thinking", color: "#B07AA1" },
  { key: "output", color: "#59A14F" },
];
// classic/graphify read files by running shell commands through `bash`; there is no separate read
// tool. So split bash by what the command does. explore (the sidekick) is what replaces bash:read.
const BUILD = /\b(make|cmake|ctest|cargo|configure|autoreconf|autogen|bootstrap|meson|bazel|gradlew?|mvn|npm|pnpm|yarn|pytest|tox|go\s+(test|build|run)|gcc|g\+\+|clang|rustc|tsc|jest|mocha|vitest)\b/;
const READ = /^\s*!?\s*(ls|cat|head|tail|sed|grep|rg|find|tree|wc|nl|awk|cut|stat|file|less|more|pwd|which|git\s+(diff|show|log|status|grep|blame|ls-files))\b/;
const GRAPH = /\bgraphify\b/;
const bashSubcat = (cmd) => { cmd = cmd || ""; return GRAPH.test(cmd) ? "explore/graph" : BUILD.test(cmd) ? "bash:build/test" : READ.test(cmd) ? "bash:read" : "bash:other"; };
const toolCat = (n) => n === "explore" ? "explore/graph"
  : /^(edit|write|str_replace|apply_patch|multiedit|create)$/.test(n || "") ? "edit"
  : /^(read|cat|grep|glob|ls|find|rg|tree)$/.test(n || "") ? "bash:read" : "bash:other";
const est = (s) => Math.max(1, Math.ceil((typeof s === "string" ? s.length : 0) / 4));

// classic-wins from the frozen seed snapshots (pass@K)
const BASE = "multiseed/base002";
const SEED_DIRS = readdirSync(BASE).filter((d) => /^s\d+$/.test(d)).sort().map((d) => `${BASE}/${d}`);
const classicResolved = (id) => SEED_DIRS.some((d) => { const p = `${d}/validation/classic/${id}.json`; return existsSync(p) && JSON.parse(readFileSync(p, "utf8")).resolved === true; });
const ids = [...new Set(SEED_DIRS.flatMap((d) => readdirSync(d)).map((b) => b.endsWith("__classic") ? b.slice(0, -9) : null).filter(Boolean))].filter(classicResolved);

const sessionFile = (id, arm) => {
  const dir = `raw/${id}__${arm}/session`;
  if (!existsSync(dir)) return null;
  const f = readdirSync(dir).filter((x) => x.endsWith(".jsonl")).sort().pop();
  return f ? `${dir}/${f}` : null;
};

function analyze(file) {
  const lines = readFileSync(file, "utf8").split("\n").filter(Boolean);
  const running = [];                 // context blocks: {cat, size}
  const ctxIn = {}, ctxCr = {}, out = {};
  const callCat = {};                 // toolCallId -> category (so the result lands in the same bucket)
  let firstTurn = true;
  for (const l of lines) {
    let e; try { e = JSON.parse(l); } catch { continue; }
    const m = e.message || e;
    if (m.role === "user" && Array.isArray(m.content)) {
      const t = m.content.map((c) => c.text || "").join("");
      if (t) running.push({ cat: "system+prompt", size: est(t) });
    } else if (m.role === "assistant" && m.usage) {
      const inp = m.usage.input || 0, cr = m.usage.cacheRead || 0, o = m.usage.output || 0;
      if (firstTurn) {
        const known = running.reduce((s, b) => s + b.size, 0);
        running.push({ cat: "system+prompt", size: Math.max(1, (inp + cr) - known) }); // anchor system overhead
        firstTurn = false;
      }
      const tot = running.reduce((s, b) => s + b.size, 0) || 1;
      const by = {};
      for (const b of running) by[b.cat] = (by[b.cat] || 0) + b.size;
      for (const [c, sz] of Object.entries(by)) { ctxIn[c] = (ctxIn[c] || 0) + inp * sz / tot; ctxCr[c] = (ctxCr[c] || 0) + cr * sz / tot; }
      const gen = [];
      for (const c of m.content || []) {
        if (c.type === "thinking") gen.push({ cat: "thinking", size: est(c.thinking || "") });
        else if (c.type === "text") gen.push({ cat: "output", size: est(c.text || "") });
        else if (c.type === "toolCall") {
          const cat = c.name === "bash" ? bashSubcat(c.arguments?.command || c.arguments?.cmd || "") : toolCat(c.name);
          callCat[c.id] = cat;
          gen.push({ cat, size: est(JSON.stringify(c.arguments || {})) });
        }
      }
      const gt = gen.reduce((s, b) => s + b.size, 0) || 1;
      for (const b of gen) out[b.cat] = (out[b.cat] || 0) + o * b.size / gt;
      for (const b of gen) running.push(b);
    } else if (m.role === "toolResult") {
      const t = (m.content || []).map((x) => x.text || "").join("");
      const cat = callCat[m.toolCallId] || toolCat(m.toolName);
      running.push({ cat, size: est(t) });
    }
  }
  return { ctxIn, ctxCr, out };
}

// aggregate $ per category per arm
const armData = ARMS.map((a) => {
  const cost = {}, context = {}; let n = 0;
  for (const id of ids) {
    const f = sessionFile(id, a.key); if (!f) continue;
    let r; try { r = analyze(f); } catch { continue; }
    n++;
    for (const c of CATS.map((x) => x.key)) {
      const ctx$ = (r.ctxIn[c] || 0) * IN + (r.ctxCr[c] || 0) * CR;
      const full$ = ctx$ + (r.out[c] || 0) * OUT;
      context[c] = (context[c] || 0) + ctx$;
      cost[c] = (cost[c] || 0) + full$;
    }
  }
  // Scale the session-derived split to the measured totals across ALL seeds (what the cost/token
  // graphs sum), so every graph reconciles. Sessions exist only for the latest seed; the SPLIT is
  // what they provide, the absolute total comes from the frozen per-seed metrics.
  let canonFull = 0, canonCtx = 0;
  for (const id of ids) for (const d of SEED_DIRS) {
    const p = `${d}/${id}__${a.key}/metrics.json`;
    if (!existsSync(p)) continue;
    const m = JSON.parse(readFileSync(p, "utf8"));
    canonFull += m.costUsd; canonCtx += m.input * IN + m.cacheRead * CR;
  }
  // divide by THIS arm's seed count (arms can have different K, e.g. classic/graph-bash=3, graphify=2)
  const armSeeds = SEED_DIRS.filter((d) => ids.some((id) => existsSync(`${d}/${id}__${a.key}/metrics.json`))).length || 1;
  canonFull /= armSeeds; canonCtx /= armSeeds;   // $ per run, to match the cost graph
  const sumFull = CATS.reduce((s, c) => s + (cost[c.key] || 0), 0) || 1;
  const sumCtx = CATS.reduce((s, c) => s + (context[c.key] || 0), 0) || 1;
  const fF = canonFull / sumFull, fX = canonCtx / sumCtx;
  for (const c of CATS.map((x) => x.key)) { cost[c] = (cost[c] || 0) * fF; context[c] = (context[c] || 0) * fX; }
  return { ...a, cost, context, n };
});

if (TABLE) {
  for (const view of ["cost", "context"]) {
    const label = view === "cost" ? "Full $ (input+cached+output)" : "Context only (input+cached)";
    let out = `#### ${label} by source — over classic's wins\n\n`;
    out += `| source | ${ARMS.map((a) => a.label).join(" | ")} |\n|---|${ARMS.map(() => "---").join("|")}|\n`;
    for (const c of CATS.map((x) => x.key)) {
      const vals = armData.map((d) => "$" + (d[view][c] || 0).toFixed(2));
      if (vals.every((v) => v === "$0.00")) continue;
      out += `| ${c} | ${vals.join(" | ")} |\n`;
    }
    out += `| **total** | ${armData.map((d) => "**$" + CATS.reduce((s, c) => s + (d[view][c.key] || 0), 0).toFixed(2) + "**").join(" | ")} |\n\n`;
    process.stdout.write(out);
  }
  process.exit(0);
}

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;");
mkdirSync("plots", { recursive: true });

function stack({ file, title, sub, view }) {
  const n = ARMS.length, Wd = 760, H = 500, L = 60, Rm = 150, T = 96, B = 70, plotH = H - T - B;
  const band = (Wd - L - Rm) / n, bw = Math.min(120, band * 0.62), cx = (i) => L + band * (i + 0.5);
  const totalOf = (d) => CATS.reduce((s, c) => s + (d[view][c.key] || 0), 0);
  const ymax = Math.ceil(Math.max(...armData.map(totalOf)) * 1.12 * 10) / 10;
  const y = (v) => T + plotH * (1 - v / ymax);
  let s = `<svg xmlns="http://www.w3.org/2000/svg" width="${Wd}" height="${H}" viewBox="0 0 ${Wd} ${H}" font-family="system-ui,Segoe UI,Helvetica,Arial,sans-serif">
<rect width="${Wd}" height="${H}" fill="#ffffff"/>
<text x="${(Wd - Rm) / 2 + 10}" y="26" text-anchor="middle" font-size="16" font-weight="600" fill="#111">${esc(title)}</text>
<text x="${(Wd - Rm) / 2 + 10}" y="44" text-anchor="middle" font-size="11" fill="#666">${esc(sub)}</text>`;
  for (let t = 0; t <= 5; t++) { const v = ymax * t / 5, yy = y(v); s += `<line x1="${L}" y1="${yy.toFixed(1)}" x2="${Wd - Rm}" y2="${yy.toFixed(1)}" stroke="#eee"/><text x="${L - 8}" y="${(yy + 4).toFixed(1)}" text-anchor="end" font-size="10" fill="#999">$${v.toFixed(0)}</text>`; }
  // legend (right)
  let ly = T;
  for (const c of CATS) { s += `<rect x="${Wd - Rm + 16}" y="${ly}" width="12" height="12" fill="${c.color}"/><text x="${Wd - Rm + 33}" y="${ly + 11}" font-size="11" fill="#333">${esc(c.key)}</text>`; ly += 20; }
  for (let i = 0; i < n; i++) {
    const d = armData[i], x0 = cx(i) - bw / 2; let acc = 0;
    for (const c of CATS) {
      const v = d[view][c.key] || 0; if (v <= 0) continue;
      const yTop = y(acc + v), h = y(acc) - y(acc + v);
      s += `<rect x="${x0}" y="${yTop.toFixed(1)}" width="${bw}" height="${h.toFixed(1)}" fill="${c.color}"/>`;
      if (h > 12) s += `<text x="${cx(i)}" y="${(yTop + h / 2 + 3).toFixed(1)}" text-anchor="middle" font-size="9.5" fill="#fff">$${v.toFixed(2)}</text>`;
      acc += v;
    }
    s += `<text x="${cx(i)}" y="${(y(acc) - 8).toFixed(1)}" text-anchor="middle" font-size="15" font-weight="700" fill="#222">$${acc.toFixed(2)}</text>`
      + `<text x="${cx(i)}" y="${H - B + 22}" text-anchor="middle" font-size="12" font-weight="600" fill="#333">${esc(d.label)}</text>`
      + `<text x="${cx(i)}" y="${H - B + 38}" text-anchor="middle" font-size="9.5" fill="#888">${d.n} sessions</text>`;
  }
  writeFileSync(file, s + `</svg>\n`);
}

stack({ file: "plots/breakdown-cost.svg", view: "cost",
  title: "Where the $ goes (per run) — full spend by source",
  sub: `input+cached+output attributed to what produced it, summed over classic's ${ids.length} wins` });
stack({ file: "plots/breakdown-context.svg", view: "context",
  title: "Where the context $ per run goes — input + cached by source",
  sub: `the replayed-context bulk attributed to its source, over classic's ${ids.length} wins` });

// ---- per-benchmark breakdown: one stacked bar per benchmark, one graph per arm ----
const perRunCost = (id, k) => {
  const cs = SEED_DIRS.map((d) => { const p = `${d}/${id}__${k}/metrics.json`; return existsSync(p) ? JSON.parse(readFileSync(p, "utf8")) : null; })
    .filter((m) => m && typeof m.costUsd === "number").map((m) => m.costUsd);
  return cs.length ? cs.reduce((s, x) => s + x, 0) / cs.length : 0;   // $ per run (mean over seeds)
};
const perBenchData = (k) => ids.map((id) => {
  const f = sessionFile(id, k);
  let r = null; if (f) { try { r = analyze(f); } catch { r = null; } }
  const cat = {}; let st = 0;
  if (r) for (const c of CATS.map((x) => x.key)) { const v = (r.ctxIn[c] || 0) * IN + (r.ctxCr[c] || 0) * CR + (r.out[c] || 0) * OUT; cat[c] = v; st += v; }
  const per = perRunCost(id, k), f2 = st > 0 ? per / st : 0;   // scale session split to per-run cost
  for (const c of CATS.map((x) => x.key)) cat[c] = (cat[c] || 0) * f2;
  return { id, short: id.includes("__") ? id.split("__")[1] : id, cat, total: per };
}).filter((d) => d.total > 0).sort((a, b) => b.total - a.total);

function stackPerBench({ file, title, sub, data }) {
  const Lm = 168, Rm = 150, top = 70, barH = 9, rowH = 13, Wd = 900, plotW = Wd - Lm - Rm;
  const N = data.length, H = top + N * rowH + 24;
  const xmax = Math.ceil(Math.max(...data.map((d) => d.total), 0.1) * 10) / 10;
  const xticks = Math.max(1, Math.round(xmax / 0.5)), x = (v) => Lm + plotW * v / xmax;
  let s = `<svg xmlns="http://www.w3.org/2000/svg" width="${Wd}" height="${H}" viewBox="0 0 ${Wd} ${H}" font-family="system-ui,Segoe UI,Helvetica,Arial,sans-serif">
<rect width="${Wd}" height="${H}" fill="#ffffff"/>
<text x="${Lm + plotW / 2}" y="26" text-anchor="middle" font-size="16" font-weight="600" fill="#111">${esc(title)}</text>
<text x="${Lm + plotW / 2}" y="44" text-anchor="middle" font-size="11" fill="#666">${esc(sub)}</text>`;
  for (let t = 0; t <= xticks; t++) { const v = xmax * t / xticks, xx = x(v); s += `<line x1="${xx.toFixed(1)}" y1="${top - 6}" x2="${xx.toFixed(1)}" y2="${H - 16}" stroke="#eee"/><text x="${xx.toFixed(1)}" y="${top - 10}" text-anchor="middle" font-size="10" fill="#999">$${v.toFixed(1)}</text>`; }
  let ly = top; for (const c of CATS) { s += `<rect x="${Wd - Rm + 16}" y="${ly}" width="11" height="11" fill="${c.color}"/><text x="${Wd - Rm + 31}" y="${ly + 10}" font-size="10.5" fill="#333">${esc(c.key)}</text>`; ly += 18; }
  data.forEach((d, ri) => {
    const yTop = top + ri * rowH;
    s += `<text x="${Lm - 6}" y="${yTop + barH - 1}" text-anchor="end" font-size="9" fill="#444">${esc(d.short)}</text>`;
    let acc = 0;
    for (const c of CATS) { const v = d.cat[c.key] || 0; if (v <= 0) continue; const w = x(acc + v) - x(acc); s += `<rect x="${x(acc).toFixed(1)}" y="${yTop}" width="${Math.max(0.4, w).toFixed(1)}" height="${barH}" fill="${c.color}"/>`; acc += v; }
    s += `<text x="${(x(acc) + 4).toFixed(1)}" y="${yTop + barH - 1}" font-size="8.5" fill="#666">$${acc.toFixed(2)}</text>`;
  });
  writeFileSync(file, s + `</svg>\n`);
}
for (const a of ARMS) stackPerBench({
  file: `plots/breakdown-bench-${a.key}.svg`,
  title: `Per-benchmark spend by source — ${a.label}`,
  sub: `$ per run by source, over the ${ids.length} benchmarks classic resolves (sorted by cost)`,
  data: perBenchData(a.key),
});

console.log(`wrote breakdown-cost.svg + breakdown-context.svg over classic's ${ids.length} wins`);
for (const d of armData) {
  const tc = CATS.reduce((s, c) => s + (d.cost[c.key] || 0), 0);
  const top = CATS.map((c) => [c.key, d.cost[c.key] || 0]).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k, v]) => `${k} $${v.toFixed(2)}`).join(", ");
  console.log(`  ${d.label.padEnd(20)} ${d.n} sessions  total $${tc.toFixed(2)}  top: ${top}`);
}
