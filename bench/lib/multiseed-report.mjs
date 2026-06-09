// Aggregate a multi-seed run into pass@K + mean cost per (instance, arm). §REQ-005-research-checkpoints.0
// Usage: node multiseed-report.mjs <multiseed/<name> dir>
import { readFileSync, existsSync, readdirSync } from "node:fs";

const root = process.argv[2];
if (!root || !existsSync(root)) { console.error("usage: multiseed-report.mjs <dir>"); process.exit(1); }
const seeds = readdirSync(root).filter((d) => /^s\d+$/.test(d)).sort();
const K = seeds.length;

// collect: pair[id__arm] = { resolved:[...], cost:[...] }
const pair = {};
for (const s of seeds) {
  const sdir = `${root}/${s}`;
  for (const pd of readdirSync(sdir).filter((d) => d.includes("__"))) {
    const [id, arm] = [pd.replace(/__[^_]*$/, ""), pd.split("__").pop()];
    const m = existsSync(`${sdir}/${pd}/metrics.json`) ? JSON.parse(readFileSync(`${sdir}/${pd}/metrics.json`, "utf8")) : null;
    const vp = `${sdir}/validation/${arm}/${id}.json`;
    const r = existsSync(vp) ? JSON.parse(readFileSync(vp, "utf8")).resolved : null;
    (pair[pd] ||= { resolved: [], cost: [] });
    pair[pd].resolved.push(!!r);
    if (m && r) pair[pd].cost.push(m.costUsd); // cost only over resolved seeds
  }
}

const arms = [...new Set(Object.keys(pair).map((k) => k.split("__").pop()))];
console.log(`multi-seed report: ${root}  (K=${K})\n`);
for (const arm of arms) {
  const rows = Object.entries(pair).filter(([k]) => k.endsWith(`__${arm}`)).sort();
  let passK = 0, allK = 0;
  console.log(`== ${arm} ==`);
  for (const [k, v] of rows) {
    const nres = v.resolved.filter(Boolean).length;
    const pass = nres >= 1;            // pass@K = resolved in >=1 of K
    const stable = nres === K;         // resolved every seed
    if (pass) passK++; if (stable) allK++;
    const meanCost = v.cost.length ? (v.cost.reduce((a, b) => a + b, 0) / v.cost.length) : null;
    console.log(`  ${k.split("__")[0].padEnd(22)} pass@${K}=${pass ? "Y" : "n"} (${nres}/${K})  ${meanCost != null ? "$" + meanCost.toFixed(2) + "/run" : "-"}`);
  }
  console.log(`  pass@${K}: ${passK}/${rows.length}   stable(all ${K}): ${allK}/${rows.length}\n`);
}
