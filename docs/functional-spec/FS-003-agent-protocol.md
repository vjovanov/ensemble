# FS-003-agent-protocol: How the super-agent and a sub-agent communicate

Pi runs work in two tiers. A **super-agent** (the caller) delegates a bounded task to a
**sub-agent** it spawns inside a tool call — the explore agent of §FS-001-ensemble-explore, or
any future one. This spec defines the communication contract between the two, stated from
**each side's perspective**, independent of which sub-agent is used. (*ensemble* is the product
name, not an agent; the sub-agent that exists today is the *explore agent*.)

It unifies three channels that today live in separate specs: the **request** path (left implicit
by §FS-001-ensemble-explore), the **pull** path (§FS-002-caller-context), and the **product**
path (§FS-001-ensemble-explore.5). The mechanism is §AR-003-agent-protocol.

## 1. Vocabulary

- **Super-agent** (also *caller* / *parent*): the agent whose turn spawns the sub-agent. It is
  the main pi agent for the explore agent (cf. §FS-001-ensemble-explore.1,
  §FS-002-caller-context.1).
- **Sub-agent**: the agent spawned within a tool call — the explore agent, or a future one. It
  runs to completion and returns once.
- **Request**: the payload the super-agent pushes down at spawn (§5).
- **Product**: the single value the sub-agent returns up at the end (§6).
- **Pull**: a `caller_context` read the sub-agent itself initiates (§FS-002-caller-context.2.1).
- **Turn**: one delegation — one spawn, one product. The sub-agent does not persist beyond it.

## 2. The three channels — and only three

### 2.1 Request (super → sub), once, at spawn

The super-agent pushes exactly one downward payload: the request (§5). This is the only content
the super-agent injects into the sub-agent.

### 2.2 Context pull (sub → super), read-only, on demand

During its run the sub-agent may read the super-agent's branch through `caller_context`
(§FS-002-caller-context): its transcript, prior tool results and files, system prompt, and the
user's original request. The super-agent never pushes this; the sub-agent pulls exactly what it
needs (§FS-002-caller-context.2.1).

### 2.3 Product (sub → super), once, at the end

The sub-agent returns one upward value (§6), surfaced to the super-agent as a single tool result.

### 2.4 No other channel

There is no mid-run messaging, no streaming of partial products, and no path by which the
sub-agent writes to the super-agent's session, edits it, or calls its tools
(§FS-002-caller-context.11.1). The three channels of §2.1–§2.3 are exhaustive.

## 3. The super-agent's perspective

### 3.1 Delegation is a single tool call

The super-agent delegates by calling one tool with a request (§5). It does **not** see the
sub-agent's tools, transcript, or intermediate reasoning — only the returned product (§3.3). The
sub-agent is invisible to it otherwise (§FS-001-ensemble-explore.1).

### 3.2 It provides the run substrate, not its history

The super-agent supplies what the sub-agent runs on — model, credentials, working directory, and
an abort signal — but **not** its conversation. Its context is offered read-only for pull
(§2.2, §FS-002-caller-context.8), never pushed.

### 3.3 It receives exactly one result

The super-agent gets one tool-result message back (§6). For `explore`, the tool post-processes
the sub-agent's product into the deduplicated message (§FS-001-ensemble-explore.5); the
super-agent never sees raw sub-agent output.

### 3.4 It is paused while the sub-agent runs

For the sub-agent's lifetime the super-agent is suspended on the spawning tool call, so its
branch is stable for the sub-agent's pulls (§FS-002-caller-context.2.3). Aborting the super-agent
aborts the sub-agent (§7.2).

## 4. The sub-agent's perspective

### 4.1 It starts empty, with a request

The sub-agent begins with no caller history — only the request (§5) and a one-line announcement
that `caller_context` exists (§FS-002-caller-context.8). It must not assume it can see the
super-agent's prior turns.

### 4.2 It pulls on its own initiative

