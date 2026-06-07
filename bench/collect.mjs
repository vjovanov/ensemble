// Join per-run metrics (bench/raw/<id>__<arm>/metrics.json) with the eval
// harness resolved report (bench/results/<arm>/final_report.json) into a tidy
// CSV plus a per-arm summary.
//
//   node collect.mjs            # writes results/results.csv and prints summary

import { mkdirSync, readFileSync, readdirSync, existsSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { instanceId } from "./lib/build-prompt.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const RAW = process.env.RAW_DIR || join(HERE, "raw");
const RESULTS = process.env.RESULTS_DIR || join(HERE, "results");
const VALIDATION = process.env.VALIDATION_DIR || join(RESULTS, "validation");

const readJSON = (p) => JSON.parse(readFileSync(p, "utf8"));
const selectedInstances = process.env.INSTANCES
  ? new Set(process.env.INSTANCES.trim().split(/[,\s]+/).filter(Boolean).map((p) => instanceId(readJSON(p))))
  : undefined;
const selectedArms = process.env.ARMS
  ? new Set(process.env.ARMS.trim().split(/[,\s]+/).filter(Boolean))
  : undefined;

function setResolved(map, arm, id, value) {
  map[arm] ||= new Map();
  map[arm].set(normId(id), value);
}

function reportList(report, keys) {
  return keys.flatMap((key) => report[key] || []);
}

function reportId(entry) {
  return typeof entry === "string" ? entry : entry.instance_id || entry.id;
}

// Resolved status per arm. Per-instance validation records are persisted across
// partial reruns, so they override the latest arm-level final_report.json when present.
function resolvedByArm() {
  const map = {};
  if (existsSync(RESULTS)) {
    for (const arm of readdirSync(RESULTS, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name)) {
      if (selectedArms && !selectedArms.has(arm)) continue;
      const fr = join(RESULTS, arm, "final_report.json");
      if (!existsSync(fr)) continue;
      const r = readJSON(fr);
      for (const entry of reportList(r, ["resolved_ids", "resolved"])) setResolved(map, arm, reportId(entry), 1);
      for (const entry of reportList(r, ["unresolved_ids", "unresolved", "incomplete_ids", "incomplete", "empty_patch_ids", "empty_patch", "error_ids", "errors"])) {
        setResolved(map, arm, reportId(entry), 0);
      }
    }
  }
  if (existsSync(VALIDATION)) {
    for (const arm of readdirSync(VALIDATION, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name)) {
      if (selectedArms && !selectedArms.has(arm)) continue;
      const dir = join(VALIDATION, arm);
      for (const file of readdirSync(dir).filter((name) => name.endsWith(".json"))) {
        const record = readJSON(join(dir, file));
        if (record.resolved === true) setResolved(map, arm, record.instance || file.replace(/\.json$/, ""), 1);
        else if (record.resolved === false) setResolved(map, arm, record.instance || file.replace(/\.json$/, ""), 0);
      }
    }
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
  mkdirSync(RESULTS, { recursive: true });
  for (const dir of readdirSync(RAW, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name)) {
    const sep = dir.lastIndexOf("__");
    const instance = dir.slice(0, sep), arm = dir.slice(sep + 2);
    if (selectedInstances && !selectedInstances.has(instance)) continue;
    if (selectedArms && !selectedArms.has(arm)) continue;
    const mp = join(RAW, dir, "metrics.json");
    if (!existsSync(mp)) continue;
    const m = readJSON(mp);
    const isResolved = resolved[arm]?.get(normId(instance)) ?? "";
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
  const isStrictGraphArm = (a) => a === "classic-graph" || a === "classic-graph-bash" || a === "ensemble-strict" || a === "graph-bash";
  const armOrder = (a) => a === "classic" ? 0 : a === "classic-bash" ? 1 : a === "classic-graph-bash" || a === "graph-bash" ? 2 : a === "classic-graph" || a === "ensemble-strict" ? 3 : 4;
  const armLbl = (a) => a === "ensemble-strict" ? "classic-graph" : a === "graph-bash" ? "classic-graph-bash" : a;
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
    if (isStrictGraphArm(arm)) {
      // strict-valid only: drop runs flagged strictOk===false.
      lines.push(aggregate({ arm, name: `${arm}*` }, (r) => r.strictOk !== false && r.strictOk !== "false"));
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
  console.log("* graph-backed strict arms count only strict-valid runs (graph-derived explore); `dropped` = runs that fell back or never explored.");
  const haveResolved = Object.keys(resolved).length > 0;
  if (!haveResolved) console.log("(note: no final_report.json yet — run ./eval/run-eval.sh to fill the 'resolved' column)");

  // ---- Headline: candidate vs classic (totals, ratios, success rate) ----
  const strictValid = (r) => !isStrictGraphArm(r.arm) || (r.strictOk !== false && r.strictOk !== "false");
  const headlineRows = (arm) => rows.filter((r) => r.arm === arm && strictValid(r));
  const sum = (arm, f) => headlineRows(arm).reduce((s, r) => s + (Number(r[f]) || 0), 0);
  const resolveRate = (arm) => {
    const rs = headlineRows(arm);
    return `${rs.reduce((s, r) => s + (r.resolved === 1 ? 1 : 0), 0)}/${rs.length}`;
  };
  const candidates = [
    "classic-bash",
    rows.some((r) => r.arm === "classic-graph-bash") ? "classic-graph-bash" : "graph-bash",
    rows.some((r) => r.arm === "classic-graph") ? "classic-graph" : "ensemble-strict",
  ];
  for (const candidateArm of candidates) {
    if (!rows.some((r) => r.arm === candidateArm) || !rows.some((r) => r.arm === "classic")) continue;
    const candidateTokens = sum(candidateArm, "totalTokens"), classicTokens = sum("classic", "totalTokens");
    const candidateCost = sum(candidateArm, "costUsd"), classicCost = sum("classic", "costUsd");
    console.log(`\n════════ HEADLINE: ${armLbl(candidateArm)} vs classic ════════`);
    console.log(`  tokens:  ${armLbl(candidateArm)} ${candidateTokens.toLocaleString()}  vs  classic ${classicTokens.toLocaleString()}   →  ${(candidateTokens / classicTokens).toFixed(2)}×`);
    console.log(`  cost:    ${armLbl(candidateArm)} $${candidateCost.toFixed(2)}  vs  classic $${classicCost.toFixed(2)}   →  ${(candidateCost / classicCost).toFixed(2)}×`);
    console.log(`  resolved: ${armLbl(candidateArm)} ${resolveRate(candidateArm)}   classic ${resolveRate("classic")}`);
  }
}

main();
