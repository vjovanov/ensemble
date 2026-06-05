# FS-001-ensemble-explore: Ensemble `explore` returns deduplicated graph nodes

Pi's `explore` tool delegates discovery to a private exploration sidekick that works on
the code **graph representation only** and reports the **nodes of interest** for a task.
The `explore` tool itself — not the sidekick — then decides what reaches the caller model:
it suppresses nodes the caller already holds unchanged, re-sends nodes whose source has
changed, and composes a single message that pairs freshly fetched content with pointers to
context the caller already has.

This spec defines the externally observable contract of that behavior. The mechanism that
implements it is specified in §AR-001-ensemble-explore.

## 1. Vocabulary

- **Caller** (also *parent*): the main pi agent whose turn issued the `explore` tool call.
- **Sidekick**: the private sub-agent the tool spawns to navigate the graph. It is invisible
  to the user and to the caller; only its selected nodes (via the tool) reach the caller.
- **Node**: a citable unit of code in the graph — a file, or a symbol within a file (a
  function, method, class, …) addressed by `path` plus an optional line `span`/`symbol`.
- **NodeRef**: the typed description of a node the sidekick returns — identity and location,
  never content. Defined in §AR-001-ensemble-explore.2.
- **Registry**: the tool-owned, per-session record of which nodes have already been delivered
  to the caller and the content fingerprint that was delivered (§3).

## 2. Graph-only selection

### 2.1 Backend-conditional input to the sidekick

When the graph backend is present, the sidekick navigates the graph and does not read raw
file bodies into its own context; its tool surface is graph navigation (query, explain,
neighbors, stats) and it relays the backend's node-granular results unchanged (§5.6). When
the backend is absent, the sidekick instead works from raw filesystem results and is
responsible for trimming them down to the relevant code (§5.6, §7.1).

### 2.2 Structured selection result

The sidekick terminates by emitting a structured result: an ordered list of `NodeRef`
values (most relevant first) plus a one-line natural-language `summary` of what it found.
A run that produces no nodes is valid and yields an empty list.

### 2.3 The sidekick does not present or edit

The sidekick does not format code for the caller, does not propose edits, and does not
address the user. Presentation and content selection are the tool's responsibility (§5),
not the sidekick's.

## 3. Node identity and modification

### 3.1 Stable structural identity

Each node has an identity derived from its location (`path` + `symbol`-or-`span`),
independent of its content. Two `explore` calls that select the same symbol resolve to the
same identity even across edits.

### 3.2 Content fingerprint

Each delivery of a node records a fingerprint (a hash of the exact source bytes delivered).
A node is *modified* relative to a prior delivery when its current fingerprint differs from
the recorded one — whether the change came from the user or from the caller's own edits
between calls.

### 3.3 Backend-independent

Identity and fingerprinting are computed by pi from the node's source, so they do not depend
on the graph backend exposing stable node IDs and they continue to hold under the filesystem
fallback (§7.1).

## 4. Deduplication against caller context

For each `NodeRef` the sidekick selects, the tool classifies it against the registry (§6)
and acts as follows:

### 4.1 New

A node with no prior delivery in the current branch is **included in full**: its current
source content is fetched and placed in the caller message, and it is recorded in the
registry.

### 4.2 Unchanged — omitted

A node previously delivered whose current fingerprint **matches** the recorded one is
**omitted**: its content is not re-sent. Instead the caller message carries a one-line
pointer to it (§5.3). This is the token-saving case and the core of this spec.

### 4.3 Modified — re-sent

A node previously delivered whose current fingerprint **differs** (§3.2) is **re-sent in
full**, labelled as updated, and the registry fingerprint is refreshed.

### 4.4 Span change

When a selected node overlaps a prior delivery but its `span` has grown or shrunk, it is
treated as modified (§4.3) and re-sent. Implementations MAY send only the delta lines, but
MUST NOT silently omit the node.

## 5. Caller message

### 5.1 One deterministic result

The tool returns exactly one tool result to the caller, composed deterministically by the
tool (never formatted by the sidekick). It opens with the sidekick `summary` (§2.2).

### 5.2 Grouped, anchored rendering

