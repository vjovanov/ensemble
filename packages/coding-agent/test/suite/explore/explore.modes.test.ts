import { chmodSync, cpSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
	type FauxProviderRegistration,
	fauxAssistantMessage,
	fauxToolCall,
	registerFauxProvider,
} from "@earendil-works/pi-ai";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ExtensionContext } from "../../../src/core/extensions/types.ts";
import {
	createExploreToolDefinition,
	type ExploreDebugEvent,
	exploreDebugLevel,
	graphBackendEnabled,
	requireGraphMode,
	requireGraphUnavailableMessage,
	setExploreDebugSink,
} from "../../../src/core/tools/explore.ts";

// §FS-001-ensemble-explore.7.4 (required-graph mode) and §FS-003-agent-protocol.10 (debug
// visibility). These run without real graphify: GRAPHIFY_COMMAND points at a missing binary so the
// backend is "not enabled", which is exactly the precondition required-graph mode guards.

const here = dirname(fileURLToPath(import.meta.url));
const ABSENT_GRAPHIFY = "graphify-absent-xyzzy";

function stageTsFixture(): string {
	const dir = mkdtempSync(join(tmpdir(), "explore-modes-"));
	cpSync(join(here, "fixtures", "ts"), dir, { recursive: true });
	return dir;
}

function getTextOutput(result: { content: Array<{ type: string; text?: string }> }): string {
	return result.content
		.filter((c): c is { type: "text"; text: string } => c.type === "text")
		.map((c) => c.text)
		.join("\n");
}

function fakeContext(cwd: string, model: ReturnType<FauxProviderRegistration["getModel"]>): ExtensionContext {
	return {
		cwd,
		model,
		modelRegistry: { getApiKeyAndHeaders: async () => ({ ok: true, apiKey: "test" }) },
		sessionManager: undefined,
		getSystemPrompt: () => "",
	} as unknown as ExtensionContext;
}

describe("required-graph mode (§FS-001-ensemble-explore.7.4)", () => {
	const envKeys = ["PI_REQUIRE_GRAPH", "GRAPHIFY_COMMAND", "PI_GRAPHIFY_GRAPH_FILE"] as const;
	let saved: Record<string, string | undefined>;
	beforeEach(() => {
		saved = Object.fromEntries(envKeys.map((k) => [k, process.env[k]]));
		process.env.GRAPHIFY_COMMAND = ABSENT_GRAPHIFY;
		delete process.env.PI_GRAPHIFY_GRAPH_FILE;
	});
	afterEach(() => {
		for (const k of envKeys) {
			if (saved[k] === undefined) delete process.env[k];
			else process.env[k] = saved[k];
		}
	});

	it("requireGraphMode() parses PI_REQUIRE_GRAPH", () => {
		delete process.env.PI_REQUIRE_GRAPH;
		expect(requireGraphMode()).toBe(false);
		for (const on of ["1", "true", "TRUE", "yes"]) {
			process.env.PI_REQUIRE_GRAPH = on;
			expect(requireGraphMode()).toBe(true);
		}
		process.env.PI_REQUIRE_GRAPH = "0";
		expect(requireGraphMode()).toBe(false);
	});

	it("graphBackendEnabled() is false when the graphify binary is missing", async () => {
		const dir = stageTsFixture();
		expect(await graphBackendEnabled(dir)).toBe(false);
	});

	it("graphBackendEnabled() requires a configured external graph file to exist outside the worktree", async () => {
		const dir = stageTsFixture();
		const bin = join(dir, "fake-graphify");
		writeFileSync(bin, "#!/usr/bin/env sh\nexit 0\n");
		chmodSync(bin, 0o755);
		process.env.GRAPHIFY_COMMAND = bin;

		process.env.PI_GRAPHIFY_GRAPH_FILE = join(dir, "missing", "graph.json");
		expect(await graphBackendEnabled(dir)).toBe(false);

		const externalDir = mkdtempSync(join(tmpdir(), "explore-modes-graph-"));
		const graphFile = join(externalDir, "graph.json");
		writeFileSync(graphFile, '{"nodes":[],"links":[]}\n');
		process.env.PI_GRAPHIFY_GRAPH_FILE = graphFile;
		expect(await graphBackendEnabled(dir)).toBe(true);
	});

	it("graphBackendEnabled() rejects configured graph files inside the worktree", async () => {
		const dir = stageTsFixture();
		const bin = join(dir, "fake-graphify");
		writeFileSync(bin, "#!/usr/bin/env sh\nexit 0\n");
		chmodSync(bin, 0o755);
		process.env.GRAPHIFY_COMMAND = bin;

		const graphFile = join(dir, "hidden-graph", "graph.json");
		mkdirSync(dirname(graphFile), { recursive: true });
		writeFileSync(graphFile, '{"nodes":[],"links":[]}\n');
		process.env.PI_GRAPHIFY_GRAPH_FILE = graphFile;
		expect(await graphBackendEnabled(dir)).toBe(false);

		process.env.PI_GRAPHIFY_GRAPH_FILE = "hidden-graph/graph.json";
		expect(await graphBackendEnabled(dir)).toBe(false);
	});

	it("fails fast (throws) instead of falling back when the backend is not enabled", async () => {
		process.env.PI_REQUIRE_GRAPH = "1";
		const dir = stageTsFixture();
		const def = createExploreToolDefinition(dir);
		// No degradation to the filesystem: the precondition surfaces as a thrown tool error.
		await expect(
			def.execute("explore-required", { task: "OrderService" }, undefined, undefined, undefined as never),
		).rejects.toThrow(/Required-graph mode/);
	});

	it("default (mode off) still falls back to the filesystem without throwing", async () => {
		delete process.env.PI_REQUIRE_GRAPH;
		const dir = stageTsFixture();
		const def = createExploreToolDefinition(dir);
		const result = await def.execute(
			"explore-fallback",
			{ task: "OrderService total" },
			undefined,
			undefined,
			undefined as never,
		);
		const details = (result as { details?: { backend?: string } }).details;
		expect(details?.backend).toBe("filesystem");
		expect(getTextOutput(result).length).toBeGreaterThan(0);
	});

	it("the precondition message names graphify and the cwd", () => {
		const msg = requireGraphUnavailableMessage("/tmp/project");
		expect(msg).toContain("graphify");
		expect(msg).toContain("/tmp/project");
		expect(msg).toContain("PI_REQUIRE_GRAPH");
	});
});

