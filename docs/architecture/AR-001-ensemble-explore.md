# AR-001-ensemble-explore: How `explore` selects, dedups, and assembles graph nodes

This is the mechanism for §FS-001-ensemble-explore. It splits the `explore` tool into a
graph-only **selection** phase (an explore agent) and a deterministic **assembly** phase (the
tool), with a typed `NodeRef` boundary between them. Implementation lives in
`packages/coding-agent/src/core/tools/explore.ts`.

## 1. Two phases, one boundary

```
caller → explore tool
   │
   ├─ Phase 1  explore agent (LLM, graph-only)  ──►  { summary, nodes: NodeRef[] }   §FS-001-ensemble-explore.2
   │
   └─ Phase 2  algorithm (deterministic)
        ├─ fingerprint each node's current source      §FS-001-ensemble-explore.3
        ├─ classify against the registry               §FS-001-ensemble-explore.4
        ├─ fetch content for new/modified nodes only
        └─ compose the single caller message           §FS-001-ensemble-explore.5
```

The boundary is a typed value, not prose: the explore agent can only hand back `NodeRef`s, so it
cannot leak file bodies or presentation decisions into the caller's context.

## 2. The `NodeRef` contract

The explore agent's terminal tool, `select_nodes`, takes the result for §FS-001-ensemble-explore.2.2:

```ts
interface NodeRef {
  path: string;              // repo-relative posix path
  symbol?: string;           // e.g. "GraphifyBackend.query"
  span?: [number, number];   // start/end lines for a sub-file node
  kind?: string;             // function | class | file | ...
  reason: string;            // one line: why this node matters to the task
}
interface SelectNodesResult { summary: string; nodes: NodeRef[]; }
```

Identity (§FS-001-ensemble-explore.3.1) is computed by the tool, not supplied by the explore agent:

```
id = sha1(path + "#" + (symbol ?? span?.join("-") ?? "file"))
```

Structural identity is independent of content, so it survives edits and graph rebuilds, and
is well-defined under the filesystem fallback where no backend node IDs exist.

## 3. Phase 1 — graph-only explore agent

### 3.1 Structured terminal return

Replaces the free-form-text return of the current explore agent (the `runSidekick`
last-assistant-text scrape in `explore.ts`) with the structured `select_nodes` terminal tool.
The tool reads the call argument, not the prose.

### 3.2 Backend-conditional toolset

The explore agent's toolset is **backend-conditional** (§FS-001-ensemble-explore.2.1):

- **Graph backend present** — tools are `search`, `node_at`, `source_slice`, `graph_query`,
  `graph_explain`, `graph_neighbors`, `graph_stats`; `graph_fetch_node` is removed unless the
  caller explicitly requests whole files. The explore agent stays in graph space and relays
  node-granular results unchanged — **no post-processing** (§FS-001-ensemble-explore.5.6).
  For C/C++ and similar C-family repositories, the prompt treats local parser, option, indexing,
  and flag-handling bugs as lexical-first investigations: use `search` like `rg`, then
  `source_slice` like `sed -n`, and only then spend graph queries when relationships remain
  unclear (§FS-001-ensemble-explore.2.1).
  `source_slice` is a bounded confirmation aid, not a file-reading primitive: each call returns a
  small line interval, and the tool rejects repeated or overlapping intervals in the same explore
  run so unchanged evidence is not paid for twice (§FS-001-ensemble-explore.2.1).
  Backend graph storage is addressed through the graph backend, not as repository files; callers
  may configure an absolute graph file outside the worktree so artifacts remain invisible to
  filesystem search, patch capture, graph tool output, and agent-visible shell environments
  (§FS-001-ensemble-explore.2.1). The implementation rejects configured graph files that resolve
  inside the worktree because normal filesystem tools could discover them. Benchmark strict runs
  keep external storage current with a graph backend watcher during the agent run, so graph
  queries reflect source edits without exposing graph artifacts in the worktree
  (§FS-001-ensemble-explore.2.1).
- **Graph backend absent** — the explore agent gets filesystem search + read tools, because it must
  see raw code to trim it. It post-processes the results down to the relevant code.

### 3.3 Mode-selected system prompt

System prompt is selected per mode. In graph mode it directs the explore agent to navigate the
graph, identify relevant nodes, and relay them verbatim. In fallback mode it directs the
explore agent to keep only task-relevant declarations and drop the rest, **coarse-grained only**:
whole fields/functions/methods/comments may be removed, but a retained function body is kept
verbatim — never edited or partially elided (§FS-001-ensemble-explore.5.6).

