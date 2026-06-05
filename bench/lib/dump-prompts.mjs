// Dump the exact explore prompts a run uses, so each run bundle is self-describing.
// Run via tsx (it imports the product .ts):
//   tsx lib/dump-prompts.mjs <outDir>
//
// Writes:
//   lead-explore-tool.txt   — the explore tool as the LEAD agent sees it
//                             (description + guidelines + parameter hints)
//   sidekick-graph.txt      — explore sub-agent prompt, graph-backed mode
//   sidekick-filesystem.txt — explore sub-agent prompt, filesystem-fallback mode
//
// The FULL lead system prompt (base pi template) is not reconstructed here — it is
// pinned by the commit recorded in manifest.json; this captures the explore-specific
// instructions, which are the part this benchmark tunes.

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  createExploreToolDefinition,
  exploreSidekickSystemPrompt,
} from "../../packages/coding-agent/src/core/tools/explore.ts";

const outDir = process.argv[2];
if (!outDir) {
  console.error("usage: tsx lib/dump-prompts.mjs <outDir>");
  process.exit(2);
}
mkdirSync(outDir, { recursive: true });

const def = createExploreToolDefinition(process.cwd());
const lead = [
  "# explore tool — as the LEAD agent sees it",
  "",
  "## description",
  def.description,
  "",
  "## promptSnippet",
  def.promptSnippet ?? "",
  "",
  "## promptGuidelines",
  ...(def.promptGuidelines ?? []).map((g) => `- ${g}`),
  "",
  "## parameters (field descriptions)",
  JSON.stringify(def.parameters, null, 2),
  "",
].join("\n");

writeFileSync(join(outDir, "lead-explore-tool.txt"), lead);
writeFileSync(join(outDir, "sidekick-graph.txt"), exploreSidekickSystemPrompt(true) + "\n");
writeFileSync(join(outDir, "sidekick-filesystem.txt"), exploreSidekickSystemPrompt(false) + "\n");
console.log(`wrote explore prompts to ${outDir}`);
