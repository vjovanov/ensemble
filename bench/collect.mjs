// Join per-run metrics (bench/raw/<id>__<arm>/metrics.json) with the eval
// harness resolved report (bench/results/<arm>/final_report.json) into a tidy
// CSV plus a per-arm summary.
//
//   node collect.mjs            # writes results/results.csv and prints summary

import { readFileSync, readdirSync, existsSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { instanceId } from "./lib/build-prompt.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const RAW = process.env.RAW_DIR || join(HERE, "raw");
const RESULTS = process.env.RESULTS_DIR || join(HERE, "results");

const readJSON = (p) => JSON.parse(readFileSync(p, "utf8"));
const selectedInstances = process.env.INSTANCES
  ? new Set(process.env.INSTANCES.trim().split(/\s+/).filter(Boolean).map((p) => instanceId(readJSON(p))))
  : undefined;

// resolved set per arm from the harness final_report.json
function resolvedByArm() {
  const map = {};
  for (const arm of readdirSync(RESULTS, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name)) {
    const fr = join(RESULTS, arm, "final_report.json");
    if (!existsSync(fr)) continue;
    const r = readJSON(fr);
    // resolved_ids is the array; resolved_instances is a count. Harness ids look
    // like "org/repo:pr-N"; our raw dirs use instance_id "org__repo-N" — normalize both.
    const list = r.resolved_ids || r.resolved || [];
    map[arm] = new Set(list.map((x) => normId(typeof x === "string" ? x : x.instance_id || x.id)));
  }
  return map;
}

// Canonicalize an instance identifier across the harness and our naming.
const normId = (s) => String(s).toLowerCase().replace(/pr-/g, "").replace(/[^a-z0-9]/g, "");

const COLUMNS = ["instance", "arm", "resolved", "input", "output", "cacheRead", "cacheWrite",
  "totalTokens", "costUsd", "turns", "exploreCalls", "exploreFallbacks", "strictOk", "strictNote"];

function main() {
  const resolved = resolvedByArm();
  const rows = [];
  for (const dir of readdirSync(RAW, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name)) {
    const sep = dir.lastIndexOf("__");
    const instance = dir.slice(0, sep), arm = dir.slice(sep + 2);
    if (selectedInstances && !selectedInstances.has(instance)) continue;
    const mp = join(RAW, dir, "metrics.json");
    if (!existsSync(mp)) continue;
    const m = readJSON(mp);
    const isResolved = resolved[arm] ? (resolved[arm].has(normId(instance)) ? 1 : 0) : "";
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

  // ---- Complete results: every token count + price + success, per instance ----
  const armOrder = (a) => (a === "ensemble-strict" ? 0 : a === "classic" ? 2 : 1);
  const armLbl = (a) => (a === "ensemble-strict" ? "graph" : a);
  const N = (x) => (x === "" || x == null ? "-" : Number(x).toLocaleString());
  const byInst = {};
  for (const r of rows) (byInst[r.instance] ||= []).push(r);
  console.log("\n════════ COMPLETE RESULTS ════════");
  console.log(
    "instance         arm        input   output   cacheRead      total      cost  turns  resolved");
  for (const inst of Object.keys(byInst).sort()) {
    for (const r of byInst[inst].sort((a, b) => armOrder(a.arm) - armOrder(b.arm))) {
      console.log(
        `${inst.replace(/__.*/, "").slice(0, 16).padEnd(16)} ${armLbl(r.arm).padEnd(9)}` +
        `${N(r.input).padStart(8)}${N(r.output).padStart(9)}${N(r.cacheRead).padStart(12)}` +
        `${N(r.totalTokens).padStart(11)}${("$" + (Number(r.costUsd) || 0).toFixed(3)).padStart(10)}` +
        `${String(r.turns ?? "-").padStart(6)}${String(r.resolved === 1 ? "YES" : r.resolved === 0 ? "no" : "-").padStart(8)}`);
    }
    console.log("-".repeat(90));
  }

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

  // ---- Headline: graph vs classic (totals, ratios, success rate) ----
  const sum = (arm, f) => rows.filter((r) => r.arm === arm).reduce((s, r) => s + (Number(r[f]) || 0), 0);
  const resolveRate = (arm) => {
    const rs = rows.filter((r) => r.arm === arm);
    return `${rs.reduce((s, r) => s + (r.resolved === 1 ? 1 : 0), 0)}/${rs.length}`;
  };
  if (rows.some((r) => r.arm === "ensemble-strict") && rows.some((r) => r.arm === "classic")) {
    const gt = sum("ensemble-strict", "totalTokens"), ct = sum("classic", "totalTokens");
    const gc = sum("ensemble-strict", "costUsd"), cc = sum("classic", "costUsd");
    console.log("\n════════ HEADLINE: graph vs classic ════════");
    console.log(`  tokens:  graph ${gt.toLocaleString()}  vs  classic ${ct.toLocaleString()}   →  ${(gt / ct).toFixed(2)}×`);
    console.log(`  cost:    graph $${gc.toFixed(2)}  vs  classic $${cc.toFixed(2)}   →  ${(gc / cc).toFixed(2)}×`);
    console.log(`  resolved: graph ${resolveRate("ensemble-strict")}   classic ${resolveRate("classic")}`);
  }
}

main();
