// Total lead-model spend of the three arms, over the benchmarks `classic` resolves.
// No averages — everything is a SUM of all $ used.
//   plots/cost.svg          — total $ per arm (bar per arm).
//   plots/tokens.svg        — total token cost per arm, input (solid) + cached (faded) stacked.
//   plots/cost-vs-classic.svg — per-benchmark breakdown: each benchmark's total $ per arm (dots = seeds).
// Reads the frozen base/002 seed snapshots (consistent; summed across seeds = all $ used).
// Prices: input $5/Mtok, cached $0.5/Mtok. Output excluded (small).
// Usage: node lib/plot-results.mjs            -> write the SVGs
//        node lib/plot-results.mjs --table    -> print the markdown tables
import { readFileSync, existsSync, readdirSync, writeFileSync, mkdirSync } from "node:fs";

const ARMS = [
  { key: "classic", label: "classic", color: "#4C78A8" },
  { key: "classic-graphify", label: "classic-graphify", color: "#E45756" },
  { key: "classic-graph-bash", label: "classic-graph-bash", color: "#54A24B" },
];
const IN_PRICE = 5e-6, CR_PRICE = 0.5e-6;
const TABLE = process.argv.includes("--table");

const BASE = "multiseed/base002";
const SEED_DIRS = existsSync(BASE)
  ? readdirSync(BASE).filter((d) => /^s\d+$/.test(d)).sort().map((d) => `${BASE}/${d}`) : [];
if (!SEED_DIRS.length) { console.error(`no seed snapshots under ${BASE}`); process.exit(1); }
const readM = (p) => existsSync(p) ? JSON.parse(readFileSync(p, "utf8")) : null;
const runsFor = (id, a) => SEED_DIRS
  .map((d) => readM(`${d}/${id}__${a}/metrics.json`)).filter(Boolean)
  .map((m) => ({ cost: m.costUsd, in$: m.input * IN_PRICE, cr$: m.cacheRead * CR_PRICE }));
const resolved = (id, a) => {
  let seen = false;
  for (const d of SEED_DIRS) { const p = `${d}/validation/${a}/${id}.json`; if (!existsSync(p)) continue; seen = true; if (JSON.parse(readFileSync(p, "utf8")).resolved === true) return true; }
  return seen ? false : null;
};
const sum = (arr, f) => arr.reduce((s, x) => s + f(x), 0);

const ids = [...new Set(SEED_DIRS.flatMap((d) => readdirSync(d)).map((b) => {
  for (const a of ARMS) if (b.endsWith("__" + a.key)) return b.slice(0, -(a.key.length + 2));
  return null;
}).filter(Boolean))].filter((id) => ARMS.every((a) => runsFor(id, a.key).length));

const cell = (id, a) => {
  const runs = runsFor(id, a.key);                    // one entry per seed
  return { runs, cost: sum(runs, (r) => r.cost), in$: sum(runs, (r) => r.in$), cr$: sum(runs, (r) => r.cr$), ok: resolved(id, a.key) === true };
};
const allRows = ids.map((id) => ({ id, short: id.includes("__") ? id.split("__")[1] : id, cells: ARMS.map((a) => cell(id, a)) }));
// the benchmarks classic resolves, biggest classic spend first
const rows = allRows.filter((r) => r.cells[0].ok).sort((x, y) => y.cells[0].cost - x.cells[0].cost);
const W = rows.length;
const totals = ARMS.map((a, i) => ({
  cost: sum(rows, (r) => r.cells[i].cost), in$: sum(rows, (r) => r.cells[i].in$), cr$: sum(rows, (r) => r.cells[i].cr$),
  n: rows.filter((r) => r.cells[i].ok).length,
}));

// ---------- markdown tables ----------
if (TABLE) {
  let out = `#### Total $ used on the ${W} benchmarks classic resolves\n\n`;
  out += `| arm | resolved | input $ | cached $ | **total $** | Δ vs classic |\n|---|---|---|---|---|---|\n`;
  ARMS.forEach((a, i) => {
    const t = totals[i], d = i === 0 ? "—" : `${((t.cost - totals[0].cost) / totals[0].cost * 100).toFixed(1)}%`;
    out += `| ${a.label} | ${t.n}/${W} | $${t.in$.toFixed(2)} | $${t.cr$.toFixed(2)} | **$${t.cost.toFixed(2)}** | ${d} |\n`;
  });
  out += `\n#### Per-benchmark cost on classic's wins ($)\n\n`;
  out += `| benchmark | classic | classic-graphify | classic-graph-bash |\n|---|---|---|---|\n`;
  for (const r of rows) out += `| ${r.short} | ${r.cells.map((c) => "$" + c.cost.toFixed(3)).join(" | ")} |\n`;
  out += `| **total** | **$${totals[0].cost.toFixed(2)}** | **$${totals[1].cost.toFixed(2)}** | **$${totals[2].cost.toFixed(2)}** |\n`;
  process.stdout.write(out);
  process.exit(0);
}

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;");
mkdirSync("plots", { recursive: true });

