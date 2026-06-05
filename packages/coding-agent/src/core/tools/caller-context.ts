import type { AgentTool } from "@earendil-works/pi-agent-core";
import { type Static, Type } from "typebox";
import type { ExtensionContext } from "../extensions/types.ts";
import { bashExecutionToText } from "../messages.ts";
import type { SessionEntry } from "../session-manager.ts";

// §AR-002-caller-context: a single reusable tool that lets a spawned sub-agent read the
// caller's branch on demand (pull-only, read-only). Built from the caller's ExtensionContext;
// the handler reads the caller's session when the *sub-agent* calls it (§FS-002-caller-context.2).

const MAX_CALLER_CONTEXT_BYTES = 64 * 1024; // §FS-002-caller-context.6.1
const DEFAULT_RECENCY = 10; // §FS-002-caller-context.6.2
const NO_CONTEXT = "No caller context available."; // §FS-002-caller-context.10.2

const callerContextSchema = Type.Object({
	op: Type.Union(
		[
			Type.Literal("index"), // §FS-002-caller-context.4.1
			Type.Literal("fetch"), // §FS-002-caller-context.4.2
			Type.Literal("system_prompt"), // §FS-002-caller-context.3.3 / 4.3
			Type.Literal("user_request"), // §FS-002-caller-context.3.4 / 4.3
		],
		{ description: "index: list entries (no bodies). fetch: full text of selected entries. system_prompt / user_request: direct." },
	),
	ids: Type.Optional(Type.Array(Type.String(), { description: "fetch selector: entry ids from the index." })),
	recency: Type.Optional(Type.Number({ description: "fetch selector: the most recent N entries." })),
	query: Type.Optional(Type.String({ description: "fetch selector: case-insensitive keyword filter over entry text." })),
	kinds: Type.Optional(
		Type.Array(Type.String(), {
			description: 'filter by kind: "transcript" | "tool_result" | "summary" | "all" (default all).',
		}),
	),
});

export type CallerContextInput = Static<typeof callerContextSchema>;

type CallerKind = "transcript" | "tool_result" | "summary";

interface CallerEntry {
	id: string;
	kind: CallerKind;
	text: string;
	isUser: boolean;
}

function blocksToText(content: unknown): string {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	return content
		.filter((block): block is { type: "text"; text: string } => {
			const b = block as { type?: string; text?: unknown };
			return b.type === "text" && typeof b.text === "string";
		})
		.map((block) => block.text)
		.join(" ");
}

// §AR-002-caller-context.3.2 / 3.3: map a session entry to a caller_context kind + text.
function mapEntry(entry: SessionEntry): CallerEntry | undefined {
	if (entry.type === "compaction" || entry.type === "branch_summary") {
		const summary = (entry as { summary?: string }).summary ?? "";
		if (!summary.trim()) return undefined;
		return { id: entry.id, kind: "summary", text: summary, isUser: false };
	}
	if (entry.type !== "message") return undefined; // skip model/thinking changes, labels, etc.
	const message = entry.message as unknown as Record<string, unknown>;
	const role = message.role as string;
	switch (role) {
		case "user":
			return { id: entry.id, kind: "transcript", text: blocksToText(message.content), isUser: true };
		case "assistant":
		case "custom":
			return { id: entry.id, kind: "transcript", text: blocksToText(message.content), isUser: false };
		case "toolResult":
			return { id: entry.id, kind: "tool_result", text: blocksToText(message.content), isUser: false };
		case "bashExecution":
			return { id: entry.id, kind: "tool_result", text: bashExecutionToText(message as never), isUser: false };
		case "branchSummary":
		case "compactionSummary":
			return { id: entry.id, kind: "summary", text: (message.summary as string) ?? "", isUser: false };
		default:
			return { id: entry.id, kind: "transcript", text: blocksToText(message.content), isUser: false };
	}
}

function readBranch(context: ExtensionContext): CallerEntry[] {
	const manager = context.sessionManager as ExtensionContext["sessionManager"] | undefined;
	if (!manager || typeof manager.getBranch !== "function") return [];
	let branch: SessionEntry[];
	try {
		branch = manager.getBranch();
	} catch {
		return [];
	}
	const entries: CallerEntry[] = [];
	for (const entry of branch) {
		const mapped = mapEntry(entry);
		if (mapped && mapped.text.trim()) entries.push(mapped);
	}
	return entries;
}

