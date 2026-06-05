# AR-003-agent-protocol: How the super-agent ↔ sub-agent channels are wired

Mechanism for §FS-003-agent-protocol. The whole protocol rides one existing seam: a sub-agent
is built inside a tool call by a spawner that holds the super-agent's `ExtensionContext`. No new
plumbing into the `Agent` core is required. Reference implementation: `runSidekick` in
`packages/coding-agent/src/core/tools/explore.ts`.

## 1. The seam

The spawner runs during the super-agent's tool call and captures its `ExtensionContext`
(`explore.ts:runSidekick(input, context, …)`). It constructs an `Agent`
(`@earendil-works/pi-agent-core`) for the sub-agent, whose tools close over that same `context`
(§AR-002-caller-context.1). The super-agent stays paused on the tool call
(§FS-003-agent-protocol.3.4) while the sub-agent's `Agent` runs.

```
super-agent turn → tool call → runSidekick(context)
   │  builds sub-agent Agent { systemPrompt, model, tools, streamFn }
   │  request ↓ (prompt)            §FS-003-agent-protocol.5
   │  caller_context ↕ (pull)       §FS-003-agent-protocol.2.2
   └  product ↑ (return)            §FS-003-agent-protocol.6
```

## 2. Request channel (§FS-003-agent-protocol.5)

The tool's input schema is the request. `runSidekick` turns it into the sub-agent's opening
prompt (the `task` plus `paths`/`wholeFiles` framing), and nothing else of the super-agent's
state is pushed (§FS-003-agent-protocol.2.1). The sub-agent's `messages` start empty.

## 3. Run substrate (§FS-003-agent-protocol.3.2)

The sub-agent runs on the super-agent's resources, all read from `context`:

- **model** — `context.model`.
- **auth / transport** — the `streamFn` resolves `context.modelRegistry.getApiKeyAndHeaders(model)`
  then calls `streamSimple` (`explore.ts` sidekick `streamFn`).
- **working dir** — `context.cwd`.

The super-agent's conversation is *not* among these — it is reachable only by pull (§4).

## 4. Pull channel (§FS-003-agent-protocol.2.2)

`createCallerContextTool(context)` (§AR-002-caller-context.2) is added to the sub-agent's
toolset, alongside its task tools, and the system prompt gains the single announce line
(§FS-002-caller-context.8). Because the tool closes over the super-agent's `context`, a call made
by the *sub-agent* reads the *super-agent's* branch read-only (§AR-002-caller-context.3).

## 5. Product channel (§FS-003-agent-protocol.6)

The sub-agent terminates; the spawner reads its product from the final assistant message — for
`explore`, the `select_nodes` argument (§AR-001-ensemble-explore.3.1). The tool then
post-processes (dedup + composition, §AR-001-ensemble-explore.4–5) and returns one tool result
in the standard shape `{ content: [{ type: "text", text }], details, isError }`
(§FS-003-agent-protocol.6.2). The super-agent sees only that.

## 6. Lifecycle and abort (§FS-003-agent-protocol.7)

`runSidekick` awaits `sidekick.prompt(request)` — the pause (§FS-003-agent-protocol.7.1). It
bridges the super-agent's abort to the sub-agent by `signal.addEventListener("abort", () =>
sidekick.abort())` and removing the listener in `finally`, so a super-agent abort propagates
down (§FS-003-agent-protocol.7.2). On sub-agent error/abort the tool returns its defined fallback
rather than throwing (§FS-003-agent-protocol.6.3, §AR-001-ensemble-explore.6).

## 7. Reuse for other sub-agents (§FS-003-agent-protocol.9)

A new sub-agent type reuses this seam unchanged: build its `Agent` from the spawner's
`ExtensionContext`, attach `createCallerContextTool(context)` plus its own task tools, push the
request as the prompt, and read its product on return. Only the request schema (§2) and the
product extraction (§5) are sub-agent-specific; channels, substrate, pull, and abort (§2–§6) are
identical. The ensemble agent attaches the capability the same way (§AR-002-caller-context.9).
