// Dump each sidekick CALL paired with its RESULT for a graph-bash run, to see what the sidekick
// returned (and where it misled the lead). Pairs by toolCallId. Supports the explore sidekick
// (lead task -> graph/search evidence) and the bash sidekick (command -> digest/output the lead got).
// §DF-007/DF-010 (explore) and §DF-001 (bash) failure inspection.
// Usage: node explore-pairs.mjs <instance-id> [--sidekick explore|bash] [--arm A] [--full] [--max N] [--session FILE]
import { readFileSync, existsSync, readdirSync } from "node:fs";

const argv = process.argv.slice(2);
const opt = { arm: "classic-graph-bash", max: 4000, full: false, sidekick: "explore" };
let id = null;
for (let i = 0; i < argv.length; i++) {
  const x = argv[i];
  if (x === "--arm") opt.arm = argv[++i];
  else if (x === "--sidekick" || x === "--tool") opt.sidekick = argv[++i];
  else if (x === "--max") opt.max = Number(argv[++i]);
  else if (x === "--full") opt.full = true;
  else if (x === "--session") opt.session = argv[++i];
  else id = x;
}
const TOOL = opt.sidekick === "bash" ? "bash" : "explore";
if (!id && !opt.session) { console.error("usage: explore-pairs.mjs <instance-id> [--sidekick explore|bash] [--arm A] [--full] [--max N] [--session FILE]"); process.exit(1); }

let sf = opt.session;
if (!sf) {
  const dir = `raw/${id}__${opt.arm}/session`;
  if (!existsSync(dir)) { console.error(`no session dir: ${dir}`); process.exit(1); }
  const f = readdirSync(dir).filter((x) => x.endsWith(".jsonl")).sort().pop();
  if (!f) { console.error(`no .jsonl in ${dir}`); process.exit(1); }
  sf = `${dir}/${f}`;
}

const lines = readFileSync(sf, "utf8").split("\n").filter(Boolean);
const calls = new Map();   // id -> {seq, args}
const results = new Map(); // id -> {text, isError, backend}
let seq = 0;
for (const l of lines) {
  let e; try { e = JSON.parse(l); } catch { continue; }
  const m = e.message || e;
  if (m.role === "assistant" && Array.isArray(m.content)) {
    for (const c of m.content) if (c.type === "toolCall" && c.name === TOOL) calls.set(c.id, { seq: ++seq, args: c.arguments || {} });
  }
  if (m.role === "toolResult" && m.toolName === TOOL) {
    const text = (m.content || []).map((c) => c.text || "").join("\n");
    results.set(m.toolCallId, { text, isError: m.isError, backend: m.details?.backend });
  }
}

// Per-sidekick rendering of the CALL line.
function renderCall(args) {
  if (TOOL === "bash") {
    const out = [`  $ ${(args.command || "(none)").replace(/\n/g, "\n    ")}`];
    if (args.timeout) out.push(`  timeout: ${args.timeout}s`);
    return out.join("\n");
  }
  const out = [`  task: ${args.task || "(none)"}`];
  if (args.paths?.length) out.push(`  paths: ${args.paths.join(", ")}`);
  if (args.wholeFiles) out.push(`  wholeFiles: true`);
  return out.join("\n");
}

const clip = (t) => (opt.full || t.length <= opt.max ? t : t.slice(0, opt.max) + `\n… [+${t.length - opt.max} more chars; --full for all]`);
console.log(`# ${TOOL} sidekick pairs — ${id || sf}  arm=${opt.arm}`);
console.log(`# session: ${sf}`);
console.log(`# ${calls.size} ${TOOL} call(s)\n`);
const ordered = [...calls.entries()].sort((a, b) => a[1].seq - b[1].seq);
for (const [cid, { seq, args }] of ordered) {
  const r = results.get(cid);
  const rtext = r ? r.text : "(no result — call is mid-write/aborted; re-run after the job finishes)";
  console.log("═".repeat(90));
  console.log(`${TOOL.toUpperCase()} #${seq}`);
  console.log(renderCall(args));
  // isError = the command failed; whether the result was digested vs raw depends on size (broad
  // failures are digested, small ones returned raw) and isn't marked in the session — read the text.
  const flag = r?.isError ? (TOOL === "bash" ? ", FAILED" : ", ERROR") : "";
  console.log(`  → RESULT (${rtext.length} chars, ${rtext.split("\n").length} lines${r?.backend ? ", backend=" + r.backend : ""}${flag}):`);
  console.log(clip(rtext).split("\n").map((x) => "    " + x).join("\n"));
  console.log("");
}
