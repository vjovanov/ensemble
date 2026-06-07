#!/usr/bin/env node
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { instanceId } from "./build-prompt.mjs";

function arg(name, fallback = "") {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? fallback : process.argv[index + 1] || fallback;
}

function splitList(value) {
  return String(value || "")
    .split(/[,\s]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function readJSON(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function allInstancePaths(instDir) {
  if (!existsSync(instDir)) return [];
  return readdirSync(instDir)
    .filter((name) => name.endsWith(".json"))
    .sort()
    .map((name) => join(instDir, name));
}

function resolveInstanceRef(ref, instDir) {
  if (ref.endsWith(".json") || ref.includes("/")) {
    if (!existsSync(ref)) throw new Error(`no such instance json: ${ref}`);
    return ref;
  }
  const path = join(instDir, `${ref}.json`);
  if (!existsSync(path)) throw new Error(`no such instance id: ${ref} (${path})`);
  return path;
}

function parseCsvRows(path) {
  const text = readFileSync(path, "utf8");
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (lines.length === 0) return [];
  const first = lines[0].split(",").map((cell) => cell.trim());
  const headerIndex = first.findIndex((cell) => ["instance", "id", "path"].includes(cell));
  const start = headerIndex === -1 ? 0 : 1;
  const index = headerIndex === -1 ? 0 : headerIndex;
  return lines.slice(start).map((line) => line.split(",")[index]?.trim()).filter(Boolean);
}

function main() {
  const instDir = arg("inst-dir", "instances");
  const instances = splitList(arg("instances", process.env.INSTANCES || ""));
  const ids = splitList(arg("ids", process.env.BENCH_INSTANCES || process.env.BENCH_IDS || ""));
  const langs = new Set(splitList(arg("langs", process.env.BENCH_LANGS || process.env.LANGS || "")));
  const csv = arg("csv", process.env.BENCH_CSV || "");
  const csvRefs = csv ? parseCsvRows(csv) : [];
  const explicitRefs = [...instances, ...ids, ...csvRefs];
  const base = explicitRefs.length > 0
    ? explicitRefs.map((ref) => resolveInstanceRef(ref, instDir))
    : allInstancePaths(instDir);

  const seen = new Set();
  const selected = [];
  for (const path of base) {
    const inst = readJSON(path);
    const id = instanceId(inst);
    const lang = String(inst.language ?? inst.lang ?? "");
    if (langs.size > 0 && !langs.has(lang)) continue;
    if (seen.has(id)) continue;
    seen.add(id);
    selected.push(path);
  }

  if (selected.length === 0) {
    throw new Error("no instances matched selection");
  }
  process.stdout.write(`${selected.join("\n")}\n`);
}

main();