function approxTokens(text: string): number {
	return Math.ceil(text.length / 4);
}

function singleLinePreview(text: string, max = 80): string {
	const flat = text.replace(/\s+/g, " ").trim();
	return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

// §FS-002-caller-context.5: filter entries by the requested kinds (default all).
function filterByKinds(entries: CallerEntry[], kinds: string[] | undefined): CallerEntry[] {
	if (!kinds || kinds.length === 0 || kinds.includes("all")) return entries;
	const wanted = new Set(kinds);
	return entries.filter((entry) => wanted.has(entry.kind));
}

// §FS-002-caller-context.6.1: cap output, never silent.
function applyCap(text: string): string {
	const bytes = Buffer.byteLength(text, "utf-8");
	if (bytes <= MAX_CALLER_CONTEXT_BYTES) return text;
	const buffer = Buffer.from(text, "utf-8").subarray(0, MAX_CALLER_CONTEXT_BYTES);
	const shown = buffer.toString("utf-8");
	return `${shown}\n[Truncated: ${MAX_CALLER_CONTEXT_BYTES} of ${bytes} bytes shown. Narrow with ids/query/recency.]`;
}

function renderIndex(entries: CallerEntry[]): string {
	if (entries.length === 0) return NO_CONTEXT;
	return entries.map((e) => `[${e.id}] ${e.kind} · ~${approxTokens(e.text)}t · "${singleLinePreview(e.text)}"`).join("\n");
}

// §AR-002-caller-context.5: select by any supplied selector; bounded default when none.
function selectForFetch(entries: CallerEntry[], input: CallerContextInput): CallerEntry[] {
	const hasSelector = (input.ids && input.ids.length > 0) || input.recency !== undefined || input.query !== undefined;
	if (!hasSelector) {
		return entries.slice(-DEFAULT_RECENCY);
	}
	const ids = new Set(input.ids ?? []);
	const recencyIds = new Set(
		input.recency !== undefined ? entries.slice(-Math.max(0, Math.floor(input.recency))).map((e) => e.id) : [],
	);
	const query = input.query?.toLowerCase();
	return entries.filter((entry) => {
		if (ids.has(entry.id)) return true;
		if (recencyIds.has(entry.id)) return true;
		if (query !== undefined && entry.text.toLowerCase().includes(query)) return true;
		return false;
	});
}

function renderFetch(entries: CallerEntry[]): string {
	if (entries.length === 0) return NO_CONTEXT;
	return applyCap(entries.map((e) => `=== [${e.id}] ${e.kind} ===\n${e.text}`).join("\n\n"));
}

export function createCallerContextTool(context: ExtensionContext): AgentTool<typeof callerContextSchema> {
	return {
		name: "caller_context",
		label: "caller_context",
		description:
			"Read the calling agent's context on demand: its transcript, prior tool results and files it read, its system prompt, or the user's original request. Use op:\"index\" to survey cheaply, then op:\"fetch\" by ids/recency/query. Take only what you need.",
		parameters: callerContextSchema,
		execute: async (_toolCallId, params) => {
			const input = params as CallerContextInput;
			let text: string;
			if (input.op === "system_prompt") {
				// §AR-002-caller-context.7
				const prompt = typeof context.getSystemPrompt === "function" ? context.getSystemPrompt() : "";
				text = prompt.trim() ? applyCap(prompt) : NO_CONTEXT;
			} else if (input.op === "user_request") {
				// §AR-002-caller-context.7: user-authored transcript entries.
				const userText = readBranch(context)
					.filter((entry) => entry.isUser)
					.map((entry) => entry.text)
					.join("\n\n");
				text = userText.trim() ? applyCap(userText) : NO_CONTEXT;
			} else {
				const entries = filterByKinds(readBranch(context), input.kinds);
				text = input.op === "index" ? renderIndex(entries) : renderFetch(selectForFetch(entries, input));
			}
			return { content: [{ type: "text", text }], details: undefined, isError: false };
		},
	};
}