describe("explore debug visibility (§FS-003-agent-protocol.10)", () => {
	const envKeys = ["PI_EXPLORE_DEBUG", "GRAPHIFY_COMMAND", "PI_REQUIRE_GRAPH", "PI_GRAPHIFY_GRAPH_FILE"] as const;
	let saved: Record<string, string | undefined>;
	const registrations: FauxProviderRegistration[] = [];
	beforeEach(() => {
		saved = Object.fromEntries(envKeys.map((k) => [k, process.env[k]]));
		process.env.GRAPHIFY_COMMAND = ABSENT_GRAPHIFY;
		delete process.env.PI_REQUIRE_GRAPH;
		delete process.env.PI_GRAPHIFY_GRAPH_FILE;
	});
	afterEach(() => {
		setExploreDebugSink(undefined);
		while (registrations.length > 0) registrations.pop()?.unregister();
		for (const k of envKeys) {
			if (saved[k] === undefined) delete process.env[k];
			else process.env[k] = saved[k];
		}
	});

	it("exploreDebugLevel() parses PI_EXPLORE_DEBUG into off/metadata/full", () => {
		delete process.env.PI_EXPLORE_DEBUG;
		expect(exploreDebugLevel()).toBe("off");
		for (const off of ["off", "0", "false", "no", ""]) {
			process.env.PI_EXPLORE_DEBUG = off;
			expect(exploreDebugLevel()).toBe("off");
		}
		for (const meta of ["1", "true", "yes", "metadata"]) {
			process.env.PI_EXPLORE_DEBUG = meta;
			expect(exploreDebugLevel()).toBe("metadata");
		}
		process.env.PI_EXPLORE_DEBUG = "full";
		expect(exploreDebugLevel()).toBe("full");
	});

	it("emits tool-call and product events through the sink when enabled, but no events when off", async () => {
		const events: ExploreDebugEvent[] = [];
		setExploreDebugSink((e) => events.push(e));

		const registration = registerFauxProvider();
		registrations.push(registration);
		// Script the sub-agent: call graph_stats once, then return its selection.
		registration.setResponses([
			fauxAssistantMessage(fauxToolCall("graph_stats", {}, { id: "s1" }), { stopReason: "toolUse" }),
			fauxAssistantMessage("Selected OrderService."),
		]);

		const dir = stageTsFixture();
		const def = createExploreToolDefinition(dir);
		const context = fakeContext(dir, registration.getModel());

		// Debug off: the sink must not be called (§10.1 — observation only, off by default).
		delete process.env.PI_EXPLORE_DEBUG;
		await def.execute("explore-dbg-off", { task: "find OrderService" }, undefined, undefined, context);
		expect(events).toHaveLength(0);

		// Debug full: tool calls and the product are observed.
		registration.setResponses([
			fauxAssistantMessage(fauxToolCall("graph_stats", {}, { id: "s2" }), { stopReason: "toolUse" }),
			fauxAssistantMessage("Selected OrderService."),
		]);
		process.env.PI_EXPLORE_DEBUG = "full";
		await def.execute("explore-dbg-full", { task: "find OrderService" }, undefined, undefined, context);

		const toolCalls = events.filter((e) => e.type === "tool_call");
		const starts = toolCalls.filter((e) => e.phase === "start");
		const ends = toolCalls.filter((e) => e.phase === "end");
		expect(starts.some((e) => e.tool === "graph_stats" && e.ordinal === 1)).toBe(true);
		expect(ends.some((e) => e.tool === "graph_stats" && e.status === "ok" && typeof e.durationMs === "number")).toBe(
			true,
		);
		// full level captures a bounded result preview (§10.3).
		expect(ends.find((e) => e.tool === "graph_stats")?.resultPreview).toBeTruthy();
		// the terminal product is reported (§10.2), with status and output flag.
		const product = events.find((e) => e.type === "product");
		expect(product?.status).toBe("ok");
		expect(product?.producedOutput).toBe(true);
		expect(product?.summaryPreview).toBeTruthy();
	});

	it("does not expose configured graph storage paths in graph stats output", async () => {
		const events: ExploreDebugEvent[] = [];
		setExploreDebugSink((e) => events.push(e));

		const registration = registerFauxProvider();
		registrations.push(registration);
		registration.setResponses([
			fauxAssistantMessage(fauxToolCall("graph_stats", {}, { id: "s-path" }), { stopReason: "toolUse" }),
			fauxAssistantMessage("done"),
		]);

		const dir = stageTsFixture();
		const bin = join(dir, "fake-graphify");
		writeFileSync(bin, "#!/usr/bin/env sh\nexit 0\n");
		chmodSync(bin, 0o755);
		const externalDir = mkdtempSync(join(tmpdir(), "explore-modes-graph-"));
		const graphFile = join(externalDir, "hidden-graph", "graph.json");
		mkdirSync(dirname(graphFile), { recursive: true });
		writeFileSync(graphFile, '{"nodes":[{}],"links":[{}]}\n');
		process.env.GRAPHIFY_COMMAND = bin;
		process.env.PI_GRAPHIFY_GRAPH_FILE = graphFile;
		process.env.PI_EXPLORE_DEBUG = "full";

		const def = createExploreToolDefinition(dir);
		const context = fakeContext(dir, registration.getModel());
		await def.execute("explore-stats-hidden", { task: "inspect graph stats" }, undefined, undefined, context);

		const stats = events.find((e) => e.type === "tool_call" && e.tool === "graph_stats" && e.phase === "end");
		expect(stats?.resultPreview).toContain("graphify graph: 1 nodes, 1 edges.");
		expect(stats?.resultPreview).not.toContain(graphFile);
		expect(stats?.resultPreview).not.toContain("hidden-graph");
	});

	it("reports an aborted product when the sub-agent errors before producing a result (§10.2)", async () => {
		const events: ExploreDebugEvent[] = [];
		setExploreDebugSink((e) => events.push(e));

		const registration = registerFauxProvider();
		registrations.push(registration);
		// The sub-agent's final assistant turn ends in error — no usable product.
		registration.setResponses([fauxAssistantMessage("", { stopReason: "error" })]);

		const dir = stageTsFixture();
		const def = createExploreToolDefinition(dir);
		const context = fakeContext(dir, registration.getModel());
		process.env.PI_EXPLORE_DEBUG = "full";
		await def.execute("explore-dbg-abort", { task: "find OrderService" }, undefined, undefined, context);

		const product = events.find((e) => e.type === "product");
		expect(product).toBeDefined();
		expect(product?.status).toBe("aborted");
		expect(product?.producedOutput).toBe(false);
	});

	it("metadata level omits payloads (args/result preview)", async () => {
		const events: ExploreDebugEvent[] = [];
		setExploreDebugSink((e) => events.push(e));

		const registration = registerFauxProvider();
		registrations.push(registration);
		registration.setResponses([
			fauxAssistantMessage(fauxToolCall("graph_stats", {}, { id: "s3" }), { stopReason: "toolUse" }),
			fauxAssistantMessage("done"),
		]);

		const dir = stageTsFixture();
		const def = createExploreToolDefinition(dir);
		const context = fakeContext(dir, registration.getModel());
		process.env.PI_EXPLORE_DEBUG = "metadata";
		await def.execute("explore-dbg-meta", { task: "find OrderService" }, undefined, undefined, context);

		const toolCalls = events.filter((e) => e.type === "tool_call");
		expect(toolCalls.length).toBeGreaterThan(0);
		for (const e of toolCalls) {
			expect(e.args).toBeUndefined();
			expect(e.resultPreview).toBeUndefined();
		}
	});
});
