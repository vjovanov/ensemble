// DF-022 sidekick comparison chart: successes + lead-model tokens per arm vs the `classic`
// baseline, on base/002-30, seed 1 (the apples-to-apples slice — every full-cascade arm
// attempted all 30 at seed 1). Flat-schema arms (classic, gpt-5.5 sidekick) report a single
// gpt-5.5 figure; sidekick arms report lead (gpt-5.5) separately from the cheap sidekick.
//   plots/df022-sidekicks.svg
// Usage: node lib/plot-df022.mjs
import { readFileSync, existsSync, readdirSync, writeFileSync } from "node:fs";

const ROOT = "multiseed/df022-graph-bash-sidekicks";
const ARMS = [
  { label: "classic", sub: "no sidekick", dir: "multiseed/base002/s1", key: "classic", color: "#4C78A8", baseline: true },
  { label: "gpt-5.5", sub: "sidekick", dir: "multiseed/base002/s1", key: "classic-graph-bash", color: "#72B7B2" },
  { label: "devstral2", sub: "123B", dir: `${ROOT}/devstral2-120b/s1`, key: "graph-bash", color: "#54A24B" },
  { label: "gpt-oss", sub: "120B · 8-subset", dir: `${ROOT}/gpt-oss-120b/s1`, key: "graph-bash", color: "#B07AA1", subset: true },
  { label: "qwen-30B", sub: "no guard", dir: `${ROOT}/qwen3-coder-30b/s1`, key: "graph-bash", color: "#E45756" },
  { label: "qwen-30B", sub: "+ guard", dir: `${ROOT}/qwen3-coder-30b-guarded/s1`, key: "graph-bash", color: "#F58518" },
];

const readJ = (p) => (existsSync(p) ? JSON.parse(readFileSync(p, "utf8")) : null);
const leadTok = (m) => (m.lead && typeof m.lead === "object" ? m.lead.totalTokens : m.totalTokens) || 0;
const skTok = (m) => (m.sidekick && m.sidekick.model ? m.sidekick.totalTokens : 0) || 0;

for (const a of ARMS) {
  let n = 0, res = 0, L = 0, S = 0;
  const vdir = `${a.dir}/validation/${a.key}`;
  for (const d of readdirSync(a.dir).filter((x) => x.endsWith(`__${a.key}`))) {
    const m = readJ(`${a.dir}/${d}/metrics.json`);
    if (!m || m.note === "no session") continue;
    n++; L += leadTok(m); S += skTok(m);
    const inst = d.replace(`__${a.key}`, "");
    const v = readJ(`${vdir}/${inst}.json`);
    if (v && v.resolved) res++;
  }
  a.n = n; a.res = res; a.lead = n ? Math.round(L / n) : 0; a.sk = n ? Math.round(S / n) : 0;
}

const base = ARMS.find((a) => a.baseline);
// ---- SVG layout: two stacked panels ----
const W = 900, padL = 64, padR = 24, barW = 78, gap = 50;
const x0 = padL + 30;
const panelH = 230, gapY = 70, topA = 40, topB = topA + panelH + gapY;
const H = topB + panelH + 56;
const xOf = (i) => x0 + i * (barW + gap);
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;");
const out = [];
out.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" font-family="-apple-system,Segoe UI,Roboto,sans-serif" font-size="13">`);
out.push(`<rect width="${W}" height="${H}" fill="white"/>`);
out.push(`<text x="${padL}" y="24" font-size="16" font-weight="700">DF-022 — explore sidekick: successes &amp; lead-model tokens vs classic (base/002-30, seed 1)</text>`);

// Panel A: successes (resolved count, attempted=30 except subset arms)
const maxRes = 30;
const aH = panelH - 40, aBase = topA + aH;
out.push(`<text x="${padL}" y="${topA - 6}" font-weight="700">Successes (resolved)</text>`);
for (const g of [0, 10, 20, 30]) {
  const y = aBase - (g / maxRes) * aH;
  out.push(`<line x1="${x0}" y1="${y}" x2="${W - padR}" y2="${y}" stroke="#eee"/>`);
  out.push(`<text x="${x0 - 8}" y="${y + 4}" text-anchor="end" fill="#888">${g}</text>`);
}
ARMS.forEach((a, i) => {
  const x = xOf(i), h = (a.res / maxRes) * aH, y = aBase - h;
  // subset arm (gpt-oss ran only 8): translucent fill + dashed outline so it reads as "not /30"
  const extra = a.subset ? ` fill-opacity="0.45" stroke="${a.color}" stroke-width="1.5" stroke-dasharray="4 3"` : (a.baseline ? ' stroke="#1b3a5b" stroke-width="2"' : "");
  out.push(`<rect x="${x}" y="${y}" width="${barW}" height="${h}" fill="${a.color}"${extra}/>`);
  out.push(`<text x="${x + barW / 2}" y="${y - 6}" text-anchor="middle" font-weight="700">${a.res}/${a.n}</text>`);
});

// Panel B: lead tokens/run with classic baseline reference
const maxLead = Math.ceil(Math.max(...ARMS.map((a) => a.lead)) / 50000) * 50000;
const bH = panelH - 40, bBase = topB + bH;
out.push(`<text x="${padL}" y="${topB - 6}" font-weight="700">Lead-model tokens / run (gpt-5.5)  ·  dashed = classic baseline</text>`);
for (let g = 0; g <= maxLead; g += 100000) {
  const y = bBase - (g / maxLead) * bH;
  out.push(`<line x1="${x0}" y1="${y}" x2="${W - padR}" y2="${y}" stroke="#eee"/>`);
  out.push(`<text x="${x0 - 8}" y="${y + 4}" text-anchor="end" fill="#888">${g / 1000}k</text>`);
}
const refY = bBase - (base.lead / maxLead) * bH;
out.push(`<line x1="${x0}" y1="${refY}" x2="${W - padR}" y2="${refY}" stroke="#1b3a5b" stroke-width="1.5" stroke-dasharray="6 4"/>`);
ARMS.forEach((a, i) => {
  const x = xOf(i), h = (a.lead / maxLead) * bH, y = bBase - h;
  out.push(`<rect x="${x}" y="${y}" width="${barW}" height="${h}" fill="${a.color}"${a.baseline ? ' stroke="#1b3a5b" stroke-width="2"' : ""}/>`);
  out.push(`<text x="${x + barW / 2}" y="${y - 18}" text-anchor="middle" font-weight="700">${(a.lead / 1000).toFixed(0)}k</text>`);
  const d = Math.round((100 * (a.lead - base.lead)) / base.lead);
  const dTxt = a.baseline ? "baseline" : `${d > 0 ? "+" : ""}${d}%`;
  out.push(`<text x="${x + barW / 2}" y="${y - 4}" text-anchor="middle" font-size="11" fill="${d > 0 ? "#c0392b" : "#2e7d32"}">${dTxt}</text>`);
});

// x labels + sidekick-token footnote per arm
ARMS.forEach((a, i) => {
  const x = xOf(i) + barW / 2;
  out.push(`<text x="${x}" y="${H - 30}" text-anchor="middle" font-weight="700">${esc(a.label)}</text>`);
  out.push(`<text x="${x}" y="${H - 15}" text-anchor="middle" fill="#666" font-size="11">${esc(a.sub)}</text>`);
});
out.push(`</svg>`);
writeFileSync("plots/df022-sidekicks.svg", out.join("\n"));
console.log("wrote plots/df022-sidekicks.svg");
for (const a of ARMS) console.log(`${a.label} ${a.sub}: ${a.res}/${a.n} resolved, lead ${a.lead} tok, sidekick ${a.sk} tok`);
