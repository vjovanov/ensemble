# FS-002-caller-context: Sub-agents read the caller's context on demand

A sub-agent that pi spawns (the explore agent of §FS-001-ensemble-explore, and any future
sub-agent) starts with an empty conversation: none of the calling
agent's history flows down. This spec defines a **reusable capability** — exposed to the
sub-agent as a single tool, `caller_context` — through which the sub-agent may **see and take
parts of the caller's context on demand**: the conversation transcript, the caller's prior
tool results and the files it read, the caller's system prompt, and the user's original
request.

Access is **pull-only**: the sub-agent decides what it needs and fetches exactly that. The
spawn pushes no content; it only announces that the capability exists (§8). This keeps the
sub-agent's context cheap by default and bounds the token cost of cross-agent context to what
the sub-agent actually asks for.

The mechanism that implements this contract is specified in §AR-002-caller-context.

## 1. Vocabulary

- **Caller** (also *parent*): the agent whose turn spawned the sub-agent. For the `explore`
  explore agent this is the main pi agent (cf. §FS-001-ensemble-explore.1).
- **Sub-agent**: any agent pi spawns within a tool call — the explore agent, the ensemble
  agent, or a future one. The capability is identical for all of them (§9).
- **Caller branch**: the caller's conversation as the path from the current leaf to the root
  (user and assistant messages, tool results, bash executions, model/thinking changes, and
  compaction/branch summaries). This is the material the capability exposes.
- **Entry**: one addressable item of the caller branch, with a stable id, a *kind* (§3), and a
  text rendering. The unit of both listing (§4.1) and fetching (§4.2).
- **The tool**: `caller_context`, the single tool surface exposed to the sub-agent (§AR-002-caller-context.2).

## 2. On-demand, pull-only access

### 2.1 The sub-agent initiates every access

The caller never pushes conversation content into the sub-agent. Every byte of caller context
the sub-agent obtains is the result of a `caller_context` call the sub-agent itself made. A
sub-agent that never calls the tool sees nothing of the caller's context, exactly as today.

### 2.2 Read-only

The tool only reads. It MUST NOT mutate the caller's session, append entries, change the
leaf, or otherwise affect the caller's turn. The caller's `sessionManager` is accessed through
its read-only surface (§AR-002-caller-context.3).

### 2.3 Live, not snapshotted

The tool reads the caller branch as it stands at call time. Within a single sub-agent run the
caller is paused on the spawning tool call, so the branch is stable; the contract does not
promise a frozen snapshot taken at spawn.

## 3. What is exposed

The capability exposes four categories of caller context, each reachable on demand:

### 3.1 Conversation transcript

The user and assistant messages of the caller branch — the dialogue. Each is an entry (§1)
with kind `transcript`.

### 3.2 Tool results and files the caller read

The outputs of the caller's prior tool calls — file contents it read, command output, and
prior `explore` / `caller_context` results — as entries with kind `tool_result`. This lets
the sub-agent reuse work the caller already did instead of re-deriving it.

### 3.3 Caller system prompt

The caller's effective system prompt, retrievable in full. This is its own access path
(§4.3), not part of the transcript listing.

### 3.4 The user's original request

The user-authored messages of the branch, retrievable on their own so the sub-agent can read
the human's intent without the assistant's reasoning or tool noise. This is a convenience
projection over the `transcript` entries whose author is the user.

## 4. Access shape: see, then take

### 4.1 Index — see what exists

The sub-agent first asks for an **index** of the caller branch: one line per entry giving its
id, kind (§3), an approximate size, and a short preview. The index is deliberately cheap — it
carries no full bodies — so the sub-agent can survey a large caller context within a small
token budget and then choose precisely what to take.

### 4.2 Fetch — take specific entries in full

The sub-agent then **fetches** the full text of chosen entries, selected by:

- **ids** — entry ids drawn from the index (§4.1);
- **recency** — the most recent N entries; and/or
- **query** — a case-insensitive keyword filter over entry text.

