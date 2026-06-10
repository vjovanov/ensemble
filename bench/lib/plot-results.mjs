// Generate two per-benchmark SVG plots comparing the three arms we track.
//   plots/cost.svg   — one row per benchmark; three bars (classic / graphify / graph-bash) = cost (USD).
//   plots/tokens.svg — one row per benchmark; three bars split into input (solid) + cached (faded),
//                      each token count scaled by its price ($/Mtok) into the dollars it contributes.
// Dashed vertical line per arm = that arm's mean across benchmarks. Apples-to-apples over the
// instances all three arms ran. Pure SVG, no deps.
// Prices (lead model): input $5/Mtok, cacheRead $0.5/Mtok. Output excluded (small).
// Usage: node lib/plot-results.mjs
import { readFileSync, existsSync, readdirSync, writeFileSync, mkdirSync } from "node:fs";

const ARMS = [
  { key: "classic", label: "classic", color: "#4C78A8" },
  { key: "classic-graphify", label: "classic-graphify", color: "#E45756" },
  { key: "classic-graph-bash", label: "classic-graph-bash", color: "#54A24B" },
];
const IN_PRICE = 5e-6, CR_PRICE = 0.5e-6;

const allIds = [...new Set(readdirSync("raw").map((d) => {
  for (const a of ARMS) if (d.endsWith("__" + a.key)) return d.slice(0, -(a.key.length + 2));
  return null;
}).filter(Boolean))];
const M = (id, a) => { const p = `raw/${id}__${a}/metrics.json`; return existsSync(p) ? JSON.parse(readFileSync(p, "utf8")) : null; };
const R = (id, a) => { const p = `results/validation/${a}/${id}.json`; if (!existsSync(p)) return null; const v = JSON.parse(readFileSync(p, "utf8")); return v.resolved === true ? true : v.status === "unknown" ? null : false; };
let ids = allIds.filter((id) => ARMS.every((a) => M(id, a.key)));
// only successful instances: resolved by at least one of the three arms
ids = ids.filter((id) => ARMS.some((a) => R(id, a.key) === true));

// per (id, arm): cost + token-cost components + resolved status
const row = (id) => {
  const cells = ARMS.map((a) => { const m = M(id, a.key); return { cost: m.costUsd, in$: m.input * IN_PRICE, cr$: m.cacheRead * CR_PRICE, ok: R(id, a.key) === true }; });
  return { id, short: id.includes("__") ? id.split("__")[1] : id, cells };
};
let rows = ids.map(row).sort((x, y) => y.cells[0].cost - x.cells[0].cost); // by classic cost, desc
const N = rows.length;
// mean over each arm's OWN successful runs within the shown set
const means = ARMS.map((a, i) => {
  const ok = rows.filter((r) => r.cells[i].ok);
  const m = (f) => ok.length ? ok.reduce((s, r) => s + f(r.cells[i]), 0) / ok.length : 0;
  return { cost: m((c) => c.cost), tok: m((c) => c.in$ + c.cr$), n: ok.length };
});

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;");

// shared horizontal-grouped-bar frame
function chart({ title, sub, file, xmax, xticks, fmtx, drawBar, meanVal }) {
  const L = 150, R = 18, T = 92, barH = 6, intra = 1, groupGap = 8;
  const groupH = ARMS.length * barH + (ARMS.length - 1) * intra + groupGap;
  const plotW = 820 - L - R;
  const H = T + N * groupH + 16;
  const x = (v) => L + plotW * v / xmax;
  let s = `<svg xmlns="http://www.w3.org/2000/svg" width="820" height="${H}" viewBox="0 0 820 ${H}" font-family="system-ui,Segoe UI,Helvetica,Arial,sans-serif">
<rect width="820" height="${H}" fill="#ffffff"/>
<text x="410" y="26" text-anchor="middle" font-size="16" font-weight="600" fill="#111">${esc(title)}</text>
<text x="410" y="44" text-anchor="middle" font-size="11.5" fill="#666">${esc(sub)}</text>`;
  // legend
  let lx = L;
  ARMS.forEach((a, i) => {
    s += `<rect x="${lx}" y="55" width="12" height="12" fill="${a.color}"/><text x="${lx + 17}" y="65" font-size="11" fill="#333">${esc(a.label)} (mean ${meanVal(i)})</text>`;
    lx += 30 + (a.label.length + (`${meanVal(i)}`).length + 8) * 6.2;
  });
  // x grid + ticks (top + along)
  for (let t = 0; t <= xticks; t++) {
    const v = xmax * t / xticks, xx = x(v);
    s += `<line x1="${xx.toFixed(1)}" y1="${T - 6}" x2="${xx.toFixed(1)}" y2="${H - 14}" stroke="#eee" stroke-width="1"/>`;
    s += `<text x="${xx.toFixed(1)}" y="${T - 10}" text-anchor="middle" font-size="10" fill="#999">${fmtx(v)}</text>`;
  }
  // mean reference lines per arm
  ARMS.forEach((a, i) => {
    const xx = x(meanRaw[file][i]);
    s += `<line x1="${xx.toFixed(1)}" y1="${T - 4}" x2="${xx.toFixed(1)}" y2="${H - 14}" stroke="${a.color}" stroke-width="1.3" stroke-dasharray="4 3" opacity="0.8"/>`;
  });
  // rows
  rows.forEach((r, ri) => {
    const gTop = T + ri * groupH;
    s += `<text x="${L - 6}" y="${(gTop + groupH / 2 + 2).toFixed(1)}" text-anchor="end" font-size="9.5" fill="#444">${esc(r.short)}</text>`;
    ARMS.forEach((a, i) => {
      const by = gTop + i * (barH + intra);
      s += drawBar(r.cells[i], a, by, barH, x, L);
    });
  });
  s += `</svg>\n`;
  writeFileSync(file, s);
}
// raw mean values keyed per file for the reference lines
const meanRaw = {
  "plots/cost.svg": means.map((m) => m.cost),
  "plots/tokens.svg": means.map((m) => m.tok),
};

