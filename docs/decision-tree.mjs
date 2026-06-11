// Build a decision dependency tree from the grund citations in the decision docs.
// Each doc's "**Status:** … Grounded per §A; <verb> §B; relates to §C" line encodes edges:
// the doc is DOWNSTREAM of every id it cites. We classify the edge by the verb before each §ref
// and render (1) a Mermaid graph (renders on GitHub) and (2) a nested text outline.
// Usage: node docs/decision-tree.mjs > docs/decision-tree.md
import { readFileSync, readdirSync, existsSync } from "node:fs";

const ROOT = new URL("..", import.meta.url).pathname;
const DEC_DIRS = ["docs/decisions/functional", "docs/decisions/architectural"];

// relationship verb -> edge kind (order matters: first match wins)
const RELS = [
  [/revis|supersed/i, "revises"],
  [/subsum|salvag|fold/i, "subsumes"],
  [/target|address|measured in|closes|attacks/i, "targets"],
  [/relate/i, "relates"],
  [/grounded per|^per |, per /i, "grounds"],
];
const relOf = (ctx) => (RELS.find(([re]) => re.test(ctx)) ?? [, "relates"])[1];

const statusIcon = (s) => /reject|fail|shelv/i.test(s) ? "❌"
  : /work|pass|adopt/i.test(s) ? "✅"
  : /mixed/i.test(s) ? "🟡" : "⬜"; // proposed/running/queued/held

const nodes = new Map(); // id -> {id, title, status, kind}
const edges = [];        // {from, to, rel}  (from is downstream of to)

