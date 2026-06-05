# AR-002-caller-context: How the `caller_context` tool reads the caller's branch

This is the mechanism for §FS-002-caller-context. It is a single reusable module that builds
one `AgentTool` from the caller's `ExtensionContext`; the tool closes over that context and
reads the caller's session on demand. Implementation lives in
`packages/coding-agent/src/core/tools/caller-context.ts`, wired into sub-agent spawners
(`runSidekick` in `explore.ts`, and the ensemble agent).

## 1. Where the seam is

A sub-agent's tools are constructed by its spawner, which already holds the caller's
`ExtensionContext` (in `explore.ts:runSidekick` it is the `context` parameter). That context
exposes the caller's session read-only and its effective system prompt:

```
ExtensionContext.sessionManager: ReadonlySessionManager   // caller's branch  (types.ts:310)
ExtensionContext.getSystemPrompt(): string                // caller prompt    (types.ts:330)
```

A tool built inside the spawner can capture `context` in its closure, so when the *sub-agent*
calls the tool, the handler reads the *caller's* context. No new plumbing into the `Agent`
core is required — the capability rides the existing `ExtensionContext`.

```
caller turn → spawner (holds caller ExtensionContext)
   │
   ├─ builds sub-agent tools, including createCallerContextTool(context)
   │
   └─ sub-agent runs ──► calls caller_context ──► reads context.sessionManager / getSystemPrompt()
```

## 2. The tool: one factory, one `op`-discriminated surface

```ts
export function createCallerContextTool(context: ExtensionContext): AgentTool<typeof schema>;
```

A single tool keeps the sub-agent's tool list short (§FS-002-caller-context.4). Parameters
(TypeBox, matching the `AgentTool` convention used by `makeTextTool` in `explore.ts`):

```ts
const schema = Type.Object({
  op: Type.Union([
    Type.Literal("index"),          // §FS-002-caller-context.4.1 — list entries, no bodies
    Type.Literal("fetch"),          // §FS-002-caller-context.4.2 — full text of selected entries
    Type.Literal("system_prompt"),  // §FS-002-caller-context.3.3 / 4.3
    Type.Literal("user_request"),   // §FS-002-caller-context.3.4 / 4.3
  ]),
  ids:     Type.Optional(Type.Array(Type.String())),  // fetch selector — entry ids from index
  recency: Type.Optional(Type.Number()),              // fetch selector — most recent N
  query:   Type.Optional(Type.String()),              // fetch selector — keyword filter
  kinds:   Type.Optional(Type.Array(Type.String())),  // §FS-002-caller-context.5 — "transcript" | "tool_result" | "summary" | "all"
});
```

The tool returns text content (`{ content: [{ type: "text", text }], isError: false }`), the
same shape `makeTextTool` produces, so it drops into a sub-agent's `tools` array unchanged.

## 3. Reading the caller branch

### 3.1 Source

The handler walks `context.sessionManager.getBranch()` → `SessionEntry[]`, root-to-leaf
(`session-manager.ts:1150`). `getBranch` is part of `ReadonlySessionManager`
(`session-manager.ts:186`), satisfying read-only access (§FS-002-caller-context.2.2). Each
`SessionMessageEntry` carries `{ id, message: AgentMessage }` (`session-manager.ts:53`); the
entry `id` is the stable handle used by the index and `fetch ids` (§FS-002-caller-context.4).

### 3.2 Entry → kind

Each entry is mapped to a `caller_context` kind (§FS-002-caller-context.3) by message role:

| `entry.message.role`                 | kind          |
|--------------------------------------|---------------|
| `user`, `assistant`                  | `transcript`  |
| `toolResult`, `bashExecution`        | `tool_result` |
| `compactionSummary`, `branchSummary` | `summary`     |
| (other, e.g. `custom`)               | `transcript`  |

Non-message entries (`model_change`, `thinking_level_change`, labels) are skipped — they carry
no context the sub-agent needs.

### 3.3 Entry → text

Text is extracted per role: text content blocks for `user`/`assistant`/`toolResult`;
`bashExecutionToText()` (`messages.ts:82`) for bash; the `summary` field for the summary kinds.
The existing private `extractTextContent(message)` (`session-manager.ts:564`) is the right
helper — lift it to an exported utility (or re-implement the same 6-line filter) rather than
duplicating it, and reuse the `COMPACTION_SUMMARY_*` / `BRANCH_SUMMARY_*` framing from
`messages.ts` when rendering summaries.

