// REQ-002/003 verdict: candidate arm vs a frozen base. §REQ-005-research-checkpoints.3
// Usage: node compare.mjs --base-raw DIR --base-val DIR --cand-raw DIR --cand-val DIR [--arm classic-graph-bash]
// A "source" is a raw dir (<id>__<arm>/metrics.json) + a validation dir (<arm>/<id>.json).
// Candidate falls back to the base for any (instance,arm) it did not re-run, so partial reruns compare cleanly.
import { readFileSync, existsSync, readdirSync } from "node:fs";

const a = {};
for (let i = 2; i < process.argv.length; i += 2) a[process.argv[i].replace(/^--/, "")] = process.argv[i + 1];
const ARM = a.arm || "classic-graph-bash";
const BASE = "classic";

const met = (rawDir, id, arm) => {
  const p = `${rawDir}/${id}__${arm}/metrics.json`;
  return existsSync(p) ? JSON.parse(readFileSync(p, "utf8")) : null;
};
const res = (valDir, id, arm) => {
  const p = `${valDir}/${arm}/${id}.json`;
  return existsSync(p) ? JSON.parse(readFileSync(p, "utf8")).resolved : null;
};
// instance ids = union of base arm dirs
const ids = [...new Set(
  readdirSync(a["base-raw"]).filter((d) => d.endsWith(`__${ARM}`)).map((d) => d.replace(`__${ARM}`, "")),
)].sort();

// candidate value, falling back to base when the experiment didn't re-run it
const cMet = (id, arm) => met(a["cand-raw"], id, arm) || met(a["base-raw"], id, arm);
const cRes = (id, arm) => { const v = res(a["cand-val"], id, arm); return v === null ? res(a["base-val"], id, arm) : v; };

let regress = [], newWins = [];
let bResolvedArm = 0, cResolvedArm = 0;
let cc = 0, gc = 0, ct = 0, gt = 0, both = 0;
for (const id of ids) {
  const bArm = res(a["base-val"], id, ARM), cArm = cRes(id, ARM);
  if (bArm) bResolvedArm++;
  if (cArm) cResolvedArm++;
  if (bArm && !cArm) regress.push(id);
  if (!bArm && cArm) newWins.push(id);
  // cost on instances the candidate arm resolves AND classic resolves
  const clRes = cRes(id, BASE);
  if (cArm && clRes) {
    const cm = cMet(id, BASE), gm = cMet(id, ARM);
    if (cm && gm) { cc += cm.costUsd; gc += gm.costUsd; ct += cm.totalTokens; gt += gm.totalTokens; both++; }
  }
}
const pct = (x, y) => (x === 0 ? "n/a" : (y < x ? "-" : "+") + Math.abs(Math.round((y - x) / x * 100)) + "%");
const noRegress = regress.length === 0;
const moreResolved = cResolvedArm > bResolvedArm;
const cheaper = gc <= cc;
const verdict = noRegress && (moreResolved || cheaper);

console.log(`arm=${ARM}  vs base classic`);
console.log(`resolved(${ARM}): base ${bResolvedArm} -> cand ${cResolvedArm}`);
console.log(`regressions (base resolved, cand not): ${regress.length ? regress.map((i) => i.split("__").pop()).join(", ") : "none"}`);
console.log(`new wins (cand resolves, base did not): ${newWins.length ? newWins.map((i) => i.split("__").pop()).join(", ") : "none"}`);
console.log(`cost on resolved-by-both (${both}): classic $${cc.toFixed(2)} -> ${ARM} $${gc.toFixed(2)}  cost ${pct(cc, gc)}  tok ${pct(ct, gt)}`);
console.log(`\nVERDICT: ${verdict ? "PASS — promote" : "FAIL — do not promote"}  (no-regression=${noRegress}, more-resolved=${moreResolved}, cheaper-or-equal=${cheaper})`);
process.exit(verdict ? 0 : 1);
