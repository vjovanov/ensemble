#!/usr/bin/env node
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { instanceId } from "./build-prompt.mjs";

function arg(name, fallback = "") {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? fallback : process.argv[index + 1] || fallback;
}

function splitList(value) {
  return String(value || "").split(/[,\s]+/).filter(Boolean);
}

function readJSON(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function normId(value) {
  return String(value || "").toLowerCase().replace(/pr-/g, "").replace(/[^a-z0-9]/g, "");
}

function reportSet(report, keys) {
  const values = keys.flatMap((key) => report[key] || []);
  return new Set(values.map((entry) => normId(typeof entry === "string" ? entry : entry.instance_id || entry.id)));
}

function statusFor(report, id) {
  const normalized = normId(id);
  const resolved = reportSet(report, ["resolved_ids", "resolved"]);
  const unresolved = reportSet(report, ["unresolved_ids", "unresolved"]);
  const incomplete = reportSet(report, ["incomplete_ids", "incomplete"]);
  const emptyPatch = reportSet(report, ["empty_patch_ids", "empty_patch"]);
  const errors = reportSet(report, ["error_ids", "errors"]);

  if (resolved.has(normalized)) return { status: "resolved", resolved: true };
  if (unresolved.has(normalized)) return { status: "unresolved", resolved: false };
  if (emptyPatch.has(normalized)) return { status: "empty_patch", resolved: false };
  if (errors.has(normalized)) return { status: "error", resolved: false };
  if (incomplete.has(normalized)) return { status: "incomplete", resolved: false };
  return { status: "unknown", resolved: null };
}

function archiveExisting(path, historyDir) {
  if (!existsSync(path)) return;
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
  const archive = join(historyDir, basename(path, ".json"), `${stamp}.json`);
  mkdirSync(dirname(archive), { recursive: true });
  copyFileSync(path, archive);
}

const arm = arg("arm");
const reportPath = arg("report");
const outDir = arg("out-dir");
const historyDir = arg("history-dir");
const instancePaths = splitList(arg("instances"));

if (!arm || !reportPath || !outDir || instancePaths.length === 0) {
  console.error("usage: node lib/persist-validation.mjs --arm <arm> --report <final_report.json> --out-dir <dir> --history-dir <dir> --instances '<json...>'");
  process.exit(2);
}

if (!existsSync(reportPath)) {
  console.error(`no such report: ${reportPath}`);
  process.exit(1);
}

const report = readJSON(reportPath);
const updatedAt = new Date().toISOString();
mkdirSync(outDir, { recursive: true });
if (historyDir) mkdirSync(historyDir, { recursive: true });

for (const instancePath of instancePaths) {
  const instance = readJSON(instancePath);
  const id = instanceId(instance);
  const recordPath = join(outDir, `${id}.json`);
  if (historyDir) archiveExisting(recordPath, historyDir);
  const status = statusFor(report, id);
  writeFileSync(recordPath, JSON.stringify({
    instance: id,
    arm,
    ...status,
    updatedAt,
    report: reportPath,
  }, null, 2) + "\n");
}
