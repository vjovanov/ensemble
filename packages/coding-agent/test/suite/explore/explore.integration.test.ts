import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
	type FauxProviderRegistration,
	fauxAssistantMessage,
	fauxToolCall,
	registerFauxProvider,
} from "@earendil-works/pi-ai";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { ExtensionContext } from "../../../src/core/extensions/types.ts";
import { createExploreTool, createExploreToolDefinition } from "../../../src/core/tools/explore.ts";

// §FS-001-ensemble-explore: integration tests over a multi-language fixture corpus. With real
// graphify the backend returns node structure (graph-only, §5.6); without it the filesystem
// fallback returns ranked snippets (§7.1). Results are pinned to committed golden files.

const here = dirname(fileURLToPath(import.meta.url));

const LANGUAGES = [
	{ lang: "ts", file: "order-service.ts" },
	{ lang: "py", file: "order_service.py" },
	{ lang: "go", file: "order_service.go" },
	{ lang: "java", file: "OrderService.java" },
	{ lang: "rs", file: "order_service.rs" },
];

function getTextOutput(result: { content: Array<{ type: string; text?: string }> }): string {
	return result.content
		.filter((c): c is { type: "text"; text: string } => c.type === "text")
		.map((c) => c.text)
		.join("\n");
}

// Golden files are committed for review. Regenerate with UPDATE_GOLDEN=1; a missing golden is
// created on first run and then asserted against.
function assertGolden(name: string, actual: string): void {
	const file = join(here, "golden", name);
	if (process.env.UPDATE_GOLDEN || !existsSync(file)) {
		mkdirSync(dirname(file), { recursive: true });
		writeFileSync(file, actual);
	}
	expect(actual).toBe(readFileSync(file, "utf-8"));
}

function fixtureDir(lang: string): string {
	return join(here, "fixtures", lang);
}

// Copy a single-language fixture into a throwaway dir so graphify's build artifacts
// (graphify-out/) never touch the committed tree.
function stageFixture(lang: string): string {
	const dir = mkdtempSync(join(tmpdir(), `explore-${lang}-`));
	cpSync(fixtureDir(lang), dir, { recursive: true });
	return dir;
}

// graphify query output lists NODE/EDGE lines in nondeterministic BFS order; the *set* is
// stable, so normalize to sorted NODE/EDGE lines for a deterministic golden.
function normalizeGraphify(text: string): string {
	return text
		.split("\n")
		.map((line) => line.trimEnd())
		.filter((line) => line.startsWith("NODE ") || line.startsWith("EDGE "))
		.sort()
		.join("\n");
}

function resolveGraphifyBin(): string | undefined {
	const env = process.env.GRAPHIFY_TEST_BIN;
	if (env && existsSync(env)) return env;
	for (const candidate of [
		join(homedir(), "f/graphify/.venv/bin/graphify"),
		join(homedir(), "c/graphify/.venv/bin/graphify"),
	]) {
		if (existsSync(candidate)) return candidate;
	}
	return undefined;
}

const GRAPHIFY_BIN = resolveGraphifyBin();
const describeGraphify = GRAPHIFY_BIN ? describe : describe.skip;
if (!GRAPHIFY_BIN) {
	console.warn("[explore.integration] real graphify not found; set GRAPHIFY_TEST_BIN to run graphify-present tests.");
}

describeGraphify("explore with real graphify present", () => {
	const original = process.env.GRAPHIFY_COMMAND;
	beforeAll(() => {
		process.env.GRAPHIFY_COMMAND = GRAPHIFY_BIN;
	});
	afterAll(() => {
		if (original === undefined) delete process.env.GRAPHIFY_COMMAND;
		else process.env.GRAPHIFY_COMMAND = original;
	});

	for (const { lang } of LANGUAGES) {
		it(`returns graph node structure for ${lang}`, async () => {
			const dir = stageFixture(lang);
			const tool = createExploreTool(dir);
			// No context -> no sidekick; execute falls through to backend.query against real graphify.
			const result = await tool.execute("explore-graph", { task: "OrderService" });
			const details = (result as { details?: { backend?: string } }).details;
			expect(details?.backend).toBe("graphify");
			assertGolden(`${lang}.graphify.txt`, normalizeGraphify(getTextOutput(result)));
		});
	}
});

describe("explore filesystem fallback (graphify absent)", () => {
	const original = process.env.GRAPHIFY_COMMAND;
	beforeAll(() => {
		// Point at a binary that does not exist so isAvailable() is false.
		process.env.GRAPHIFY_COMMAND = "graphify-absent-xyzzy";
	});
	afterAll(() => {
		if (original === undefined) delete process.env.GRAPHIFY_COMMAND;
		else process.env.GRAPHIFY_COMMAND = original;
	});

	for (const { lang } of LANGUAGES) {
		it(`returns ranked snippets for ${lang}`, async () => {
			const dir = stageFixture(lang);
			const tool = createExploreTool(dir);
			const result = await tool.execute("explore-fallback", { task: "OrderService total tax" });
			const details = (result as { details?: { backend?: string } }).details;
			expect(details?.backend).toBe("filesystem");
			assertGolden(`${lang}.fallback.txt`, getTextOutput(result).trimEnd());
		});
	}
});

describeGraphify("mock agent fetches nodes through the sidekick", () => {
	const original = process.env.GRAPHIFY_COMMAND;
	const registrations: FauxProviderRegistration[] = [];
	beforeAll(() => {
		process.env.GRAPHIFY_COMMAND = GRAPHIFY_BIN;
	});
	afterAll(() => {
		if (original === undefined) delete process.env.GRAPHIFY_COMMAND;
		else process.env.GRAPHIFY_COMMAND = original;
	});
	afterEach(() => {
		while (registrations.length > 0) registrations.pop()?.unregister();
	});

	function fakeContext(cwd: string, model: ReturnType<FauxProviderRegistration["getModel"]>): ExtensionContext {
		return {
			cwd,
			model,
			modelRegistry: { getApiKeyAndHeaders: async () => ({ ok: true, apiKey: "test" }) },
			sessionManager: undefined,
			getSystemPrompt: () => "",
		} as unknown as ExtensionContext;
	}

	it("drives a graph_query tool call against real graphify and returns the sidekick's selection", async () => {
		const registration = registerFauxProvider();
		registrations.push(registration);
		// Script the sidekick: first turn calls graph_query, second turn returns the selection.
		registration.setResponses([
			fauxAssistantMessage(fauxToolCall("graph_query", { question: "OrderService" }, { id: "q1" }), {
				stopReason: "toolUse",
			}),
			fauxAssistantMessage("Selected OrderService and .computeTotal()."),
		]);

		const dir = stageFixture("ts");
		const def = createExploreToolDefinition(dir);
		const context = fakeContext(dir, registration.getModel());
		const result = await def.execute(
			"explore-sidekick",
			{ task: "find OrderService" },
			undefined,
			undefined,
			context,
		);

		expect(registration.state.callCount).toBe(2); // tool-call turn + final turn
		const details = (result as { details?: { sidekickUsed?: boolean; backend?: string } }).details;
		expect(details?.sidekickUsed).toBe(true);
		expect(details?.backend).toBe("graphify");
		expect(getTextOutput(result)).toContain("Selected OrderService");
	});
});