The lead-agent prompt directs the caller to bundle the first exploration pass for implementation
tasks: ask once for edit site, relevant control flow, verification targets, and alternatives, then
use follow-up `explore` only for a named missing fact. The sidekick prompt mirrors this by treating
multi-part first-pass tasks as one investigation and returning the smallest evidence that lets the
caller decide (§FS-001-ensemble-explore.2.1.1). The prompt makes that compactness explicit: default
first-pass output is capped to a small set of snippets/facts, broad "read" wording is interpreted as
semantic investigation rather than file relay, and high caller-context pressure tightens rather than
loosens the evidence budget.

## 4. Phase 2 — registry and classification

4.1 Registry type (tool-owned, per session/branch — §FS-001-ensemble-explore.6.1):

```ts
interface DeliveredNode {
  id: string;
  path: string;
  span?: [number, number];
  contentHash: string;       // sha1 of the exact bytes delivered  §FS-001-ensemble-explore.3.2
  deliveredAtEntry: string;  // session entry id, for reconciliation §FS-001-ensemble-explore.6.2
}
type KnownNodes = Map<string /* id */, DeliveredNode>;
```

The map is held on the `createExploreToolDefinition` closure, keyed by
`sessionManager.getSessionId()` and branch, and reconstructed from session entries on resume.

4.2 Per-node decision (drives §FS-001-ensemble-explore.4): read current source for the node's
`span` (or whole file), hash it, then —

| Registry state for `id`        | Classification | Action                                   |
|--------------------------------|----------------|------------------------------------------|
| absent                         | new (§..4.1)   | fetch, include, record                   |
| present, hash equal            | unchanged (§..4.2) | omit content, emit pointer           |
| present, hash differs          | modified (§..4.3)  | fetch, include as "updated", refresh |
| present, span overlaps/differs | span change (§..4.4) | treat as modified                  |

4.3 Reconciliation (§FS-001-ensemble-explore.6.2): before classifying, drop any
`DeliveredNode` whose `deliveredAtEntry` is absent from the current branch
(`sessionManager.getEntries()` / `getBranch()`), so post-compaction content is re-sent.

## 5. Phase 2 — message assembly

The tool emits one tool result for §FS-001-ensemble-explore.5. The trimmed, node-granular
shape is produced **upstream** — by the graph backend when present, or by the explore agent when
absent (§3.2) — never by a deterministic trimming algorithm in the tool
(§FS-001-ensemble-explore.5.6). The assembly phase composes and labels what it receives.
Members sharing an enclosing node are grouped under one envelope; selected members are shown
verbatim with a single start anchor; per-line numbers are off by default; framing is plain
header lines, not tags (§FS-001-ensemble-explore.5.2). For the worked example — fields
`cwd`/`availableCache`, the doc comment, and `query` selected from `GraphifyBackend`:

```
src/core/tools/explore.ts · class GraphifyBackend · L318
  cwd: string
  availableCache: boolean | undefined
  ⟨elision⟩
  /** Query the code knowledge graph for relevant nodes and relationships. */
  query(question, signal?): Promise<string | undefined> {                    L352
    if (!(await this.prepare(signal))) return undefined;
    …
    return result.stdout.trim();
  }
```

### 5.1 The elision line is a tunable knob

`⟨elision⟩` above is rendered per §FS-001-ensemble-explore.5.5 by an `elisionDetail` setting:

| `elisionDetail` | renders                                            | cost |
|-----------------|----------------------------------------------------|------|
| `none` (default)| omitted entirely, or a bare `…`                    | zero; no roster lookup |
| `count`         | `… 4 members omitted`                              | needs sibling **count** only |
| `named`         | `… constructor, +2 fields omitted · explain(), stats() in context` | needs full sibling roster + registry cross-ref |

`named` (and to a lesser degree `count`) require enumerating the enclosing node's members,
which the selected `NodeRef`s do not carry — the assembly phase would need an extra
`graph_neighbors`/parse call on the parent. Therefore the default path computes no roster and
the knob is opt-in. The recall-preserving pointer set for *selected-but-unchanged* nodes
(§FS-001-ensemble-explore.5.3) is independent of this knob and always cheap, since those nodes
were already named by the explore agent.

## 6. Fallbacks

6.1 Filesystem fallback (§FS-001-ensemble-explore.7.1) supplies `NodeRef`s from the existing
ranked-snippet search when the graph backend is unavailable; Phase 2 is unchanged.

6.2 Explore agent error/abort (§FS-001-ensemble-explore.7.2) falls back to a direct
backend/filesystem query for the task, as the current tool already does.

6.3 The whole-file request path (§FS-001-ensemble-explore.7.3) skips Phase 1 but still records
deliveries so later selections of those files dedup.

## 7. Build order

1. `NodeRef` schema + `select_nodes`; convert explore agent to graph-only + structured return (§3).
2. Registry, fingerprinting, four-way classification, message assembly (§4, §5).
3. Branch/compaction reconciliation against `sessionManager` (§4.3).
4. Tests: new, unchanged-omit, modified-resend, span-grow, post-compaction-resend.
