#!/usr/bin/env node
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

function arg(name, fallback = "") {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? fallback : process.argv[index + 1] || fallback;
}

function latestSessionFile(dir) {
  if (!existsSync(dir)) return "";
  const files = readdirSync(dir)
    .filter((name) => name.endsWith(".jsonl"))
    .map((name) => join(dir, name))
    .sort();
  return files.at(-1) || "";
}

function parseSession(file) {
  const empty = {
    inputTokens: 0,
    outputTokens: 0,
    cacheInputTokens: 0,
    assistantTurns: 0,
    toolCalls: 0,
    exploreCalls: 0,
    lastTool: "",
    lastToolArgs: undefined,
    activity: "",
  };
  if (!file || !existsSync(file)) return empty;

  let stats = empty;
  for (const line of readFileSync(file, "utf8").split("\n")) {
    if (!line) continue;
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    if (entry.type !== "message") continue;
    const message = entry.message || entry;
    if (message.role === "assistant" && message.usage) {
      stats = {
        ...stats,
        assistantTurns: stats.assistantTurns + 1,
        inputTokens: stats.inputTokens + (message.usage.input || 0),
        outputTokens: stats.outputTokens + (message.usage.output || 0),
        cacheInputTokens:
          stats.cacheInputTokens + (message.usage.cacheRead || 0) + (message.usage.cacheWrite || 0),
      };
      for (const content of message.content || []) {
        if (content.type === "toolCall") {
          stats = {
            ...stats,
            lastTool: content.name || stats.lastTool,
            lastToolArgs: content.arguments,
            activity: `agent requested ${content.name || "tool"}`,
          };
        }
      }
      if (!stats.activity) {
        stats = {
          ...stats,
          activity: message.stopReason ? `agent turn ended: ${message.stopReason}` : "agent turn complete",
        };
      }
    }
    if (message.role === "toolResult") {
      stats = {
        ...stats,
        toolCalls: stats.toolCalls + 1,
        lastTool: message.toolName || stats.lastTool,
        exploreCalls: stats.exploreCalls + (message.toolName === "explore" ? 1 : 0),
        activity: `${message.toolName || "tool"} completed`,
      };
    }
  }
  return stats;
}

function lastPhase(rawDir, id, arm) {
  const logFile = join(rawDir, `.log_${id}_${arm}.txt`);
  if (!existsSync(logFile)) return "starting";
  const lines = readFileSync(logFile, "utf8").trimEnd().split("\n").filter(Boolean);
  const line = lines.at(-1) || "starting";
  return line
    .replace(/\x1b\[[0-9;]*m/g, "")
    .replace(/^\[bench\]\s*/, "")
    .slice(0, 64);
}

function bar(elapsed, timeout) {
  const width = 12;
  const ratio = timeout > 0 ? Math.min(elapsed / timeout, 1) : 0;
  const filled = Math.round(ratio * width);
  return `[${"#".repeat(filled)}${"-".repeat(width - filled)}]`;
}

function formatElapsed(seconds) {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
}

function compactNumber(value) {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}m`;
  if (value >= 10_000) return `${Math.round(value / 1000)}k`;
  if (value >= 1000) return `${(value / 1000).toFixed(1)}k`;
  return String(value);
}

function label(arm) {
  if (arm === "ensemble-strict") return "classic-graph";
  if (arm === "graph-bash") return "classic-graph-bash";
  return arm;
}

function fit(text, width) {
  if (text.length <= width) return text.padEnd(width);
  if (width <= 1) return text.slice(0, width);
  return `${text.slice(0, width - 1)}…`;
}

function stringifyValue(value) {
  if (typeof value === "string") return value;
  if (value === undefined) return "";
  return JSON.stringify(value);
}

function formatToolArgs(args) {
  if (!args || typeof args !== "object" || Array.isArray(args)) {
    const value = stringifyValue(args);
    return value ? ` args=${value}` : "";
  }
  return Object.entries(args)
    .map(([key, value]) => `${key}=${stringifyValue(value)}`)
    .join("  ");
}

function toolLine(stats, width, tui) {
  const name = stats.lastTool || "-";
  const args = formatToolArgs(stats.lastToolArgs);
  const line = `[bench]          tool=${name}${args ? `  ${args}` : ""}`;
  return tui ? fit(line, width) : line;
}

const rawDir = arg("raw-dir");
const id = arg("id");
const arms = arg("arms").split(/\s+/).filter(Boolean);
const startedAt = Number(arg("started-at", "0"));
const timeout = Number(arg("timeout", "0"));
const tui = arg("tui", "0") === "1";
const columns = Math.max(60, Number(arg("columns", String(process.stderr.columns || 120))));
const elapsed = Math.max(0, Math.floor((Date.now() - startedAt) / 1000));

const lines = [];
if (!tui) lines.push(`[bench] progress ${id}`);
for (const arm of arms) {
  const sessionDir = join(rawDir, `${id}__${arm}`, "session");
  const stats = parseSession(latestSessionFile(sessionDir));
  const phase = stats.activity || lastPhase(rawDir, id, arm);
  const last = stats.lastTool ? ` last=${stats.lastTool}` : "";
  const status =
    `[bench] ${fit(label(arm), 8)} ${bar(elapsed, timeout)} ${formatElapsed(elapsed)}/${formatElapsed(timeout)} ` +
      `${compactNumber(stats.inputTokens).padStart(6)} i ` +
      `${compactNumber(stats.outputTokens).padStart(6)} o ` +
      `${compactNumber(stats.cacheInputTokens).padStart(6)} c-i ` +
      `${String(stats.assistantTurns).padStart(2)} turns ` +
      `${String(stats.toolCalls).padStart(2)} tools ` +
      `${String(stats.exploreCalls).padStart(2)} exp ` +
      `${fit(`${phase}${last}`, 32)}`;
  lines.push(tui ? fit(status, columns) : status);
  lines.push(toolLine(stats, columns, tui));
}

for (const line of lines) {
  process.stderr.write(`${tui ? "\x1b[2K" : ""}${line}\n`);
}
