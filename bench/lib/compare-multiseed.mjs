// Multi-seed REQ-002/003 verdict: candidate multi-seed run vs a frozen multi-seed base. §REQ-005-research-checkpoints.3
// Usage: node compare-multiseed.mjs --base <checkpoint dir with s*/> --cand <multiseed dir with s*/> [--arm classic-graph-bash]
// Compares pass@K (resolved in >=1 of K) per instance for the candidate arm; only instances the cand re-ran are judged.
import { readFileSync, existsSync, readdirSync } from "node:fs";

const a = {};
for (let i = 2; i < process.argv.length; i += 2) a[process.argv[i].replace(/^--/, "")] = process.argv[i + 1];
const ARM = a.arm || "classic-graph-bash";

function passK(root, arm) {
  // -> { id: {n, K, cost[]} } for the arm, across s*/ seed dirs
  const seeds = readdirSync(root).filter((d) => /^s\d+$/.test(d)).sort();
  const out = {};
  for (const s of seeds) {
    const sdir = `${root}/${s}`;
    if (!existsSync(sdir)) continue;
    for (const pd of readdirSync(sdir).filter((d) => d.endsWith(`__${arm}`))) {
      const id = pd.replace(`__${arm}`, "");
      const v = `${sdir}/validation/${arm}/${id}.json`;
      const m = `${sdir}/${pd}/metrics.json`;
      const r = existsSync(v) && JSON.parse(readFileSync(v, "utf8")).resolved;
      (out[id] ||= { n: 0, K: 0, cost: [] });
      out[id].K++; if (r) out[id].n++;
      if (r && existsSync(m)) out[id].cost.push(JSON.parse(readFileSync(m, "utf8")).costUsd);
    }
  }
  return out;
}
const mean = (xs) => (xs.length ? xs.reduce((p, c) => p + c, 0) / xs.length : null);

const base = passK(a.base, ARM);
const cand = passK(a.cand, ARM);
const ids = Object.keys(cand).sort(); // judge only what the candidate re-ran (scoped experiment)

let regress = [], gains = [];
console.log(`arm=${ARM}   base=${a.base}   cand=${a.cand}\n`);
console.log("instance".padEnd(22) + "base pass@K".padStart(13) + "cand pass@K".padStart(13) + "  base$  cand$");
for (const id of ids) {
  const b = base[id], c = cand[id];
  const bp = b ? b.n >= 1 : null, cp = c.n >= 1;
  if (b && bp && !cp) regress.push(id);
  if ((!b || !bp) && cp) gains.push(id);
  const bc = b ? mean(b.cost) : null, cc = mean(c.cost);
  console.log(
    id.split("__").pop().padEnd(22) +
    (b ? `${b.n}/${b.K}` : "—").padStart(13) +
    `${c.n}/${c.K}`.padStart(13) +
    `  ${bc != null ? "$" + bc.toFixed(2) : "—"}  ${cc != null ? "$" + cc.toFixed(2) : "—"}`,
  );
}
const verdict = regress.length === 0 && gains.length >= 1;
console.log(`\ngains (cand resolves, base didn't): ${gains.map((i) => i.split("__").pop()).join(", ") || "none"}`);
console.log(`regressions (base resolved, cand doesn't): ${regress.map((i) => i.split("__").pop()).join(", ") || "none"}`);
console.log(`\nVERDICT: ${verdict ? "PASS — promote candidate" : (regress.length ? "FAIL — regression" : "NEUTRAL — no gain")} (gains=${gains.length}, regressions=${regress.length})`);
process.exit(verdict ? 0 : 1);
