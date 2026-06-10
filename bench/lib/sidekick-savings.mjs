// Estimate per-instance ideal savings of the 3 sidekicks, from the CLASSIC session.
// Model: a tool result of T tokens produced at assistant-turn k (of N) costs T input (first appearance)
// + T*(N-k) cacheRead (replayed every later turn). Attribute by category; map to sidekick targets.
// §REQ-001. Prices: input $5/Mtok, cacheRead $0.5/Mtok.
import { readFileSync, existsSync, readdirSync } from "node:fs";
const P_IN = 5 / 1e6, P_CR = 0.5 / 1e6;
const RO = /^\s*(rg|grep|sed|cat|head|tail|ls|find|awk|nl|wc|fd|tree|cut|sort|uniq|diff|stat|xargs)\b/;
const BT = /\b(cargo|make|gmake|cmake|ctest|ninja|meson|bazel|autoreconf|libtoolize|\.?\/?configure|\.?\/?gradlew|gradle|mvn|go\s+(test|build|vet)|(npm|pnpm|yarn)\s+(test|run|ci|install|build)|pytest|tox|dotnet\s+(build|test))\b/;
const tok = (s) => Math.round(s / 4);

function analyze(id) {
  const dir = `raw/${id}__classic/session`;
  if (!existsSync(dir)) return null;
  const f = readdirSync(dir).filter((x) => x.endsWith(".jsonl")).sort().pop();
  if (!f) return null;
  const lines = readFileSync(`${dir}/${f}`, "utf8").split("\n").filter(Boolean);
  // first pass: assistant turn ordinals + total
  let N = 0; const callTurn = new Map(); const callKind = new Map();
  const editedFiles = new Set(); const readFiles = new Set();
  for (const l of lines) { let e; try { e = JSON.parse(l); } catch { continue; } const m = e.message || e;
    if (m.role === "assistant" && m.usage) N++;
    if (m.role === "assistant" && Array.isArray(m.content)) for (const c of m.content) if (c.type === "toolCall") {
      const a = c.arguments || {}; let k = c.name;
      if (c.name === "bash") { const cmd = (a.command || "").trim(); k = RO.test(cmd) ? "explore" : BT.test(cmd) ? "buildtest" : "bashother"; }
      else if (["read", "grep", "find", "ls", "glob"].includes(c.name)) k = "explore";
      else if (["edit", "write"].includes(c.name)) { k = "edit"; if (a.path || a.file) editedFiles.add(a.path || a.file); }
      callTurn.set(c.id, N); callKind.set(c.id, k);
      if (k === "explore" && (a.path || a.file)) readFiles.add(a.path || a.file);
    }
  }
  // second pass: attribute result footprints
  const cat = {}; const add = (k, inTok, crTok) => { (cat[k] ||= { in: 0, cr: 0, n: 0, bytes: 0 }); cat[k].in += inTok; cat[k].cr += crTok; };
  for (const l of lines) { let e; try { e = JSON.parse(l); } catch { continue; } const m = e.message || e;
    if (m.role === "toolResult") {
      const k = callKind.get(m.toolCallId) || "other"; const turn = callTurn.get(m.toolCallId) || 0;
      const t = tok((m.content || []).map((c) => c.text || "").join("").length);
      add(k, t, t * Math.max(0, N - turn)); cat[k].n++; cat[k].bytes += t * 4;
    }
  }
  return { id, N, cat, editedFiles: editedFiles.size, readFiles: readFiles.size };
}

const $ = (inTok, crTok) => inTok * P_IN + crTok * P_CR;
const f$ = (x) => "$" + x.toFixed(2);
const ids = JSON.parse(readFileSync("base001-ids.json", "utf8"));
const rows = ids.map(analyze).filter(Boolean);

console.log("Per-instance ideal sidekick savings (from classic session). in/cr = input/cacheRead tokens; $ = their cost.\n");
console.log("instance".padEnd(20) + "EXPLORE(in/cr $)".padStart(22) + "BUILD/TEST(in/cr $)".padStart(22) + "  edit/explored files");
const agg = { ex: { in: 0, cr: 0 }, bt: { in: 0, cr: 0 }, base$: 0 };
for (const r of rows) {
  const ex = r.cat.explore || { in: 0, cr: 0 }; const bt = r.cat.buildtest || { in: 0, cr: 0 };
  agg.ex.in += ex.in; agg.ex.cr += ex.cr; agg.bt.in += bt.in; agg.bt.cr += bt.cr;
  const k = (n) => n >= 1000 ? (n/1000).toFixed(0)+"k" : n;
  console.log(r.id.split("__")[1].padEnd(20) +
    `${k(ex.in)}/${k(ex.cr)} ${f$($(ex.in,ex.cr))}`.padStart(22) +
    `${k(bt.in)}/${k(bt.cr)} ${f$($(bt.in,bt.cr))}`.padStart(22) +
    `   ${r.editedFiles}/${r.readFiles}`);
}
console.log("\n=== AGGREGATE ideal savings across " + rows.length + " passing benchmarks ===");
console.log("Explore sidekick (offload read-only exploration):  input " + f$(agg.ex.in*P_IN) + " + cached " + f$(agg.ex.cr*P_CR) + "  = " + f$($(agg.ex.in, agg.ex.cr)));
console.log("Bash sidekick (compact build/test output):         input " + f$(agg.bt.in*P_IN) + " + cached " + f$(agg.bt.cr*P_CR) + "  = " + f$($(agg.bt.in, agg.bt.cr)) + "  (compaction keeps a digest -> ~85% of this)");
console.log("Compile-fix loop (remove build/test turns):        >= the build/test figure above + removes iterative re-runs");