// ---------- total-spend bars (cost + tokens) ----------
function summaryBars({ file, title, sub, mode }) {
  const isTok = mode === "tok";
  const total = (i) => isTok ? totals[i].in$ + totals[i].cr$ : totals[i].cost;
  const base = total(0);
  const Wd = 640, H = 460, L = 60, Rm = 20, T = 92, B = 76, plotH = H - T - B, bw = 104;
  const ymax = Math.ceil(Math.max(...ARMS.map((_, i) => total(i))) * 1.15 * 10) / 10;
  const band = (Wd - L - Rm) / ARMS.length, cx = (i) => L + band * (i + 0.5), y = (v) => T + plotH * (1 - v / ymax);
  let s = `<svg xmlns="http://www.w3.org/2000/svg" width="${Wd}" height="${H}" viewBox="0 0 ${Wd} ${H}" font-family="system-ui,Segoe UI,Helvetica,Arial,sans-serif">
<rect width="${Wd}" height="${H}" fill="#ffffff"/>
<text x="${Wd / 2}" y="26" text-anchor="middle" font-size="16" font-weight="600" fill="#111">${esc(title)}</text>
<text x="${Wd / 2}" y="44" text-anchor="middle" font-size="11" fill="#666">${esc(sub)}</text>`;
  if (isTok) s += `<rect x="${L}" y="55" width="12" height="12" fill="#555"/><text x="${L + 17}" y="65" font-size="11" fill="#444">solid = input ×$5/Mtok</text>`
    + `<rect x="${L + 175}" y="55" width="12" height="12" fill="#555" fill-opacity="0.4"/><text x="${L + 192}" y="65" font-size="11" fill="#444">faded = cached ×$0.5/Mtok</text>`;
  for (let t = 0; t <= 5; t++) { const v = ymax * t / 5, yy = y(v); s += `<line x1="${L}" y1="${yy.toFixed(1)}" x2="${Wd - Rm}" y2="${yy.toFixed(1)}" stroke="#eee"/><text x="${L - 8}" y="${(yy + 4).toFixed(1)}" text-anchor="end" font-size="10" fill="#999">$${v.toFixed(0)}</text>`; }
  ARMS.forEach((a, i) => {
    const x0 = cx(i) - bw / 2, t = totals[i];
    if (isTok) {
      const yIn = y(t.in$), yTop = y(t.in$ + t.cr$);
      s += `<rect x="${x0}" y="${yIn.toFixed(1)}" width="${bw}" height="${(y(0) - yIn).toFixed(1)}" fill="${a.color}"/>`
        + `<rect x="${x0}" y="${yTop.toFixed(1)}" width="${bw}" height="${(yIn - yTop).toFixed(1)}" fill="${a.color}" fill-opacity="0.4"/>`
        + `<text x="${cx(i)}" y="${(y(t.in$ / 2) + 3).toFixed(1)}" text-anchor="middle" font-size="10.5" fill="#fff">in $${t.in$.toFixed(2)}</text>`
        + `<text x="${cx(i)}" y="${(y(t.in$ + t.cr$ / 2) + 3).toFixed(1)}" text-anchor="middle" font-size="10.5" fill="#333">cache $${t.cr$.toFixed(2)}</text>`;
    } else {
      s += `<rect x="${x0}" y="${y(total(i)).toFixed(1)}" width="${bw}" height="${(y(0) - y(total(i))).toFixed(1)}" fill="${a.color}"/>`;
    }
    const dlt = i === 0 ? "baseline" : `${((total(i) - base) / base * 100).toFixed(0)}% vs classic`;
    s += `<text x="${cx(i)}" y="${(y(total(i)) - 22).toFixed(1)}" text-anchor="middle" font-size="18" font-weight="700" fill="${a.color}">$${total(i).toFixed(2)}</text>`
      + `<text x="${cx(i)}" y="${(y(total(i)) - 8).toFixed(1)}" text-anchor="middle" font-size="10.5" fill="#666">${dlt}</text>`
      + `<text x="${cx(i)}" y="${H - B + 24}" text-anchor="middle" font-size="12.5" font-weight="600" fill="${a.color}">${esc(a.label)}</text>`;
  });
  writeFileSync(file, s + `</svg>\n`);
}

