// Total lead-model spend of the arms, over the benchmarks `classic` resolves. No averages —
// everything is a SUM of all $ used.
//   plots/cost.svg          — total $ per arm.
//   plots/tokens.svg        — total token cost per arm, input (solid) + cached (faded) stacked.
//   plots/cost-vs-classic.svg — per-benchmark: each benchmark's total $ per arm (dots = seeds).
// pi arms (classic / classic-graphify / classic-graph-bash) come from the frozen base/002 seed
// snapshot (consistent, summed across seeds = all $ used). codex is a reference arm read from raw/
// (+ results/validation) — it solves fewer instances, so each bar is annotated "solved K/N".
// Prices: input $5/Mtok, cached $0.5/Mtok, output $30/Mtok.
// Usage: node lib/plot-results.mjs [--table]
import { readFileSync, existsSync, readdirSync, writeFileSync, mkdirSync } from "node:fs";

const ARMS = [
  { key: "classic", label: "classic", color: "#4C78A8" },
  { key: "classic-graphify", label: "classic-graphify", color: "#E45756" },
  { key: "classic-graph-bash", label: "classic-graph-bash", color: "#54A24B" },
];
const CODEX = { key: "codex", label: "codex", color: "#B07AA1", ref: true };
const IN_PRICE = 5e-6, CR_PRICE = 0.5e-6, OUT_PRICE = 30e-6;
const TABLE = process.argv.includes("--table");

const BASE = "multiseed/base002";
const SEED_DIRS = existsSync(BASE)
  ? readdirSync(BASE).filter((d) => /^s\d+$/.test(d)).sort().map((d) => `${BASE}/${d}`) : [];
if (!SEED_DIRS.length) { console.error(`no seed snapshots under ${BASE}`); process.exit(1); }
const readM = (p) => existsSync(p) ? JSON.parse(readFileSync(p, "utf8")) : null;
const valid = (m) => m && typeof m.costUsd === "number";
const metricToRun = (m) => ({ cost: m.costUsd, in$: m.input * IN_PRICE, cr$: m.cacheRead * CR_PRICE, out$: m.output * OUT_PRICE });

// pi arms: per-seed snapshot metrics; codex (reference): the raw/ run.
const runsFor = (id, a) => (a === "codex"
  ? [readM(`raw/${id}__codex/metrics.json`)]
  : SEED_DIRS.map((d) => readM(`${d}/${id}__${a}/metrics.json`))).filter(valid).map(metricToRun);
const resolved = (id, a) => {
  if (a === "codex") { const p = `results/validation/codex/${id}.json`; return existsSync(p) ? JSON.parse(readFileSync(p, "utf8")).resolved === true : null; }
  let seen = false;
  for (const d of SEED_DIRS) { const p = `${d}/validation/${a}/${id}.json`; if (!existsSync(p)) continue; seen = true; if (JSON.parse(readFileSync(p, "utf8")).resolved === true) return true; }
  return seen ? false : null;
};
const sum = (arr, f) => arr.reduce((s, x) => s + f(x), 0);
const PI = ARMS;   // ARMS currently holds only the pi arms; codex is appended below if ready.

const ids = [...new Set(SEED_DIRS.flatMap((d) => readdirSync(d)).map((b) => {
  for (const a of PI) if (b.endsWith("__" + a.key)) return b.slice(0, -(a.key.length + 2));
  return null;
}).filter(Boolean))].filter((id) => PI.every((a) => runsFor(id, a.key).length));

// Auto-include the codex reference arm once its instrumented re-run is graded for every benchmark
// classic resolves (so the refresh picks it up the moment its grade lands; partial data stays out).
const winIds = ids.filter((id) => resolved(id, "classic") === true);
// codex is a single instrumented run; the pi arms sum across SEED_DIRS. Summing a 1-run arm next to
// K-run arms is apples-to-oranges, so codex only joins when there is a single seed to compare to.
const codexGraded = winIds.length > 0 && winIds.every((id) => valid(readM(`raw/${id}__codex/metrics.json`)) && existsSync(`results/validation/codex/${id}.json`) && JSON.parse(readFileSync(`results/validation/codex/${id}.json`, "utf8")).status !== "unknown");
if (codexGraded && SEED_DIRS.length <= 1) ARMS.push(CODEX);

