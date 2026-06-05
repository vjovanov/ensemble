// Join per-run metrics (bench/raw/<id>__<arm>/metrics.json) with the eval
// harness resolved report (bench/results/<arm>/final_report.json) into a tidy
// CSV plus a per-arm summary.
//
//   node collect.mjs            # writes results/results.csv and prints summary

import { readFileSync, readdirSync, existsSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const RAW = process.env.RAW_DIR || join(HERE, "raw");
const RESULTS = process.env.RESULTS_DIR || join(HERE, "results");

const readJSON = (p) => JSON.parse(readFileSync(p, "utf8"));

// resolved set per arm from the harness final_report.json
function resolvedByArm() {
  const map = {};
  for (const arm of readdirSync(RESULTS, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name)) {
    const fr = join(RESULTS, arm, "final_report.json");
    if (!existsSync(fr)) continue;
    const r = readJSON(fr);
    const list = r.resolved_instances || r.resolved || [];
    // entries may be ids or {instance_id}
    map[arm] = new Set(list.map((x) => (typeof x === "string" ? x : x.instance_id || x.id)));
  }
  return map;
}

const COLUMNS = ["instance", "arm", "resolved", "input", "output", "cacheRead", "cacheWrite",
  "totalTokens", "costUsd", "turns", "exploreCalls", "exploreFallbacks", "strictOk", "strictNote"];

function main() {
  const resolved = resolvedByArm();
  const rows = [];
  for (const dir of readdirSync(RAW, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name)) {
    const sep = dir.lastIndexOf("__");
    const instance = dir.slice(0, sep), arm = dir.slice(sep + 2);
    const mp = join(RAW, dir, "metrics.json");
    if (!existsSync(mp)) continue;
    const m = readJSON(mp);
    const isResolved = resolved[arm] ? (resolved[arm].has(instance) ? 1 : 0) : "";
    rows.push({
      instance, arm, resolved: isResolved,
      input: m.input ?? "", output: m.output ?? "", cacheRead: m.cacheRead ?? "", cacheWrite: m.cacheWrite ?? "",
      totalTokens: m.totalTokens ?? "", costUsd: m.costUsd ?? "", turns: m.assistantTurns ?? "",
      exploreCalls: m.exploreCalls ?? "", exploreFallbacks: m.exploreFallbacks ?? "",
      strictOk: m.strictOk ?? "", strictNote: (m.strictNote ?? "").replace(/,/g, ";"),
    });
  }
  rows.sort((a, b) => a.instance.localeCompare(b.instance) || a.arm.localeCompare(b.arm));

  const csv = [COLUMNS.join(","), ...rows.map((r) => COLUMNS.map((c) => r[c]).join(","))].join("\n");
  const outCsv = join(RESULTS, "results.csv");
  writeFileSync(outCsv, csv + "\n");
  console.log(`wrote ${outCsv} (${rows.length} rows)`);

  // Per-arm summary. A run is "counted" for an arm unless it's an ensemble-strict
  // run that failed the strict guarantee (fell back to filesystem / no explore) —
  // those don't count toward the graph arm, only get reported as `dropped`.
  const aggregate = (label, keep) => {
    const a = { n: 0, resolved: 0, cost: 0, tokens: 0, turns: 0, dropped: 0 };
    for (const r of rows.filter((r) => r.arm === label.arm)) {
      if (!keep(r)) { a.dropped++; continue; }
      a.n++;
      if (r.resolved === 1) a.resolved++;
      a.cost += Number(r.costUsd) || 0;
      a.tokens += Number(r.totalTokens) || 0;
      a.turns += Number(r.turns) || 0;
    }
    return { name: label.name, ...a };
  };

  const lines = [];
  for (const arm of [...new Set(rows.map((r) => r.arm))]) {
    if (arm === "ensemble-strict") {
      // strict-valid only: drop runs flagged strictOk===false.
      lines.push(aggregate({ arm, name: "ensemble-strict*" }, (r) => r.strictOk !== false && r.strictOk !== "false"));
    } else {
      lines.push(aggregate({ arm, name: arm }, () => true));
    }
  }

  console.log("\narm                n  resolved   $/run    tok/run   turns/run  dropped");
  for (const a of lines) {
    const per = (x) => (a.n ? x / a.n : 0);
    console.log(
      `${a.name.padEnd(17)} ${String(a.n).padStart(2)}  ${String(a.resolved).padStart(3)}/${a.n}   ` +
      `${per(a.cost).toFixed(3).padStart(6)}  ${Math.round(per(a.tokens)).toString().padStart(8)}  ` +
      `${per(a.turns).toFixed(1).padStart(8)}   ${String(a.dropped).padStart(6)}`);
  }
  console.log("* ensemble-strict counts only strict-valid runs (graph-derived explore); `dropped` = runs that fell back or never explored.");
  const haveResolved = Object.keys(resolved).length > 0;
  if (!haveResolved) console.log("(note: no final_report.json yet — run ./eval/run-eval.sh to fill the 'resolved' column)");
}

main();