Members that share an enclosing node — e.g. several fields and one method of the same class —
are rendered under a single envelope: the enclosing signature is shown once, not repeated per
member. Each selected member appears with its body verbatim and a single location anchor (its
start line); per-line numbering is off by default (an edit-prep mode may enable it). New
content (§4.1) and content updated since the caller last saw it (§4.3) are labelled as such.
Envelope and anchors are plain header lines, not structured tags, to keep framing overhead
minimal. Content is fetched only for selected members (§2.1), never for the whole enclosing
node.

### 5.3 Omitted nodes become pointers

Omitted nodes (§4.2) appear as an **"already in context"** pointer list: one line per node
giving its location and the fact that it is unchanged. Omitted nodes are never dropped
silently — the caller is told the node is relevant and that it already holds the content, so
recall is preserved at zero token cost.

### 5.4 Never empty for the wrong reason

When every selected node is omitted, the message still lists the pointers and the summary,
so an `explore` call never returns empty merely because the caller already has everything.

### 5.5 Sibling elision is tunable

Within an envelope, members that were *not* selected — whether structurally irrelevant or
already held by the caller (§5.3) — may be summarised inline as a placeholder, a count, or a
named roster (e.g. `… constructor, +2 fields omitted · explain(), stats() in context`). The
detail of this annotation is a **tunable knob with the cheapest form as default**, for two
reasons: richer rosters cost tokens on every envelope, and they require enumerating the
enclosing node's *full* member set, which the selected `NodeRef`s do not carry (§AR-001-ensemble-explore.2)
and which may demand an extra graph or parse query. The default rendering MUST NOT depend on
full sibling enumeration; named/counted rosters are produced only when the knob requests them
and the enclosing roster is cheaply available.

### 5.6 Post-processing is backend-conditional and coarse-grained

When the graph backend is present its results are already node-granular, so the tool performs
**no post-processing**: backend nodes are relayed to the caller unchanged. When the backend is
absent, the sidekick post-processes the raw filesystem results to remove code irrelevant to
the task. This trimming is **coarse-grained only** — whole declarations (fields, functions,
methods, comments) may be dropped, but the content inside a *retained* function body is never
partially removed or rewritten; kept bodies appear verbatim. Fine-grained edits inside a body
are prohibited in both modes.

## 6. Registry lifecycle

### 6.1 Tool-owned, per session and branch

The registry is owned by the `explore` tool and scoped to the current session and branch. It
maps node identity (§3.1) to the last delivered fingerprint (§3.2) and the session entry that
delivered it. It is reconstructed from session state on resume.

### 6.2 Reconciled against the live branch

Before classifying (§4), the registry is reconciled against the live branch: a node whose
delivering entry is no longer present in the current branch — e.g. after compaction or a
branch switch — is dropped, so it will be treated as new (§4.1) and re-sent. This prevents
the tool from suppressing content the caller no longer actually holds.

### 6.3 Bias toward re-sending

The registry never causes a node to be withheld when the caller does not already have the
unchanged content in its live context. When in doubt, the tool re-sends.

## 7. Fallbacks and failure modes

### 7.1 Graph backend unavailable

When the graph backend is unavailable, `explore` falls back to filesystem search for node
selection, and the sidekick trims the raw results per §5.6. Identity, fingerprinting, dedup
(§4), and message composition (§5) behave identically; only the selection source and the
trimming responsibility differ.

### 7.2 Sidekick error or abort

When the sidekick errors or is aborted, `explore` falls back to a direct backend/filesystem
query for the task and returns that result; dedup is best-effort in this path.

### 7.3 Whole-file request

The explicit whole-file request path (caller asks for complete file content for given paths)
bypasses the sidekick and returns the requested files; it still records deliveries in the
registry so subsequent selections of those files dedup correctly.

## 8. Non-goals

### 8.1 No editing

`explore` does not edit code, and the sidekick never proposes edits (§2.3).

### 8.2 No backend format dependency

This spec does not mandate the graph backend's output format; pi treats backend output as
opaque (§3.3).

### 8.3 Per-session only

Cross-session sharing of the registry is out of scope; the registry is per session (§6.1).
