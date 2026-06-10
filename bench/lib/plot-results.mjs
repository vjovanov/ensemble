// Generate two SVG plots from current per-run metrics for the three arms we compare.
//   plots/cost.svg   — per-run cost (USD): one dot per run + a mean marker, per arm.
//   plots/tokens.svg — token cost decomposition (USD): mean input-token $ and cached-token $
//                      stacked per arm (tokens × their price), with per-run total dots + mean.
// Apples-to-apples over the instances all three arms ran. Pure SVG, no deps.
// Prices (lead model): input $5/Mtok, cacheRead $0.5/Mtok. Output excluded (small; in cost.svg).
// Usage: node lib/plot-results.mjs
import { readFileSync, existsSync, readdirSync, writeFileSync, mkdirSync } from "node:fs";

const ARMS = [
  { key: "classic", label: "classic", color: "#4C78A8" },
  { key: "classic-graphify", label: "classic-graphify", color: "#E45756" },
  { key: "classic-graph-bash", label: "classic-graph-bash", color: "#54A24B" },
];
const IN_PRICE = 5e-6, CR_PRICE = 0.5e-6;
const COL_IN = "#4878B0", COL_CR = "#F2B705"; // input / cached components in tokens.svg

const allIds = [...new Set(readdirSync("raw").map((d) => {
  for (const a of ARMS) if (d.endsWith("__" + a.key)) return d.slice(0, -(a.key.length + 2));
  return null;
}).filter(Boolean))];
const M = (id, a) => { const p = `raw/${id}__${a}/metrics.json`; return existsSync(p) ? JSON.parse(readFileSync(p, "utf8")) : null; };
const ids = allIds.filter((id) => ARMS.every((a) => M(id, a.key))).sort();
const N = ids.length;

const data = ARMS.map((a) => {
  const runs = ids.map((id) => { const m = M(id, a.key); return { cost: m.costUsd, in$: m.input * IN_PRICE, cr$: m.cacheRead * CR_PRICE }; });
  const mean = (f) => runs.reduce((s, r) => s + f(r), 0) / runs.length;
  return { ...a, runs, meanCost: mean((r) => r.cost), meanIn: mean((r) => r.in$), meanCr: mean((r) => r.cr$) };
});

// deterministic jitter in [-spread, spread]
const jit = (i, spread) => (((i * 1103515245 + 12345) % 1000) / 1000 - 0.5) * 2 * spread;
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;");

function frame(W, H, title, sub) {
  const m = { l: 64, r: 24, t: 70, b: 64 };
  return { W, H, m, pw: W - m.l - m.r, ph: H - m.t - m.b,
    head: `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="system-ui,Segoe UI,Helvetica,Arial,sans-serif">
<rect width="${W}" height="${H}" fill="#ffffff"/>
<text x="${W / 2}" y="26" text-anchor="middle" font-size="16" font-weight="600" fill="#111">${esc(title)}</text>
<text x="${W / 2}" y="44" text-anchor="middle" font-size="11.5" fill="#666">${esc(sub)}</text>` };
}

function yAxis(f, ymax, ticks, fmt) {
  const { m, ph } = f; let s = "";
  const y = (v) => m.t + ph * (1 - v / ymax);
  for (let i = 0; i <= ticks; i++) {
    const v = ymax * i / ticks, yy = y(v);
    s += `<line x1="${m.l}" y1="${yy.toFixed(1)}" x2="${f.W - m.r}" y2="${yy.toFixed(1)}" stroke="#eee" stroke-width="1"/>`;
    s += `<text x="${m.l - 8}" y="${(yy + 4).toFixed(1)}" text-anchor="end" font-size="10.5" fill="#888">${fmt(v)}</text>`;
  }
  return { s, y };
}

function xCenters(f) { const band = f.pw / ARMS.length; return ARMS.map((_, i) => f.m.l + band * (i + 0.5)); }
function xLabels(f, cx) {
  return ARMS.map((a, i) => `<text x="${cx[i].toFixed(1)}" y="${f.H - f.m.b + 20}" text-anchor="middle" font-size="12" font-weight="600" fill="${a.color}">${esc(a.label)}</text>`).join("");
}

