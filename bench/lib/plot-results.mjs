// Per-benchmark comparison of the three arms we track. Two views:
//   plots/cost.svg, plots/tokens.svg          — instances resolved by >=1 arm
//   plots/cost-vs-classic.svg                 — only benchmarks where `classic` succeeded
// Only the arms that PASSED a given benchmark are drawn (failed/ungraded arms are omitted).
// Bar = mean over available runs; a dot marks every individual run (multi-seed -> several dots).
// Token bars split input (solid ×$5/Mtok) + cached (faded ×$0.5/Mtok). Dashed vertical line =
// each arm's mean over its passes in that view, labelled with how many it resolved.
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

// Read from the frozen base002 multi-seed snapshot (consistent + immune to any live re-grade in
// raw/). Each seed dir holds <id>__<arm>/metrics.json and validation/<arm>/<id>.json.
const BASE = "multiseed/base002";
const SEED_DIRS = existsSync(BASE)
  ? readdirSync(BASE).filter((d) => /^s\d+$/.test(d)).sort().map((d) => `${BASE}/${d}`) : [];
if (!SEED_DIRS.length) { console.error(`no seed snapshots under ${BASE}`); process.exit(1); }
const readM = (p) => existsSync(p) ? JSON.parse(readFileSync(p, "utf8")) : null;
const runsFor = (id, a) => SEED_DIRS
  .map((d) => readM(`${d}/${id}__${a}/metrics.json`)).filter(Boolean)
  .map((m) => ({ cost: m.costUsd, in$: m.input * IN_PRICE, cr$: m.cacheRead * CR_PRICE, tot: m.totalTokens }));
// resolved = passed in any seed (pass@K)
const R = (id, a) => {
  let seen = false;
  for (const d of SEED_DIRS) { const p = `${d}/validation/${a}/${id}.json`; if (!existsSync(p)) continue; seen = true; if (JSON.parse(readFileSync(p, "utf8")).resolved === true) return true; }
  return seen ? false : null;
};
const mean = (arr, f) => arr.length ? arr.reduce((s, x) => s + f(x), 0) / arr.length : 0;

const ids = [...new Set(SEED_DIRS.flatMap((d) => readdirSync(d)).map((b) => {
  for (const a of ARMS) if (b.endsWith("__" + a.key)) return b.slice(0, -(a.key.length + 2));
  return null;
}).filter(Boolean))].filter((id) => ARMS.every((a) => runsFor(id, a.key).length));

const allRows = ids.map((id) => {
  const cells = ARMS.map((a) => {
    const runs = runsFor(id, a.key);
    return { runs, cost: mean(runs, (r) => r.cost), in$: mean(runs, (r) => r.in$), cr$: mean(runs, (r) => r.cr$), tot: mean(runs, (r) => r.tot), ok: R(id, a.key) === true };
  });
  return { id, short: id.includes("__") ? id.split("__")[1] : id, cells };
});
const byClassicCost = (x, y) => y.cells[0].cost - x.cells[0].cost;
const successRows = allRows.filter((r) => r.cells.some((c) => c.ok)).sort(byClassicCost);
const classicWinRows = allRows.filter((r) => r.cells[0].ok).sort(byClassicCost);
const armMeans = (rs) => ARMS.map((a, i) => {
  const ok = rs.filter((r) => r.cells[i].ok).map((r) => r.cells[i]);
  return { cost: mean(ok, (c) => c.cost), tok: mean(ok, (c) => c.in$ + c.cr$), n: ok.length };
});

// ---------- markdown tables ----------
if (TABLE) {
  const sm = armMeans(successRows);
  let out = `#### Successful instances (resolved by ≥1 arm) — cost per arm ($, "—" = arm did not resolve it)\n\n`;
  out += `| benchmark | classic | classic-graphify | classic-graph-bash |\n|---|---|---|---|\n`;
  for (const r of successRows) out += `| ${r.short} | ${r.cells.map((c) => c.ok ? "$" + c.cost.toFixed(3) : "—").join(" | ")} |\n`;
  out += `| **mean over passes** | **$${sm[0].cost.toFixed(3)}** (n=${sm[0].n}) | **$${sm[1].cost.toFixed(3)}** (n=${sm[1].n}) | **$${sm[2].cost.toFixed(3)}** (n=${sm[2].n}) |\n\n`;
  const W = classicWinRows.length, cm = armMeans(classicWinRows);
  out += `#### On classic's wins only (the ${W} benchmarks classic resolved)\n\n`;
  out += `| arm | also resolved | mean cost on its wins | Δ vs classic |\n|---|---|---|---|\n`;
  ARMS.forEach((a, i) => {
    out += `| ${a.label} | ${cm[i].n}/${W} | $${cm[i].cost.toFixed(3)} | ${i === 0 ? "—" : ((cm[i].cost - cm[0].cost) / cm[0].cost * 100).toFixed(1) + "%"} |\n`;
  });
  process.stdout.write(out);
  process.exit(0);
}

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;");
const dot = (cx, cy, a) => `<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="2.5" fill="${a.color}" stroke="#222" stroke-width="0.7"/>`;

