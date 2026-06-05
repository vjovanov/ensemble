// Build a leak-free problem statement from a Multi-SWE-bench instance.
// We use ONLY resolved_issues (the original issue text). We never include the
// PR body, fix_patch, or test_patch — those would leak the solution.
//
// Usage: node build-prompt.mjs <instance.json>   (prints the agent prompt)
// Or import { buildProblemStatement, buildPrompt } from "./build-prompt.mjs".

import { readFileSync } from "node:fs";

function issueText(issue) {
  if (issue == null) return "";
  if (typeof issue === "string") return issue.trim();
  // Object form: { title, body } (field names vary slightly across releases).
  const title = issue.title ?? issue.name ?? "";
  const body = issue.body ?? issue.text ?? issue.description ?? "";
  return [title, body].filter(Boolean).join("\n\n").trim();
}

export function buildProblemStatement(instance) {
  let issues = instance.resolved_issues ?? instance.problem_statement ?? [];
  if (typeof issues === "string") return issues.trim();
  if (!Array.isArray(issues)) issues = [issues];
  const parts = issues.map(issueText).filter(Boolean);
  return parts.join("\n\n---\n\n").trim();
}

export function instanceId(instance) {
  const raw = instance.instance_id || `${instance.org}__${instance.repo}_PR-${instance.number}`;
  // Used as a directory/path component — keep it filesystem-safe.
  return String(raw).replace(/[^\w.-]/g, "_");
}

export function buildPrompt(instance) {
  const problem = buildProblemStatement(instance);
  const lang = instance.language ?? instance.lang ?? "";
  const repo = `${instance.org}/${instance.repo}`;
  return [
    `You are resolving a real issue in the ${repo} repository${lang ? ` (${lang})` : ""}.`,
    ``,
    `## Issue`,
    problem || "(no issue text provided)",
    ``,
    `## Task`,
    `Investigate the codebase and make the minimal source changes needed to resolve the issue.`,
    `Do NOT modify, add, or delete any test files — the grader applies its own tests.`,
    `Edit the code in place. When you are confident the fix is complete, stop.`,
  ].join("\n");
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const path = process.argv[2];
  if (!path) {
    console.error("usage: node build-prompt.mjs <instance.json>");
    process.exit(2);
  }
  const inst = JSON.parse(readFileSync(path, "utf8"));
  process.stdout.write(buildPrompt(inst));
}