const xmaxCost = Math.ceil(Math.max(...rows.flatMap((r) => r.cells.map((c) => c.cost))) * 10) / 10;
const xmaxTok = Math.ceil(Math.max(...rows.flatMap((r) => r.cells.map((c) => c.in$ + c.cr$))) * 10) / 10;

mkdirSync("plots", { recursive: true });

chart({
  title: "Cost per benchmark (USD) — classic vs classic-graphify vs classic-graph-bash",
  sub: `${N} successful instances (resolved by ≥1 arm); solid = that arm passed, hollow = failed/not graded; dashed = arm mean over its passes`,
  file: "plots/cost.svg", xmax: xmaxCost, xticks: Math.round(xmaxCost / 0.5), fmtx: (v) => "$" + v.toFixed(1),
  meanVal: (i) => `$${means[i].cost.toFixed(3)}, n=${means[i].n}`,
  drawBar: (c, a, by, barH, x, L) => {
    const w = Math.max(0.8, x(c.cost) - L);
    return c.ok
      ? `<rect x="${L}" y="${by.toFixed(1)}" width="${w.toFixed(1)}" height="${barH}" fill="${a.color}"/>`
      : `<rect x="${L}" y="${by.toFixed(1)}" width="${w.toFixed(1)}" height="${barH}" fill="${a.color}" fill-opacity="0.12" stroke="${a.color}" stroke-width="0.8"/>`;
  },
});

chart({
  title: "Token cost per benchmark (USD): input + cached, scaled by price",
  sub: `${N} successful instances; per arm solid bar = input ×$5/Mtok + faded = cached ×$0.5/Mtok; hollow = arm failed; dashed = arm mean over its passes`,
  file: "plots/tokens.svg", xmax: xmaxTok, xticks: Math.round(xmaxTok / 0.5), fmtx: (v) => "$" + v.toFixed(1),
  meanVal: (i) => `$${means[i].tok.toFixed(3)}, n=${means[i].n}`,
  drawBar: (c, a, by, barH, x, L) => {
    const wIn = Math.max(0.3, x(c.in$) - L), wCr = Math.max(0.3, x(c.in$ + c.cr$) - x(c.in$));
    if (!c.ok) {
      const w = Math.max(0.8, x(c.in$ + c.cr$) - L);
      return `<rect x="${L}" y="${by.toFixed(1)}" width="${w.toFixed(1)}" height="${barH}" fill="${a.color}" fill-opacity="0.1" stroke="${a.color}" stroke-width="0.8"/>`;
    }
    return `<rect x="${L}" y="${by.toFixed(1)}" width="${wIn.toFixed(1)}" height="${barH}" fill="${a.color}"/>`
      + `<rect x="${x(c.in$).toFixed(1)}" y="${by.toFixed(1)}" width="${wCr.toFixed(1)}" height="${barH}" fill="${a.color}" fill-opacity="0.4"/>`;
  },
});

console.log(`wrote plots/cost.svg + plots/tokens.svg  (per-benchmark, n=${N})`);
ARMS.forEach((a, i) => console.log(`  ${a.label.padEnd(20)} mean cost $${means[i].cost.toFixed(3)}  mean input+cached $${means[i].tok.toFixed(3)}`));
