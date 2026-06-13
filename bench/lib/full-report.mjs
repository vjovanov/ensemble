// Complete cross-arm results for every tracked instance: success / tokens / money.
// Reads raw/<id>__<arm>/metrics.json + results/validation/<arm>/<id>.json.
// Usage: node lib/full-report.mjs [--csv]
import { readFileSync, existsSync, readdirSync } from "node:fs";

const ARMS = ["classic", "classic-bash", "classic-graph", "classic-graph-bash", "classic-graphify", "codex"];
const SHORT = { "classic": "clsc", "classic-bash": "bash", "classic-graph": "grph", "classic-graph-bash": "g+b", "classic-graphify": "gfy", "codex": "cdx" };

const ids = [...new Set(readdirSync("raw").map(d => {
  for (const a of ARMS) if (d.endsWith("__" + a)) return d.slice(0, -(a.length + 2));
  return null;
}).filter(Boolean))].sort();

const M = (id, a) => { const p = `raw/${id}__${a}/metrics.json`; return existsSync(p) ? JSON.parse(readFileSync(p, "utf8")) : null; };
const R = (id, a) => { const p = `results/validation/${a}/${id}.json`; if (!existsSync(p)) return null; const v = JSON.parse(readFileSync(p, "utf8")); return v.resolved === true ? true : v.status === "unknown" ? null : false; };

const csv = process.argv.includes("--csv");
if (csv) {
  console.log(["instance", ...ARMS.flatMap(a => [`${a}_resolved`, `${a}_cost`, `${a}_input`, `${a}_output`, `${a}_cacheRead`, `${a}_totalTok`])].join(","));
  for (const id of ids) {
    const row = [id];
    for (const a of ARMS) { const m = M(id, a), r = R(id, a); row.push(r === true ? 1 : r === false ? 0 : "", m?.costUsd ?? "", m?.input ?? "", m?.output ?? "", m?.cacheRead ?? "", m?.totalTokens ?? ""); }
    console.log(row.join(","));
  }
  process.exit(0);
}

const b = v => v === true ? "✓" : v === false ? "✗" : "·";
const money = n => n == null ? "  -  " : ("$" + n.toFixed(3));

// 1. success + cost matrix
console.log("=== SUCCESS (✓ resolved / ✗ failed / · no-grade) + COST per arm ===\n");
console.log("instance".padEnd(40) + ARMS.map(a => SHORT[a].padStart(8)).join(" "));
for (const id of ids) {
  const cells = ARMS.map(a => { const m = M(id, a), r = R(id, a); return (b(r) + money(m?.costUsd)).padStart(8); });
  console.log(id.padEnd(40) + cells.join(" "));
}

// 2. per-arm totals
const fmtTok = n => (n / 1e6).toFixed(2) + "M";
console.log("\n=== PER-ARM TOTALS (all instances with a run) ===");
console.log("arm".padEnd(20), "runs", "resolv", "  $total", "  input", " output", "  cacheR", " totalTok", " $/resolved");
for (const a of ARMS) {
  const ms = ids.map(id => M(id, a)).filter(Boolean);
  const res = ids.filter(id => R(id, a) === true).length;
  const s = k => ms.reduce((x, m) => x + (m[k] || 0), 0);
  const cost = s("costUsd");
  console.log(a.padEnd(20), String(ms.length).padStart(4), String(res).padStart(6),
    ("$" + cost.toFixed(2)).padStart(8), fmtTok(s("input")).padStart(7), fmtTok(s("output")).padStart(7),
    fmtTok(s("cacheRead")).padStart(8), fmtTok(s("totalTokens")).padStart(9),
    ("$" + (cost / (res || 1)).toFixed(3)).padStart(11));
}

// 3. resolved-by-all-pi-arms apples-to-apples (exclude codex reference)
const PI = ARMS.filter(a => a !== "codex");
const common = ids.filter(id => PI.every(a => R(id, a) === true && M(id, a)));
console.log(`\n=== RESOLVED-BY-ALL-PI-ARMS (apples-to-apples success cost), n=${common.length} ===`);
console.log("arm".padEnd(20), "  $total", "  input", " output", "  cacheR", " totalTok", " vs classic");
let base = null;
for (const a of PI) {
  const ms = common.map(id => M(id, a));
  const s = k => ms.reduce((x, m) => x + (m[k] || 0), 0);
  const cost = s("costUsd"); if (a === "classic") base = cost;
  console.log(a.padEnd(20), ("$" + cost.toFixed(2)).padStart(8), fmtTok(s("input")).padStart(7), fmtTok(s("output")).padStart(7),
    fmtTok(s("cacheRead")).padStart(8), fmtTok(s("totalTokens")).padStart(9),
    (a === "classic" ? "—" : (((cost - base) / base * 100).toFixed(1) + "%")).padStart(11));
}
console.log(`\ncommon instances: ${common.join(", ")}`);