function chart({ rows, title, sub, file, metric }) {
  const ms = armMeans(rows), N = rows.length;
  const isTok = metric === "tok";
  const val = (c) => isTok ? c.in$ + c.cr$ : c.cost;
  const meanArr = ms.map((m) => isTok ? m.tok : m.cost);
  const xmax = Math.ceil(Math.max(...rows.flatMap((r) => r.cells.filter((c) => c.ok).map(val)), 0.1) * 10) / 10;
  const xticks = Math.max(1, Math.round(xmax / 0.5));
  const Lm = 150, R = 18, T = 96, barH = 6, intra = 1, groupGap = 8;
  const groupH = ARMS.length * barH + (ARMS.length - 1) * intra + groupGap;
  const plotW = 820 - Lm - R, H = T + N * groupH + 16;
  const x = (v) => Lm + plotW * v / xmax;
  let s = `<svg xmlns="http://www.w3.org/2000/svg" width="820" height="${H}" viewBox="0 0 820 ${H}" font-family="system-ui,Segoe UI,Helvetica,Arial,sans-serif">
<rect width="820" height="${H}" fill="#ffffff"/>
<text x="410" y="24" text-anchor="middle" font-size="16" font-weight="600" fill="#111">${esc(title)}</text>
<text x="410" y="42" text-anchor="middle" font-size="11" fill="#666">${esc(sub)}</text>`;
  let lx = Lm;
  ARMS.forEach((a, i) => {
    const mv = "$" + meanArr[i].toFixed(3);
    s += `<rect x="${lx}" y="53" width="12" height="12" fill="${a.color}"/><text x="${lx + 17}" y="63" font-size="11" fill="#333">${esc(a.label)} (mean ${mv})</text>`;
    lx += 30 + (a.label.length + mv.length + 8) * 6.2;
  });
  for (let t = 0; t <= xticks; t++) {
    const v = xmax * t / xticks, xx = x(v);
    s += `<line x1="${xx.toFixed(1)}" y1="${T - 6}" x2="${xx.toFixed(1)}" y2="${H - 14}" stroke="#eee" stroke-width="1"/>`;
    s += `<text x="${xx.toFixed(1)}" y="${T - 10}" text-anchor="middle" font-size="10" fill="#999">$${v.toFixed(1)}</text>`;
  }
  // mean lines + "<n> ok" labels (staggered when close)
  const order = ARMS.map((a, i) => ({ i, a, xx: x(meanArr[i]) })).sort((p, q) => p.xx - q.xx);
  let lastX = -999, lvl = 0;
  for (const { i, a, xx } of order) {
    s += `<line x1="${xx.toFixed(1)}" y1="${T - 4}" x2="${xx.toFixed(1)}" y2="${H - 14}" stroke="${a.color}" stroke-width="1.3" stroke-dasharray="4 3" opacity="0.85"/>`;
    lvl = (xx - lastX < 52) ? lvl + 1 : 0; lastX = xx;
    s += `<text x="${xx.toFixed(1)}" y="${T - 24 - lvl * 13}" text-anchor="middle" font-size="10.5" font-weight="700" fill="${a.color}" stroke="#fff" stroke-width="2.6" paint-order="stroke">${ms[i].n} ok</text>`;
  }
  rows.forEach((r, ri) => {
    const gTop = T + ri * groupH;
    s += `<text x="${Lm - 6}" y="${(gTop + groupH / 2 + 2).toFixed(1)}" text-anchor="end" font-size="9.5" fill="#444">${esc(r.short)}</text>`;
    ARMS.forEach((a, i) => {
      const c = r.cells[i]; if (!c.ok) return; // omit arms that didn't succeed
      const by = gTop + i * (barH + intra);
      if (isTok) {
        const wIn = Math.max(0.3, x(c.in$) - Lm), wCr = Math.max(0.3, x(c.in$ + c.cr$) - x(c.in$));
        s += `<rect x="${Lm}" y="${by.toFixed(1)}" width="${wIn.toFixed(1)}" height="${barH}" fill="${a.color}"/>`
          + `<rect x="${x(c.in$).toFixed(1)}" y="${by.toFixed(1)}" width="${wCr.toFixed(1)}" height="${barH}" fill="${a.color}" fill-opacity="0.4"/>`
          + c.runs.map((rn) => dot(x(rn.in$ + rn.cr$), by + barH / 2, a)).join("");
      } else {
        s += `<rect x="${Lm}" y="${by.toFixed(1)}" width="${Math.max(0.8, x(c.cost) - Lm).toFixed(1)}" height="${barH}" fill="${a.color}"/>`
          + c.runs.map((rn) => dot(x(rn.cost), by + barH / 2, a)).join("");
      }
    });
  });
  writeFileSync(file, s + `</svg>\n`);
  return { N, ms };
}

mkdirSync("plots", { recursive: true });
const seedNote = SEED_DIRS.length ? `${SEED_DIRS.length} seed(s)` : "single run";
chart({ rows: successRows, metric: "cost", file: "plots/cost.svg",
  title: "Cost per benchmark (USD) — classic vs classic-graphify vs classic-graph-bash",
  sub: `${successRows.length} successful instances (resolved by >=1 arm); only passing arms drawn; bar = mean, dot = each run; dashed = arm mean over passes` });
chart({ rows: successRows, metric: "tok", file: "plots/tokens.svg",
  title: "Token cost per benchmark (USD): input + cached, scaled by price",
  sub: `${successRows.length} successful instances; per arm solid = input ×$5/Mtok + faded = cached ×$0.5/Mtok; dot = each run total` });
chart({ rows: classicWinRows, metric: "cost", file: "plots/cost-vs-classic.svg",
  title: "Cost on classic's wins only — does each arm solve them cheaper?",
  sub: `the ${classicWinRows.length} benchmarks classic resolved; only passing arms drawn (missing bar = that arm failed this one)` });

console.log(`wrote cost.svg, tokens.svg (success, n=${successRows.length}), cost-vs-classic.svg (classic-wins, n=${classicWinRows.length}); ${seedNote}`);
const sm = armMeans(successRows), cm = armMeans(classicWinRows);
ARMS.forEach((a, i) => console.log(`  ${a.label.padEnd(20)} success: ${sm[i].n} ok, mean $${sm[i].cost.toFixed(3)}   | on classic-wins: ${cm[i].n}/${classicWinRows.length}, mean $${cm[i].cost.toFixed(3)}`));
