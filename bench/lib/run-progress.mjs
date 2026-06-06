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
    totalTokens: 0,
    assistantTurns: 0,
    toolCalls: 0,
    exploreCalls: 0,
    lastTool: "",
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
        totalTokens:
          stats.totalTokens +
          (message.usage.input || 0) +
          (message.usage.output || 0) +
          (message.usage.cacheRead || 0) +
          (message.usage.cacheWrite || 0),
      };
      for (const content of message.content || []) {
        if (content.type === "toolCall") {
          stats = {
            ...stats,
            lastTool: content.name || stats.lastTool,
          };
        }
      }
    }
    if (message.role === "toolResult") {
      stats = {
        ...stats,
        toolCalls: stats.toolCalls + 1,
        lastTool: message.toolName || stats.lastTool,
        exploreCalls: stats.exploreCalls + (message.toolName === "explore" ? 1 : 0),
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
  const width = 18;
  const ratio = timeout > 0 ? Math.min(elapsed / timeout, 1) : 0;
  const filled = Math.round(ratio * width);
  return `[${"#".repeat(filled)}${"-".repeat(width - filled)}]`;
}

function formatElapsed(seconds) {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}m${String(secs).padStart(2, "0")}s`;
}

const rawDir = arg("raw-dir");
const id = arg("id");
const arms = arg("arms").split(/\s+/).filter(Boolean);
const startedAt = Number(arg("started-at", "0"));
const timeout = Number(arg("timeout", "0"));
const elapsed = Math.max(0, Math.floor((Date.now() - startedAt) / 1000));

console.error(`[bench] progress ${id}`);
for (const arm of arms) {
  const sessionDir = join(rawDir, `${id}__${arm}`, "session");
  const stats = parseSession(latestSessionFile(sessionDir));
  const phase = lastPhase(rawDir, id, arm);
  console.error(
    `[bench]   ${arm.padEnd(16)} ${bar(elapsed, timeout)} ${formatElapsed(elapsed)}/${formatElapsed(timeout)} ` +
      `${String(stats.totalTokens).padStart(8)}tok ` +
      `${String(stats.assistantTurns).padStart(2)}t ` +
      `${String(stats.toolCalls).padStart(2)}tools ` +
      `${String(stats.exploreCalls).padStart(2)}explore ` +
      `${stats.lastTool ? `last=${stats.lastTool} ` : ""}${phase}`,
  );
}