// ---------- per-benchmark breakdown (horizontal bars; total per benchmark, dots = seeds) ----------
function perBench({ file, title, sub }) {
  const Lm = 150, R = 18, T = 78, barH = 6, intra = 1, groupGap = 8;
  const groupH = ARMS.length * barH + (ARMS.length - 1) * intra + groupGap;
  const plotW = 820 - Lm - R, H = T + W * groupH + 16;
  const xmax = Math.ceil(Math.max(...rows.flatMap((r) => r.cells.map((c) => c.cost)), 0.1) * 10) / 10;
  const xticks = Math.max(1, Math.round(xmax / 0.5)), x = (v) => Lm + plotW * v / xmax;
  let s = `<svg xmlns="http://www.w3.org/2000/svg" width="820" height="${H}" viewBox="0 0 820 ${H}" font-family="system-ui,Segoe UI,Helvetica,Arial,sans-serif">
<rect width="820" height="${H}" fill="#ffffff"/>
<text x="410" y="24" text-anchor="middle" font-size="16" font-weight="600" fill="#111">${esc(title)}</text>
<text x="410" y="42" text-anchor="middle" font-size="11" fill="#666">${esc(sub)}</text>`;
  let lx = Lm;
  ARMS.forEach((a, i) => {
    const tv = "$" + totals[i].cost.toFixed(2);
    s += `<rect x="${lx}" y="53" width="12" height="12" fill="${a.color}"/><text x="${lx + 17}" y="63" font-size="11" fill="#333">${esc(a.label)} (total ${tv})</text>`;
    lx += 30 + (a.label.length + tv.length + 9) * 6.2;
  });
  for (let t = 0; t <= xticks; t++) { const v = xmax * t / xticks, xx = x(v); s += `<line x1="${xx.toFixed(1)}" y1="${T - 6}" x2="${xx.toFixed(1)}" y2="${H - 14}" stroke="#eee"/><text x="${xx.toFixed(1)}" y="${T - 10}" text-anchor="middle" font-size="10" fill="#999">$${v.toFixed(1)}</text>`; }
  rows.forEach((r, ri) => {
    const gTop = T + ri * groupH;
    s += `<text x="${Lm - 6}" y="${(gTop + groupH / 2 + 2).toFixed(1)}" text-anchor="end" font-size="9.5" fill="#444">${esc(r.short)}</text>`;
    ARMS.forEach((a, i) => {
      const c = r.cells[i]; if (!c.ok) return;
      const by = gTop + i * (barH + intra);
      s += `<rect x="${Lm}" y="${by.toFixed(1)}" width="${Math.max(0.8, x(c.cost) - Lm).toFixed(1)}" height="${barH}" fill="${a.color}"/>`
        + c.runs.map((rn) => `<circle cx="${x(rn.cost).toFixed(1)}" cy="${(by + barH / 2).toFixed(1)}" r="2.5" fill="${a.color}" stroke="#222" stroke-width="0.7"/>`).join("");
    });
  });
  writeFileSync(file, s + `</svg>\n`);
}

summaryBars({ file: "plots/cost.svg", mode: "cost",
  title: "Total $ spent on the benchmarks classic resolves",
  sub: `sum of lead-model cost over the ${W} benchmarks classic solves (all three arms solve all ${W})` });
summaryBars({ file: "plots/tokens.svg", mode: "tok",
  title: "Total token cost (input + cached) on the benchmarks classic resolves",
  sub: `sum over the ${W} benchmarks classic solves; tokens scaled by price into the $ they contribute` });
perBench({ file: "plots/cost-vs-classic.svg",
  title: "Per-benchmark cost on classic's wins",
  sub: `the ${W} benchmarks classic resolved; bar = total $ for that benchmark, dot = each seed` });

console.log(`wrote cost.svg + tokens.svg (total $ over classic's ${W} wins) + cost-vs-classic.svg; ${SEED_DIRS.length} seed(s)`);
ARMS.forEach((a, i) => console.log(`  ${a.label.padEnd(20)} total $${totals[i].cost.toFixed(2)}  (input $${totals[i].in$.toFixed(2)} + cached $${totals[i].cr$.toFixed(2)})  resolved ${totals[i].n}/${W}`));