## 4. `op:"index"` — see (§FS-002-caller-context.4.1)

Map the branch (§3) to one line per entry, bodies omitted (§FS-002-caller-context.6.3):

```
[<id>] <kind> · ~<tokens>t · "<first ~80 chars, single line>"
```

`~tokens` is a cheap estimate (`ceil(chars / 4)`) so the sub-agent can budget its fetches.
Apply the `kinds` filter (§FS-002-caller-context.5) before rendering. The index itself is
capped (§6) but, being preview-only, effectively never truncates.

## 5. `op:"fetch"` — take (§FS-002-caller-context.4.2)

1. Filter the branch (§3) by `kinds` (§FS-002-caller-context.5).
2. Select entries matching **any** supplied selector — `ids`, `recency` (last N), `query`
   (case-insensitive substring over entry text).
3. If **no** selector was supplied, take the last `DEFAULT_RECENCY` entries
   (§FS-002-caller-context.6.2), not the whole branch.
4. Render each selected entry as `=== [<id>] <kind> ===\n<full text>` in branch order, then
   apply the byte cap (§6).

## 6. Bounds (§FS-002-caller-context.6)

A single `MAX_CALLER_CONTEXT_BYTES` cap (reuse `explore.ts`'s `MAX_TOOL_OUTPUT_BYTES` = 64 KB
for symmetry). After assembling output, truncate to the cap and append
`\n[Truncated: N of M bytes shown. Narrow with ids/query/recency.]` — never silent
(§FS-002-caller-context.6.1). `DEFAULT_RECENCY` (e.g. 10) bounds the unparameterised fetch
(§FS-002-caller-context.6.2). Truncation can reuse the `truncateHead` helper from
`tools/truncate.ts`.

## 7. `system_prompt` and `user_request` (§FS-002-caller-context.4.3)

- `op:"system_prompt"` → `context.getSystemPrompt()`, byte-capped per §6.
- `op:"user_request"` → join the text of branch entries whose role is `user` (the §3
  `transcript`-kind, user-authored subset), byte-capped per §6.

Both are direct: no index step.

## 8. Degradation (§FS-002-caller-context.10.2)

If `context.sessionManager` is unavailable or `getBranch()` is empty, every op returns the
text `No caller context available.` with `isError: false`, so the sub-agent run is not
aborted.

## 9. Wiring into sub-agents (§FS-002-caller-context.8, §9)

Each spawner appends the tool and announces it in one system-prompt line — no content pushed:

```ts
// explore.ts runSidekick(), alongside the graph_* tools (explore.ts:434)
const tools: AgentTool[] = [ /* graph_query, graph_explain, graph_stats … */,
  createCallerContextTool(context),
];
// systemPrompt += "\nYou may call caller_context to read the calling agent's transcript, " +
//   "its prior tool results and files, its system prompt, or the user's original request. " +
//   "Use op:\"index\" to survey, then op:\"fetch\" by ids/recency/query. Take only what you need.";
```

The ensemble agent attaches it identically from its own `ExtensionContext`. Because the
factory's only input is `ExtensionContext`, no consumer-specific code is required
(§FS-002-caller-context.9).

For the `explore` sidekick this is additive to §AR-001-ensemble-explore.3.2: the sidekick's
graph-only toolset gains `caller_context`, which exposes the *caller's* gathered context, not
raw repo bodies (§FS-002-caller-context.9.1) — the §FS-001-ensemble-explore.2.1 bar on the
sidekick reading file bodies is unchanged.

## 10. Build order

1. `caller-context.ts`: schema, `createCallerContextTool`, branch read + kind/text mapping
   (§2–§3); lift `extractTextContent` to a shared export.
2. `index` and `fetch` ops with selectors and the byte cap (§4–§6).
3. `system_prompt` / `user_request` ops and empty-branch degradation (§7–§8).
4. Wire into `runSidekick` and the ensemble agent with the announce-only seed (§9).
5. Tests: index lists each kind; fetch by ids / recency / query; unparameterised fetch is
   bounded; over-cap output reports truncation; compacted branch surfaces `summary` entries;
   empty/absent session manager degrades to the no-context result.