const cell = (id, a) => {
  const runs = runsFor(id, a.key);
  return { runs, cost: sum(runs, (r) => r.cost), in$: sum(runs, (r) => r.in$), cr$: sum(runs, (r) => r.cr$), out$: sum(runs, (r) => r.out$), ok: resolved(id, a.key) === true, ran: runs.length > 0 };
};
const allRows = ids.map((id) => ({ id, short: id.includes("__") ? id.split("__")[1] : id, cells: ARMS.map((a) => cell(id, a)) }));
const rows = allRows.filter((r) => r.cells[0].ok).sort((x, y) => y.cells[0].cost - x.cells[0].cost);
const W = rows.length;
const totals = ARMS.map((a, i) => ({
  cost: sum(rows, (r) => r.cells[i].cost), in$: sum(rows, (r) => r.cells[i].in$), cr$: sum(rows, (r) => r.cells[i].cr$), out$: sum(rows, (r) => r.cells[i].out$),
  n: rows.filter((r) => r.cells[i].ok).length, ran: rows.filter((r) => r.cells[i].ran).length,
}));

if (TABLE) {
  let out = `#### Total $ used on the ${W} benchmarks classic resolves\n\n`;
  out += `| arm | resolved | input $ | cached $ | output $ | **total $** | Δ vs classic |\n|---|---|---|---|---|---|---|\n`;
  ARMS.forEach((a, i) => {
    const t = totals[i], d = i === 0 ? "—" : `${((t.cost - totals[0].cost) / totals[0].cost * 100).toFixed(1)}%`;
    out += `| ${a.label}${a.ref ? " *(ref)*" : ""} | ${t.n}/${W} | $${t.in$.toFixed(2)} | $${t.cr$.toFixed(2)} | $${t.out$.toFixed(2)} | **$${t.cost.toFixed(2)}** | ${d} |\n`;
  });
  const gb = ARMS.findIndex((a) => a.key === "classic-graph-bash");
  if (gb >= 0) {
    const capped = sum(rows, (r) => Math.min(r.cells[0].cost, r.cells[gb].cost));
    out += `| graph-bash, classic-capped where worse | ${W}/${W} | — | — | — | **$${capped.toFixed(2)}** | ${((capped - totals[0].cost) / totals[0].cost * 100).toFixed(1)}% |\n`;
  }
  const ref = ARMS.findIndex((a) => a.ref);
  if (ref >= 0) out += `\n_${ARMS[ref].label} is a reference arm (external Codex CLI); it spends on all ${W} but resolves only ${totals[ref].n}, so its total is not a like-for-like fix cost._\n`;
  out += `\n#### Per-benchmark cost on classic's wins ($)\n\n`;
  out += `| benchmark | ${ARMS.map((a) => a.label).join(" | ")} |\n|---|${ARMS.map(() => "---").join("|")}|\n`;
  for (const r of rows) out += `| ${r.short} | ${r.cells.map((c) => c.ok ? "$" + c.cost.toFixed(3) : (c.ran ? "_$" + c.cost.toFixed(3) + "_" : "—")).join(" | ")} |\n`;
  out += `| **total** | ${totals.map((t) => "**$" + t.cost.toFixed(2) + "**").join(" | ")} |\n`;
  out += `\n(italic = arm ran but did not resolve that benchmark; "—" = no run)\n`;
  process.stdout.write(out);
  process.exit(0);
}

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;");
mkdirSync("plots", { recursive: true });

