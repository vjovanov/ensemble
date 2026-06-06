#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";

function arg(name, fallback = "") {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? fallback : process.argv[index + 1] || fallback;
}

function splitList(value) {
  return value.split(/\s+/).filter(Boolean);
}

function instanceId(path) {
  return basename(path, ".json");
}

function latestJsonl(dir) {
  if (!existsSync(dir)) return "";
  return readdirSync(dir)
    .filter((name) => name.endsWith(".jsonl"))
    .map((name) => join(dir, name))
    .sort()
    .at(-1) || "";
}

function parseJsonLines(file) {
  if (!file || !existsSync(file)) return [];
  const entries = [];
  for (const line of readFileSync(file, "utf8").split("\n")) {
    if (!line) continue;
    try {
      entries.push(JSON.parse(line));
    } catch {}
  }
  return entries;
}

function textFromContent(content) {
  return (content || [])
    .map((part) => {
      if (part?.type === "text") return part.text || "";
      if (part?.type === "image") return "[image]";
      return "";
    })
    .filter(Boolean)
    .join("\n");
}

function lineCount(text) {
  if (!text) return 0;
  const lines = text.split("\n");
  return text.endsWith("\n") ? lines.length - 1 : lines.length;
}

function byteCount(text) {
  return Buffer.byteLength(text || "", "utf8");
}

function compactArgs(args) {
  if (args === undefined) return "";
  const text = typeof args === "string" ? args : JSON.stringify(args);
  return text.replace(/\s+/g, " ").trim();
}

function parseLeadCalls(rawDir, id, arm) {
  const sessionFile = latestJsonl(join(rawDir, `${id}__${arm}`, "session"));
  const pending = new Map();
  const rows = [];
  let ordinal = 0;

  for (const entry of parseJsonLines(sessionFile)) {
    if (entry.type !== "message") continue;
    const message = entry.message || entry;
    if (message.role === "assistant") {
      for (const content of message.content || []) {
        if (content.type !== "toolCall") continue;
        const row = {
          instance: id,
          arm,
          source: "lead",
          ordinal: ++ordinal,
          tool: content.name || "",
          lines: 0,
          bytes: 0,
          status: "pending",
          countSource: "exact",
          args: compactArgs(content.arguments),
        };
        pending.set(content.id, row);
      }
    }
    if (message.role === "toolResult") {
      const text = textFromContent(message.content);
      const row = pending.get(message.toolCallId) || {
        instance: id,
        arm,
        source: "lead",
        ordinal: ++ordinal,
        tool: message.toolName || "",
        args: "",
        countSource: "exact",
      };
      row.tool = row.tool || message.toolName || "";
      row.lines = lineCount(text);
      row.bytes = byteCount(text);
      row.status = message.isError ? "error" : "ok";
      rows.push(row);
      pending.delete(message.toolCallId);
    }
  }

  rows.push(...pending.values());
  return rows;
}

function parseSidekickCalls(rawDir, id, arm) {
  const debugFile = join(rawDir, `${id}__${arm}`, "explore-debug.jsonl");
  const starts = new Map();
  const rows = [];
  let sequence = 0;

  for (const entry of parseJsonLines(debugFile)) {
    if (entry.type !== "tool_call") continue;
    const ordinal = Number(entry.ordinal || 0);
    if (entry.phase === "start") {
      starts.set(ordinal, entry);
      continue;
    }
    if (entry.phase !== "end") continue;
    const start = starts.get(ordinal);
    const hasExactLines = Number.isFinite(entry.resultLines);
    const preview = entry.resultPreview || "";
    rows.push({
      instance: id,
      arm,
      source: "sidekick",
      ordinal: ++sequence,
      tool: entry.tool || start?.tool || "",
      lines: hasExactLines ? entry.resultLines : lineCount(preview),
      bytes: Number.isFinite(entry.resultBytes) ? entry.resultBytes : byteCount(preview),
      status: entry.status || "",
      countSource: hasExactLines ? "exact" : "preview",
      args: compactArgs(start?.args),
    });
    starts.delete(ordinal);
  }

  for (const start of starts.values()) {
    rows.push({
      instance: id,
      arm,
      source: "sidekick",
      ordinal: ++sequence,
      tool: start.tool || "",
      lines: 0,
      bytes: 0,
      status: "pending",
      countSource: "none",
      args: compactArgs(start.args),
    });
  }

  return rows;
}

function fit(text, width) {
  if (text.length <= width) return text.padEnd(width);
  if (width <= 1) return text.slice(0, width);
  return `${text.slice(0, width - 1)}…`;
}

function printTable(rows) {
  console.log("[bench] tool-call line counts");
  console.log(
    `[bench] ${fit("instance", 28)} ${fit("arm", 15)} ${fit("src", 8)} ${fit("#", 4)} ${fit("tool", 14)} ${fit("lines", 7)} ${fit("bytes", 8)} ${fit("status", 8)} args`,
  );
  for (const row of rows) {
    const lines = `${row.lines}${row.countSource === "preview" ? "p" : ""}`;
    console.log(
      `[bench] ${fit(row.instance, 28)} ${fit(row.arm, 15)} ${fit(row.source, 8)} ` +
        `${String(row.ordinal).padStart(4)} ${fit(row.tool, 14)} ${String(lines).padStart(7)} ` +
        `${String(row.bytes).padStart(8)} ${fit(row.status, 8)} ${fit(row.args, 120).trimEnd()}`,
    );
  }
}

function tsvCell(value) {
  return String(value ?? "").replace(/\t/g, " ").replace(/\r?\n/g, "\\n");
}

function writeTsv(path, rows) {
  mkdirSync(dirname(path), { recursive: true });
  const header = ["instance", "arm", "source", "ordinal", "tool", "lines", "bytes", "status", "countSource", "args"];
  const lines = [
    header.join("\t"),
    ...rows.map((row) =>
      header
        .map((key) => tsvCell(row[key]))
        .join("\t"),
    ),
  ];
  writeFileSync(path, `${lines.join("\n")}\n`);
}

const rawDir = arg("raw-dir");
const instances = splitList(arg("instances")).map(instanceId);
const arms = splitList(arg("arms"));
const out = arg("out");

if (!rawDir || instances.length === 0 || arms.length === 0) {
  console.error("usage: node tool-call-report.mjs --raw-dir <dir> --instances '<files>' --arms '<arms>' [--out <tsv>]");
  process.exit(2);
}

const rows = [];
for (const id of instances) {
  for (const arm of arms) {
    rows.push(...parseLeadCalls(rawDir, id, arm));
    rows.push(...parseSidekickCalls(rawDir, id, arm));
  }
}

if (out) {
  writeTsv(out, rows);
}
printTable(rows);
if (out) {
  console.log(`[bench] tool-call line count TSV: ${out}`);
}
