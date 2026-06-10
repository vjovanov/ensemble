// Splice freshly-generated tables into README.md between AUTO markers, so the README tracks results
// as they come in. Each block name maps to a generator whose stdout replaces the marker body.
//   <!-- AUTO:<name> --> ... <!-- /AUTO:<name> -->
import { readFileSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";

const BLOCKS = {
  "cost-tables": "node lib/plot-results.mjs --table",
  "breakdown-tables": "node lib/token-breakdown.mjs --table",
};
let md = readFileSync("README.md", "utf8");
for (const [name, cmd] of Object.entries(BLOCKS)) {
  const body = execSync(cmd, { encoding: "utf8" }).trim();
  // greedy to the LAST closer so a previously-corrupted block is collapsed and re-filled cleanly;
  // function replacement so `$` in the table body is treated literally (not as a backreference).
  const re = new RegExp(`<!-- AUTO:${name} -->[\\s\\S]*<!-- /AUTO:${name} -->`);
  if (!re.test(md)) { console.error(`marker not found: AUTO:${name}`); process.exit(1); }
  md = md.replace(re, () => `<!-- AUTO:${name} -->\n${body}\n<!-- /AUTO:${name} -->`);
}
writeFileSync("README.md", md);
console.log("README tables injected:", Object.keys(BLOCKS).join(", "));