function summaryBars({ file, title, sub, mode }) {
  const isTok = mode === "tok";
  // both modes total the full $ spent; tok mode shows how it splits into input/cached/output.
  const total = (i) => totals[i].in$ + totals[i].cr$ + totals[i].out$;
  const base = total(0);
  const n = ARMS.length, Wd = 200 + n * 150, H = 470, L = 60, Rm = 20, T = 92, B = 84, plotH = H - T - B;
  const band = (Wd - L - Rm) / n, bw = Math.min(112, band * 0.66), cx = (i) => L + band * (i + 0.5);
  const ymax = Math.ceil(Math.max(...ARMS.map((_, i) => total(i))) * 1.15 * 10) / 10;
  const y = (v) => T + plotH * (1 - v / ymax);
  let s = `<svg xmlns="http://www.w3.org/2000/svg" width="${Wd}" height="${H}" viewBox="0 0 ${Wd} ${H}" font-family="system-ui,Segoe UI,Helvetica,Arial,sans-serif">
<rect width="${Wd}" height="${H}" fill="#ffffff"/>
<text x="${Wd / 2}" y="26" text-anchor="middle" font-size="16" font-weight="600" fill="#111">${esc(title)}</text>
<text x="${Wd / 2}" y="44" text-anchor="middle" font-size="11" fill="#666">${esc(sub)}</text>`;
  if (isTok) s += `<rect x="${L}" y="55" width="12" height="12" fill="#555"/><text x="${L + 17}" y="65" font-size="10.5" fill="#444">input ×$5/Mtok</text>`
    + `<rect x="${L + 130}" y="55" width="12" height="12" fill="#555" fill-opacity="0.35"/><text x="${L + 147}" y="65" font-size="10.5" fill="#444">cached ×$0.5/Mtok</text>`
    + `<rect x="${L + 280}" y="55" width="12" height="12" fill="#222"/><text x="${L + 297}" y="65" font-size="10.5" fill="#444">output ×$30/Mtok</text>`;
  for (let t = 0; t <= 5; t++) { const v = ymax * t / 5, yy = y(v); s += `<line x1="${L}" y1="${yy.toFixed(1)}" x2="${Wd - Rm}" y2="${yy.toFixed(1)}" stroke="#eee"/><text x="${L - 8}" y="${(yy + 4).toFixed(1)}" text-anchor="end" font-size="10" fill="#999">$${v.toFixed(0)}</text>`; }
  ARMS.forEach((a, i) => {
    const x0 = cx(i) - bw / 2, t = totals[i];
    if (isTok) {
      const yIn = y(t.in$), yCa = y(t.in$ + t.cr$), yOut = y(t.in$ + t.cr$ + t.out$);
      s += `<rect x="${x0}" y="${yIn.toFixed(1)}" width="${bw}" height="${(y(0) - yIn).toFixed(1)}" fill="${a.color}"/>`
        + `<rect x="${x0}" y="${yCa.toFixed(1)}" width="${bw}" height="${(yIn - yCa).toFixed(1)}" fill="${a.color}" fill-opacity="0.35"/>`
        + `<rect x="${x0}" y="${yOut.toFixed(1)}" width="${bw}" height="${(yCa - yOut).toFixed(1)}" fill="#222"/>`
        + `<text x="${cx(i)}" y="${(y(t.in$ / 2) + 3).toFixed(1)}" text-anchor="middle" font-size="10" fill="#fff">in $${t.in$.toFixed(2)}</text>`
        + `<text x="${cx(i)}" y="${(y(t.in$ + t.cr$ / 2) + 3).toFixed(1)}" text-anchor="middle" font-size="10" fill="#333">cache $${t.cr$.toFixed(2)}</text>`
        + `<text x="${cx(i)}" y="${(y(t.in$ + t.cr$ + t.out$ / 2) + 3).toFixed(1)}" text-anchor="middle" font-size="10" fill="#fff">out $${t.out$.toFixed(2)}</text>`;
    } else {
      s += `<rect x="${x0}" y="${y(total(i)).toFixed(1)}" width="${bw}" height="${(y(0) - y(total(i))).toFixed(1)}" fill="${a.color}"/>`;
    }
    const dlt = i === 0 ? "baseline" : `${((total(i) - base) / base * 100).toFixed(0)}% vs classic`;
    s += `<text x="${cx(i)}" y="${(y(total(i)) - 22).toFixed(1)}" text-anchor="middle" font-size="17" font-weight="700" fill="${a.color}">$${total(i).toFixed(2)}</text>`
      + `<text x="${cx(i)}" y="${(y(total(i)) - 8).toFixed(1)}" text-anchor="middle" font-size="10" fill="#666">${dlt}</text>`
      + `<text x="${cx(i)}" y="${H - B + 24}" text-anchor="middle" font-size="12" font-weight="600" fill="${a.color}">${esc(a.label)}${a.ref ? " (ref)" : ""}</text>`
      + `<text x="${cx(i)}" y="${H - B + 40}" text-anchor="middle" font-size="10" fill="#888">solved ${t.n}/${W}</text>`;
  });
  writeFileSync(file, s + `</svg>\n`);
}

