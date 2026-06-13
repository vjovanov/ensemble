// DF-021 caveman ladder chart: pass@K and mean $/run per primitive level (L0 classic baseline
// → L1 trimmed → L2 caveman → L3 stone-tool) on the 9 scoped instances.
//   plots/df021-caveman.svg
// L0 = frozen classic from checkpoints/003-base002-30 (s1,s2). L1/L2/L3 = multiseed/df021-caveman-l*.
// Usage: node lib/plot-df021.mjs
import { readFileSync, existsSync, writeFileSync } from "node:fs";

const INSTS = ["grpc__grpc-go-3258","simdjson__simdjson-2178","iamkun__dayjs-2532","iamkun__dayjs-2399","clap-rs__clap-5873","expressjs__express-5555","sveltejs__svelte-15115","vuejs__core-11694","darkreader__darkreader-7241"];
const rj = (p) => (existsSync(p) ? JSON.parse(readFileSync(p, "utf8")) : null);

function fromMultiseed(lvl) {
  const root = `multiseed/df021-caveman-${lvl}`, res = {}, cost = [];
  for (const s of ["s1","s2","s3"]) for (const i of INSTS) {
    const m = rj(`${root}/${s}/${i}__classic-caveman/metrics.json`); if (m) cost.push(m.costUsd || 0);
    const v = rj(`${root}/${s}/validation/classic-caveman/${i}.json`); if (v) (res[i] ??= []).push(!!v.resolved);
  }
  return { res, cost };
}
function l0() {
  const root = "checkpoints/003-base002-30", res = {}, cost = [];
  for (const s of ["s1","s2"]) for (const i of INSTS) {
    const m = rj(`${root}/${s}/${i}__classic/metrics.json`); if (m) cost.push(m.costUsd || 0);
    const v = rj(`${root}/${s}/validation/classic/${i}.json`); if (v) (res[i] ??= []).push(!!v.resolved);
  }
  return { res, cost };
}
const data = { L0: l0(), L1: fromMultiseed("l1"), L2: fromMultiseed("l2"), L3: fromMultiseed("l3") };
const LV = [
  { k: "L0", label: "L0", sub: "classic", color: "#4C78A8", baseline: true },
  { k: "L1", label: "L1", sub: "trimmed", color: "#72B7B2" },
  { k: "L2", label: "L2", sub: "caveman", color: "#54A24B" },
  { k: "L3", label: "L3", sub: "stone-tool", color: "#F58518" },
];
for (const v of LV) {
  const d = data[v.k];
  v.pass = INSTS.filter((i) => (d.res[i] || []).some(Boolean)).length;
  v.n = INSTS.filter((i) => d.res[i]).length;
  v.cost = d.cost.length ? d.cost.reduce((a, b) => a + b, 0) / d.cost.length : 0;
}
const base = LV.find((v) => v.baseline);

const W = 760, padL = 60, padR = 24, barW = 84, gap = 60, x0 = padL + 24;
const panelH = 220, gapY = 64, topA = 44, topB = topA + panelH + gapY, H = topB + panelH + 52;
const xOf = (i) => x0 + i * (barW + gap);
const o = [];
o.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" font-family="-apple-system,Segoe UI,Roboto,sans-serif" font-size="13"><rect width="${W}" height="${H}" fill="white"/>`);
o.push(`<text x="${padL}" y="24" font-size="16" font-weight="700">DF-021 — caveman primitive ladder (9 scoped instances)</text>`);

// Panel A: pass@K
const maxP = INSTS.length, aH = panelH - 40, aBase = topA + aH;
o.push(`<text x="${padL}" y="${topA - 6}" font-weight="700">pass@K (resolved in ≥1 seed, of ${maxP})</text>`);
for (const g of [0, 3, 6, 9]) { const y = aBase - (g / maxP) * aH; o.push(`<line x1="${x0}" y1="${y}" x2="${W - padR}" y2="${y}" stroke="#eee"/><text x="${x0 - 8}" y="${y + 4}" text-anchor="end" fill="#888">${g}</text>`); }
LV.forEach((v, i) => { const x = xOf(i), h = (v.pass / maxP) * aH, y = aBase - h;
  o.push(`<rect x="${x}" y="${y}" width="${barW}" height="${h}" fill="${v.color}"${v.baseline ? ' stroke="#1b3a5b" stroke-width="2"' : ""}/>`);
  o.push(`<text x="${x + barW / 2}" y="${y - 6}" text-anchor="middle" font-weight="700">${v.pass}/${v.n}</text>`); });

// Panel B: mean $/run with L0 baseline
const maxC = Math.ceil(Math.max(...LV.map((v) => v.cost)) / 0.1) * 0.1, bH = panelH - 40, bBase = topB + bH;
o.push(`<text x="${padL}" y="${topB - 6}" font-weight="700">mean \$/run  ·  dashed = classic L0 baseline</text>`);
for (let g = 0; g <= maxC + 1e-9; g += 0.2) { const y = bBase - (g / maxC) * bH; o.push(`<line x1="${x0}" y1="${y}" x2="${W - padR}" y2="${y}" stroke="#eee"/><text x="${x0 - 8}" y="${y + 4}" text-anchor="end" fill="#888">$${g.toFixed(1)}</text>`); }
const refY = bBase - (base.cost / maxC) * bH;
o.push(`<line x1="${x0}" y1="${refY}" x2="${W - padR}" y2="${refY}" stroke="#1b3a5b" stroke-width="1.5" stroke-dasharray="6 4"/>`);
LV.forEach((v, i) => { const x = xOf(i), h = (v.cost / maxC) * bH, y = bBase - h;
  o.push(`<rect x="${x}" y="${y}" width="${barW}" height="${h}" fill="${v.color}"${v.baseline ? ' stroke="#1b3a5b" stroke-width="2"' : ""}/>`);
  o.push(`<text x="${x + barW / 2}" y="${y - 18}" text-anchor="middle" font-weight="700">$${v.cost.toFixed(3)}</text>`);
  const d = Math.round((100 * (v.cost - base.cost)) / base.cost);
  o.push(`<text x="${x + barW / 2}" y="${y - 4}" text-anchor="middle" font-size="11" fill="${d > 0 ? "#c0392b" : "#2e7d32"}">${v.baseline ? "baseline" : (d > 0 ? "+" : "") + d + "%"}</text>`); });

LV.forEach((v, i) => { const x = xOf(i) + barW / 2;
  o.push(`<text x="${x}" y="${H - 28}" text-anchor="middle" font-weight="700">${v.label}</text>`);
  o.push(`<text x="${x}" y="${H - 13}" text-anchor="middle" fill="#666" font-size="11">${v.sub}</text>`); });
o.push(`</svg>`);
writeFileSync("plots/df021-caveman.svg", o.join("\n"));
console.log("wrote plots/df021-caveman.svg");
for (const v of LV) console.log(`${v.k} ${v.sub}: pass@K ${v.pass}/${v.n}, mean $${v.cost.toFixed(3)}/run`);