To learn more it calls tools itself: `caller_context` for the super-agent's gathered context
(index→fetch / system_prompt / user_request, §FS-002-caller-context.4), and its task tools — for
the explore agent, the graph tools, never raw file bodies when a graph backend is present
(§FS-001-ensemble-explore.2.1).

### 4.3 It must terminate with a structured product

The sub-agent ends by producing one product (§6): the explore agent emits an ordered `NodeRef` list
plus a one-line summary (§FS-001-ensemble-explore.2.2); a generic sub-agent returns its final
text. Presentation and selection downstream are not its job (§FS-001-ensemble-explore.2.3).

### 4.4 It is read-only and single-shot

The sub-agent never mutates the super-agent (§FS-002-caller-context.2.2), never addresses the
user, never edits code, and reaches the super-agent only through its one return path
(§FS-002-caller-context.11.1).

## 5. The request (super → sub)

### 5.1 Contents

The request is a natural-language task plus optional scope and options — for `explore`, focus
paths, whole-file vs snippet mode, and a result cap. It is the only content pushed down (§2.1).

### 5.2 Self-contained by default

The request must carry enough for the sub-agent to act without the super-agent's history.
Anything beyond it, the sub-agent pulls (§4.2). A super-agent that needs the sub-agent to use
specific prior context should say so in the request so the sub-agent knows to pull it.

## 6. The product (sub → super)

### 6.1 One return value

The product is a single value, surfaced as one tool result. The protocol does not stream or
return incrementally (§2.4).

### 6.2 Post-processing belongs to the tool, not the sub-agent

The sub-agent returns its raw selection; the **tool** shapes what the super-agent sees. For
`explore` that is dedup against the registry and message composition
(§FS-001-ensemble-explore.4, §FS-001-ensemble-explore.5) — the sub-agent does not format it
(§FS-001-ensemble-explore.2.3).

### 6.3 Empty and failure are explicit, never silent

A run that finds nothing still returns a stated result (§FS-001-ensemble-explore.5.4); a
sub-agent that errors or is aborted degrades to a defined fallback
(§FS-001-ensemble-explore.7.2), and an absent caller context degrades to an explicit no-context
result (§FS-002-caller-context.10.2). A sub-agent failure never aborts the super-agent's turn.

## 7. Lifecycle and control

### 7.1 Pause

The super-agent is suspended on the spawning tool call until the sub-agent returns its product
(§3.4).

### 7.2 Abort propagates downward

The super-agent's abort signal aborts the sub-agent. An aborted sub-agent yields no partial
product through the normal return path (§6.3).

### 7.3 Single turn, no persistence

The protocol covers one delegation. The sub-agent does not persist across super-agent turns and
holds no cross-session or cross-agent state (cf. §FS-001-ensemble-explore.8.3,
§FS-002-caller-context.11.2).

## 8. Trust

The sub-agent runs on the user's behalf inside the super-agent's session and shares its trust
domain (§FS-002-caller-context.10.1): it may read the super-agent's context within the bounds of
§FS-002-caller-context.6, but never write it (§4.4).

## 9. Reusable across sub-agent types

Channels and lifecycle (§2–§8) are identical for every sub-agent. Only the **request** (§5) and
the **product** (§6) payloads specialize per sub-agent type: the explore agent's request is an
exploration task and its product is `NodeRef`s; a future sub-agent's request and product would
be its own. The capability set (graph tools, `caller_context`) is attached the same way for each
(§FS-002-caller-context.9).

## 10. Non-goals

### 10.1 No upward writes

The sub-agent cannot, through this protocol, message the super-agent mid-run, edit its session,
or invoke its tools (§2.4, §FS-002-caller-context.11.1).

### 10.2 No peer or cross-session channel

The protocol is strictly super-to-sub within one session. Sub-agent-to-sub-agent messaging and
reading other sessions are out of scope (§FS-002-caller-context.11.2).

### 10.3 No streaming product

The product is a single terminal value (§6.1); incremental or partial delivery is out of scope.