const shortTitle = (raw) => raw.replace(/^[A-Z]+-\d+[a-z-]*:\s*/, "").replace(/`/g, "").trim();
const kindOf = (id) => id.split("-")[0]; // DF/DA/REQ/GOAL/FS/AR/RM/E2E

for (const dir of DEC_DIRS) {
  const abs = `${ROOT}/${dir}`;
  if (!existsSync(abs)) continue;
  for (const f of readdirSync(abs).filter((x) => x.endsWith(".md"))) {
    const text = readFileSync(`${abs}/${f}`, "utf8");
    const id = f.replace(/\.md$/, "");
    const titleLine = (text.match(/^#\s+(.+)$/m)?.[1]) ?? id;
    // grounding block: the **Status:** line through the next blank line
    const block = (text.match(/\*\*Status:[\s\S]*?\n\n/)?.[0]) ?? "";
    const status = (block.match(/\*\*Status:\s*([^.*]+)/)?.[1] ?? "").trim();
    nodes.set(id, { id, title: shortTitle(titleLine), status, kind: kindOf(id) });
    // edges: every §ref in the grounding block, classified by the ~40 chars before it
    const refRe = /§([A-Z]+-\d+[a-z-]*)/g;
    let m;
    while ((m = refRe.exec(block))) {
      const to = m[1].replace(/-decision-log$/, "-decision-log"); // keep full slug
      const ctx = block.slice(Math.max(0, m.index - 40), m.index);
      const rel = relOf(ctx);
      if (to !== id) edges.push({ from: id, to, rel });
    }
  }
}

// canonicalize ids to the longest slug seen per PREFIX-NNN[suffix] base (some refs use short forms).
// Keep a trailing lowercase suffix (DF-020a vs DF-020b) so split sub-decisions stay distinct.
const baseOf = (id) => (id.match(/^([A-Z]+-\d+[a-z]?)/) ?? [id])[1];
const canon = new Map();
const consider = (id) => { const b = baseOf(id); if (!canon.has(b) || id.length > canon.get(b).length) canon.set(b, id); };
for (const id of nodes.keys()) consider(id);
for (const e of edges) { consider(e.from); consider(e.to); }
const C = (id) => canon.get(baseOf(id)) ?? id;
const remapped = new Map();
for (const [id, n] of nodes) { const c = C(id); if (!remapped.has(c)) remapped.set(c, { ...n, id: c }); }
nodes.clear(); for (const [k, v] of remapped) nodes.set(k, v);
for (const e of edges) { e.from = C(e.from); e.to = C(e.to); }

// ensure cited-but-undocumented ids (REQ/GOAL/FS/AR/RM) exist as labeled leaves
for (const e of edges) {
  if (!nodes.has(e.to)) nodes.set(e.to, { id: e.to, title: e.to.replace(/^[A-Z]+-\d+-?/, "").replace(/-/g, " "), status: "", kind: kindOf(e.to) });
}

// dedupe edges (keep strongest rel per pair: revises>subsumes>targets>relates>grounds)
const RANK = { revises: 5, subsumes: 4, targets: 3, relates: 2, grounds: 1 };
const best = new Map();
for (const e of edges) {
  const k = `${e.from}->${e.to}`;
  if (!best.has(k) || RANK[e.rel] > RANK[best.get(k).rel]) best.set(k, e);
}
const E = [...best.values()];

// ---------- Mermaid ----------
const groups = {
  GOAL: "Goal", REQ: "Requirements & methodology", FS: "Specs", AR: "Specs",
  DA: "Architectural decisions", DF: "Functional decisions", RM: "Roadmap", E2E: "E2E",
};
const order = ["Goal", "Requirements & methodology", "Specs", "Architectural decisions", "Functional decisions", "Roadmap", "E2E"];
const byGroup = new Map(order.map((g) => [g, []]));
for (const n of nodes.values()) byGroup.get(groups[n.kind] ?? "Functional decisions").push(n);

const nid = (id) => id.replace(/[^A-Za-z0-9]/g, "_");
// Mermaid labels are wrapped in "..."; strip chars that break the parser.
const wrap = (s, n = 34) => { const t = s.replace(/"/g, "'").replace(/[[\]{}<>|]/g, " ").trim(); return t.length > n ? t.slice(0, n - 1) + "…" : t; };
let mer = "```mermaid\nflowchart TD\n";
for (const g of order) {
  const ns = (byGroup.get(g) ?? []).sort((a, b) => a.id.localeCompare(b.id));
  if (!ns.length) continue;
  mer += `  subgraph ${nid(g)}["${g}"]\n`;
  for (const n of ns) {
    const ic = n.status ? statusIcon(n.status) + " " : "";
    mer += `    ${nid(n.id)}["${ic}${n.id.replace(/^([A-Z]+-\d+[a-z]?).*/, "$1")}<br/><small>${wrap(n.title)}</small>"]\n`;
  }
  mer += "  end\n";
}
const STYLE = { revises: "-- revises -->", subsumes: "-- subsumes -->", targets: "-- targets -->", relates: "-. relates .->", grounds: "==>" };
for (const e of E) {
  if (e.rel === "grounds" && e.to.endsWith("decision-log")) continue; // drop boilerplate REQ-001 trunk
  mer += `  ${nid(e.from)} ${STYLE[e.rel]} ${nid(e.to)}\n`;
}
mer += "```\n";

// ---------- text outline (downstream-from-roots) ----------
const childrenOf = new Map();
for (const e of E) { if (e.rel === "grounds" && e.to.endsWith("decision-log")) continue; (childrenOf.get(e.to) ?? childrenOf.set(e.to, []).get(e.to)).push(e); }
const hasParent = new Set(E.filter((e) => !(e.rel === "grounds" && e.to.endsWith("decision-log"))).map((e) => e.from));
const roots = [...nodes.values()].filter((n) => !hasParent.has(n.id)).sort((a, b) => a.id.localeCompare(b.id));
let out = "";
const seen = new Set();
const walk = (id, depth) => {
  const n = nodes.get(id); if (!n) return;
  const ic = n.status ? statusIcon(n.status) + " " : "";
  out += `${"  ".repeat(depth)}- ${ic}**${n.id.replace(/^([A-Z]+-\d+[a-z]?).*/, "$1")}** — ${n.title}\n`;
  if (seen.has(id)) return; seen.add(id);
  for (const c of (childrenOf.get(id) ?? []).sort((a, b) => a.from.localeCompare(b.from))) out += `${"  ".repeat(depth + 1)}↳ ${c.from.replace(/^([A-Z]+-\d+[a-z]?).*/, "$1")} _(${c.rel} it)_\n`;
};
for (const r of roots) walk(r.id, 0);

process.stdout.write(`# Decision tree\n\nAuto-generated from the grund citations in \`docs/decisions/**\` (\`node docs/decision-tree.mjs\`).\nEach decision points to what it is **downstream of**. ✅ worked/adopted · ❌ rejected/shelved · 🟡 mixed · ⬜ open.\n\n${mer}\n## Roots (foundational decisions everything hangs off)\n\n${out}\n`);