function perBench({ file, title, sub }) {
  const Lm = 150, R = 18, T = 80, barH = 5, intra = 1, groupGap = 8;
  const groupH = ARMS.length * barH + (ARMS.length - 1) * intra + groupGap;
  const plotW = 860 - Lm - R, H = T + W * groupH + 16;
  const xmax = Math.ceil(Math.max(...rows.flatMap((r) => r.cells.map((c) => c.cost)), 0.1) * 10) / 10;
  const xticks = Math.max(1, Math.round(xmax / 0.5)), x = (v) => Lm + plotW * v / xmax;
  let s = `<svg xmlns="http://www.w3.org/2000/svg" width="860" height="${H}" viewBox="0 0 860 ${H}" font-family="system-ui,Segoe UI,Helvetica,Arial,sans-serif">
<rect width="860" height="${H}" fill="#ffffff"/>
<text x="430" y="24" text-anchor="middle" font-size="16" font-weight="600" fill="#111">${esc(title)}</text>
<text x="430" y="42" text-anchor="middle" font-size="11" fill="#666">${esc(sub)}</text>`;
  let lx = Lm;
  ARMS.forEach((a, i) => {
    const tv = "$" + totals[i].cost.toFixed(2);
    s += `<rect x="${lx}" y="53" width="12" height="12" fill="${a.color}"/><text x="${lx + 17}" y="63" font-size="11" fill="#333">${esc(a.label)} (total ${tv})</text>`;
    lx += 26 + (a.label.length + tv.length + 9) * 6.1;
  });
  for (let t = 0; t <= xticks; t++) { const v = xmax * t / xticks, xx = x(v); s += `<line x1="${xx.toFixed(1)}" y1="${T - 6}" x2="${xx.toFixed(1)}" y2="${H - 14}" stroke="#eee"/><text x="${xx.toFixed(1)}" y="${T - 10}" text-anchor="middle" font-size="10" fill="#999">$${v.toFixed(1)}</text>`; }
  rows.forEach((r, ri) => {
    const gTop = T + ri * groupH;
    s += `<text x="${Lm - 6}" y="${(gTop + groupH / 2 + 2).toFixed(1)}" text-anchor="end" font-size="9" fill="#444">${esc(r.short)}</text>`;
    ARMS.forEach((a, i) => {
      const c = r.cells[i]; if (!c.ok) return;
      const by = gTop + i * (barH + intra);
      s += `<rect x="${Lm}" y="${by.toFixed(1)}" width="${Math.max(0.8, x(c.cost) - Lm).toFixed(1)}" height="${barH}" fill="${a.color}"/>`
        + c.runs.map((rn) => `<circle cx="${x(rn.cost).toFixed(1)}" cy="${(by + barH / 2).toFixed(1)}" r="2.3" fill="${a.color}" stroke="#222" stroke-width="0.6"/>`).join("");
    });
  });
  writeFileSync(file, s + `</svg>\n`);
}

summaryBars({ file: "plots/cost.svg", mode: "cost",
  title: "Total $ spent on the benchmarks classic resolves",
  sub: `sum of lead-model cost over the ${W} benchmarks classic solves` });
summaryBars({ file: "plots/tokens.svg", mode: "tok",
  title: "Total $ split by token type — input + cached + output",
  sub: `same total as the cost graph; shows how each arm's spend over the ${W} benchmarks breaks down (output is $30/Mtok)` });
perBench({ file: "plots/cost-vs-classic.svg",
  title: "Per-benchmark cost on classic's wins",
  sub: `the ${W} benchmarks classic resolved; bar = total $ for that benchmark, dot = each seed (only arms that solved it)` });

console.log(`wrote cost.svg + tokens.svg + cost-vs-classic.svg (total $ over classic's ${W} wins); ${SEED_DIRS.length} seed(s)`);
ARMS.forEach((a, i) => console.log(`  ${a.label.padEnd(20)} total $${totals[i].cost.toFixed(2)}  (in $${totals[i].in$.toFixed(2)} + cache $${totals[i].cr$.toFixed(2)})  solved ${totals[i].n}/${W}  ran ${totals[i].ran}/${W}`));