// ---------- Plot 1: cost scatter + mean ----------
function costSvg() {
  const f = frame(760, 440, "Cost per run (USD)", `${N} instances — all three arms ran each; one dot per run, bar = mean (includes passing & failing runs)`);
  const ymax = Math.ceil(Math.max(...data.flatMap((d) => d.runs.map((r) => r.cost))) * 10) / 10 + 0.1;
  const { s: axis, y } = yAxis(f, ymax, 5, (v) => "$" + v.toFixed(1));
  const cx = xCenters(f);
  let body = "";
  data.forEach((d, i) => {
    for (let j = 0; j < d.runs.length; j++) {
      const x = cx[i] + jit(j + 1, 34), yy = y(d.runs[j].cost);
      body += `<circle cx="${x.toFixed(1)}" cy="${yy.toFixed(1)}" r="3" fill="${d.color}" fill-opacity="0.5" stroke="${d.color}" stroke-width="0.6"/>`;
    }
    const my = y(d.meanCost);
    body += `<line x1="${cx[i] - 46}" y1="${my.toFixed(1)}" x2="${cx[i] + 46}" y2="${my.toFixed(1)}" stroke="${d.color}" stroke-width="3"/>`;
    body += `<text x="${cx[i]}" y="${(my - 8).toFixed(1)}" text-anchor="middle" font-size="12.5" font-weight="700" fill="${d.color}">$${d.meanCost.toFixed(3)}</text>`;
  });
  return f.head + axis + body + xLabels(f, cx) + "</svg>\n";
}

// ---------- Plot 2: stacked token-cost (input + cached) + per-run total dots ----------
function tokensSvg() {
  const f = frame(760, 440, "Token cost per run (USD): input + cached, scaled by price", `${N} instances — stacked bar = mean (input ×$5/Mtok, cached ×$0.5/Mtok); dots = per-run total`);
  const ymax = Math.ceil(Math.max(...data.flatMap((d) => d.runs.map((r) => r.in$ + r.cr$))) * 10) / 10 + 0.1;
  const { s: axis, y } = yAxis(f, ymax, 5, (v) => "$" + v.toFixed(1));
  const cx = xCenters(f), bw = 84;
  let body = "";
  data.forEach((d, i) => {
    const x0 = cx[i] - bw / 2;
    const yIn = y(d.meanIn), y0 = y(0), yTop = y(d.meanIn + d.meanCr);
    body += `<rect x="${x0}" y="${yIn.toFixed(1)}" width="${bw}" height="${(y0 - yIn).toFixed(1)}" fill="${COL_IN}" fill-opacity="0.85"/>`;
    body += `<rect x="${x0}" y="${yTop.toFixed(1)}" width="${bw}" height="${(yIn - yTop).toFixed(1)}" fill="${COL_CR}" fill-opacity="0.9"/>`;
    // per-run total dots — in a clean strip to the right of the bar
    const dotBase = cx[i] + bw / 2 + 16;
    for (let j = 0; j < d.runs.length; j++) {
      const x = dotBase + Math.abs(jit(j + 1, 13)), yy = y(d.runs[j].in$ + d.runs[j].cr$);
      body += `<circle cx="${x.toFixed(1)}" cy="${yy.toFixed(1)}" r="2.6" fill="${d.color}" fill-opacity="0.55"/>`;
    }
    body += `<text x="${cx[i]}" y="${(yTop - 8).toFixed(1)}" text-anchor="middle" font-size="12.5" font-weight="700" fill="#222">$${(d.meanIn + d.meanCr).toFixed(3)}</text>`;
    if (y0 - yIn > 14) body += `<text x="${cx[i]}" y="${(y(d.meanIn / 2) + 3).toFixed(1)}" text-anchor="middle" font-size="10" fill="#fff">in $${d.meanIn.toFixed(3)}</text>`;
    if (yIn - yTop > 14) body += `<text x="${cx[i]}" y="${(y(d.meanIn + d.meanCr / 2) + 3).toFixed(1)}" text-anchor="middle" font-size="10" fill="#5a4500">cache $${d.meanCr.toFixed(3)}</text>`;
  });
  // legend (own line, below subtitle, above plot)
  const lx = f.m.l, ly = f.m.t - 12;
  body += `<rect x="${lx}" y="${ly - 9}" width="11" height="11" fill="${COL_IN}" fill-opacity="0.85"/><text x="${lx + 16}" y="${ly}" font-size="11" fill="#444">input tokens ×$5/Mtok</text>`;
  body += `<rect x="${lx + 180}" y="${ly - 9}" width="11" height="11" fill="${COL_CR}" fill-opacity="0.9"/><text x="${lx + 196}" y="${ly}" font-size="11" fill="#444">cached tokens ×$0.5/Mtok</text>`;
  return f.head + axis + body + xLabels(f, cx) + "</svg>\n";
}

mkdirSync("plots", { recursive: true });
writeFileSync("plots/cost.svg", costSvg());
writeFileSync("plots/tokens.svg", tokensSvg());
console.log(`wrote plots/cost.svg + plots/tokens.svg  (n=${N} common instances)`);
for (const d of data) console.log(`  ${d.label.padEnd(20)} meanCost $${d.meanCost.toFixed(3)}  in $${d.meanIn.toFixed(3)}  cache $${d.meanCr.toFixed(3)}`);
