import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { createCallerContextTool } from "../../../src/core/tools/caller-context.ts";
import type { ExtensionContext } from "../../../src/core/extensions/types.ts";
import type { SessionEntry } from "../../../src/core/session-manager.ts";

// §FS-002-caller-context / §AR-002-caller-context §10.5: index lists each kind; fetch by
// ids/recency/query; unparameterised fetch is bounded; over-cap output reports truncation;
// compacted branch surfaces summary entries; empty/absent session manager degrades.

const here = dirname(fileURLToPath(import.meta.url));

// Golden files are committed so the expected results are reviewable. Regenerate with
// UPDATE_GOLDEN=1; a missing golden is created on first run, then asserted against.
function assertGolden(name: string, actual: string): void {
	const file = join(here, "golden", name);
	if (process.env.UPDATE_GOLDEN || !existsSync(file)) {
		mkdirSync(dirname(file), { recursive: true });
		writeFileSync(file, actual);
	}
	expect(actual).toBe(readFileSync(file, "utf-8"));
}

const SYSTEM_PROMPT = "You are the main pi agent. Be concise and cite §FS ids.";

// A representative caller branch: user/assistant transcript, a tool_result the caller read,
// a bash execution, a compaction summary, a skipped model_change, and a follow-up.
function makeBranch(): SessionEntry[] {
	const entries: unknown[] = [
		{
			type: "message",
			id: "u1",
			parentId: null,
			timestamp: "t1",
			message: { role: "user", content: "Refactor GraphifyBackend.query to add a timeout guard.", timestamp: 1 },
		},
		{
			type: "message",
			id: "a1",
			parentId: "u1",
			timestamp: "t2",
			message: { role: "assistant", content: [{ type: "text", text: "I'll inspect the backend implementation first." }] },
		},
		{
			type: "message",
			id: "tr1",
			parentId: "a1",
			timestamp: "t3",
			message: {
				role: "toolResult",
				toolCallId: "x1",
				toolName: "explore",
				content: [
					{
						type: "text",
						text: '<file path="explore.ts">class GraphifyBackend { async query() { /* spawns without a timeout */ } }</file>',
					},
				],
				isError: false,
			},
		},
		{
			type: "message",
			id: "be1",
			parentId: "tr1",
			timestamp: "t4",
			message: {
				role: "bashExecution",
				command: "npm test -- explore",
				output: "1 passed",
				exitCode: 0,
				cancelled: false,
				truncated: false,
				timestamp: 4,
			},
		},
		{
			type: "compaction",
			id: "cs1",
			parentId: "be1",
			timestamp: "t5",
			summary: "Earlier the team chose graph-only exploration with dedup against caller context.",
			firstKeptEntryId: "u1",
			tokensBefore: 1234,
		},
		{
			type: "model_change",
			id: "mc1",
			parentId: "cs1",
			timestamp: "t6",
			provider: "anthropic",
			modelId: "claude-opus-4-8",
		},
		{
			type: "message",
			id: "a2",
			parentId: "mc1",
			timestamp: "t7",
			message: {
				role: "assistant",
				content: [{ type: "text", text: "query() spawns without a timeout; I'll add a GRAPHIFY_TIMEOUT_MS guard." }],
			},
		},
		{
			type: "message",
			id: "u2",
			parentId: "a2",
			timestamp: "t8",
			message: { role: "user", content: "Yes, do that.", timestamp: 8 },
		},
	];
	return entries as unknown as SessionEntry[];
}

function makeContext(branch: SessionEntry[] | undefined, systemPrompt = SYSTEM_PROMPT): ExtensionContext {
	return {
		sessionManager: branch ? { getBranch: () => branch } : undefined,
		getSystemPrompt: () => systemPrompt,
	} as unknown as ExtensionContext;
}

async function run(context: ExtensionContext, input: Record<string, unknown>): Promise<string> {
	const tool = createCallerContextTool(context);
	const result = await tool.execute("call-1", input as never, undefined);
	const block = result.content.find((c): c is { type: "text"; text: string } => c.type === "text");
	return block?.text ?? "";
}

describe("caller_context tool", () => {
	const context = makeContext(makeBranch());

	it("op:index lists every entry kind with size and preview (model_change skipped)", async () => {
		const out = await run(context, { op: "index" });
		expect(out).toContain("[tr1] tool_result");
		expect(out).toContain("[cs1] summary"); // §7 compaction surfaced
		expect(out).not.toContain("mc1"); // model_change skipped
		assertGolden("index-all.txt", out);
	});

	it("op:index filters by kind", async () => {
		const out = await run(context, { op: "index", kinds: ["tool_result"] });
		expect(out).toContain("tool_result");
		expect(out).not.toContain("transcript");
		assertGolden("index-tool_result.txt", out);
	});

	it("op:fetch by ids returns full bodies", async () => {
		const out = await run(context, { op: "fetch", ids: ["tr1"] });
		expect(out).toContain("GraphifyBackend");
		assertGolden("fetch-ids.txt", out);
	});

	it("op:fetch by query filters case-insensitively over text", async () => {
		const out = await run(context, { op: "fetch", query: "timeout" });
		assertGolden("fetch-query.txt", out);
	});

	it("op:fetch by recency returns the last N entries", async () => {
		const out = await run(context, { op: "fetch", recency: 2 });
		assertGolden("fetch-recency.txt", out);
	});

	it("op:fetch with no selector returns a bounded recency window", async () => {
		const out = await run(context, { op: "fetch" });
		// 8 entries minus the skipped model_change = 7, all within DEFAULT_RECENCY (10).
		expect(out).toContain("[u1]");
		expect(out).toContain("[u2]");
		assertGolden("fetch-default.txt", out);
	});

	it("op:system_prompt returns the caller prompt", async () => {
		const out = await run(context, { op: "system_prompt" });
		assertGolden("system_prompt.txt", out);
	});

	it("op:user_request returns only user-authored text", async () => {
		const out = await run(context, { op: "user_request" });
		expect(out).toContain("timeout guard");
		expect(out).not.toContain("inspect the backend"); // assistant text excluded
		assertGolden("user_request.txt", out);
	});

	it("degrades to a no-context result on an empty branch", async () => {
		const out = await run(makeContext([]), { op: "index" });
		expect(out).toBe("No caller context available.");
	});

	it("degrades to a no-context result when no session manager is available", async () => {
		const out = await run(makeContext(undefined), { op: "fetch" });
		expect(out).toBe("No caller context available.");
	});

	it("caps over-budget fetch output and reports truncation, never silently", async () => {
		const huge = "x".repeat(80 * 1024);
		const branch = [
			{
				type: "message",
				id: "big",
				parentId: null,
				timestamp: "t1",
				message: { role: "toolResult", toolCallId: "x", toolName: "explore", content: [{ type: "text", text: huge }], isError: false },
			},
		] as unknown as SessionEntry[];
		const out = await run(makeContext(branch), { op: "fetch", ids: ["big"] });
		expect(out).toContain("[Truncated:");
		expect(out.length).toBeLessThan(huge.length);
	});
});