When more than one selector is given, an entry is fetched when it satisfies any of them. When
**no** selector is given, fetch returns a small, bounded recency window (§6.2) rather than the
whole branch, so an unparameterised call cannot dump the entire caller context.

### 4.3 System prompt and user request are direct

Fetching the caller system prompt (§3.3) and the user's original request (§3.4) does not
require an index step; each is a direct access path on the tool (§AR-002-caller-context.2).

## 5. Filtering by kind

Both index (§4.1) and fetch (§4.2) accept an optional kind filter (§3) — e.g. transcript
only, tool results only, or all. The default is all kinds. Summaries (§7) are their own kind
and are included by default.

## 6. Bounds

### 6.1 Every access is capped

Each tool result is capped at a fixed byte budget. When the selected material exceeds the
cap, the tool returns as much as fits and states plainly that it was truncated and by how
much — output is never silently cut. The sub-agent can then narrow its selection (§4.2) and
fetch the remainder.

### 6.2 Unparameterised fetch is small

An `op:"fetch"` with no `ids`, `recency`, or `query` returns a small default recency window
(§4.2), not the whole branch.

### 6.3 The index never carries bodies

The index (§4.1) carries only id, kind, size, and a short preview per entry, so listing a
large branch stays cheap regardless of branch size.

## 7. Compaction and summaries

The caller branch may contain compaction or branch summaries in place of older raw turns —
the original turns may no longer exist. The tool surfaces such summaries as entries of their
own kind so the sub-agent can see that earlier history was summarised, read the summary, and
not mistake a compacted branch for a short one. The tool never fabricates entries for turns
that compaction removed.

## 8. The spawn announces, it does not push

Consistent with §2.1, spawning a sub-agent with this capability pushes **no** caller content.
The only seeding is a single line added to the sub-agent's system prompt stating that the
`caller_context` tool exists and how to use it (index, then fetch; system prompt and user
request directly). The sub-agent reads nothing of the caller until it chooses to call the
tool. (This is the "hybrid" arrangement: capability announced at spawn, content pulled on
demand.)

## 9. Reusable across sub-agents

The capability is a single reusable unit, not bound to `explore`. It is created from the
caller's context and attached to a sub-agent's toolset; the explore agent
(§FS-001-ensemble-explore) attaches it, and any future sub-agent does the same. Its
observable contract (§2–§8) does not vary by consumer.

### 9.1 Composes with graph-only selection

For the explore agent, this capability is additive and does not weaken
§FS-001-ensemble-explore.2.1: `caller_context` exposes the *caller's* already-gathered context,
not raw repository file bodies the explore agent is otherwise barred from reading. The explore agent
still selects code through the graph; it may now also consult what the caller already knows.

## 10. Trust and failure

### 10.1 Same trust domain

The sub-agent runs on the user's behalf within the caller's session, so it is trusted with the
caller's context; the tool performs no redaction beyond the bounds of §6. (A redaction knob is
a possible future extension, not part of this contract — §11.3.)

### 10.2 Degrades to empty, never errors the run

When the caller exposes no readable context — no session manager available, or an empty branch
— the tool returns an explicit "no caller context available" result rather than failing, so a
sub-agent that calls it on a fresh caller is not aborted.

## 11. Non-goals

### 11.1 No write-back to the caller

The sub-agent cannot, through this capability, send messages to the caller, edit its session,
or call the caller's tools. The sub-agent's product still reaches the caller only through its
normal return path (for the explore agent, the selected nodes of §FS-001-ensemble-explore).

### 11.2 No cross-session access

The tool reads only the current caller's branch. Reading other sessions' contexts is out of
scope (cf. §FS-001-ensemble-explore.8.3).

### 11.3 No redaction in v1

Secret-scrubbing or policy-based filtering of caller context is out of scope for this version
(§10.1); v1 exposes the caller's context as-is within the byte bounds of §6.
