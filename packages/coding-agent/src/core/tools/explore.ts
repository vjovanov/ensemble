import { access, appendFile, mkdir, readdir, readFile, stat } from "node:fs/promises";
import { dirname, extname, resolve as resolvePath, sep } from "node:path";
import { Agent, type AgentTool, type ThinkingLevel } from "@earendil-works/pi-agent-core";
import {
	type Api,
	clampThinkingLevel,
	type ImageContent,
	type Model,
	streamSimple,
	type TextContent,
} from "@earendil-works/pi-ai";
import { Text } from "@earendil-works/pi-tui";
import { spawn } from "child_process";
import { type Static, type TSchema, Type } from "typebox";
import { getExploreDebugLogPath } from "../../config.ts";
import { keyHint } from "../../modes/interactive/components/keybinding-hints.ts";
import type { Theme } from "../../modes/interactive/theme/theme.ts";
import { formatPathRelativeToCwdOrAbsolute } from "../../utils/paths.ts";
import type { ExtensionContext, ToolDefinition, ToolRenderResultOptions } from "../extensions/types.ts";
import { convertToLlm } from "../messages.ts";
import { createCallerContextTool } from "./caller-context.ts";
import { resolveReadPathAsync, resolveToCwd } from "./path-utils.ts";
import { getTextOutput, renderToolPath, replaceTabs, str } from "./render-utils.ts";
import { wrapToolDefinition } from "./tool-definition-wrapper.ts";
import { DEFAULT_MAX_BYTES, formatSize, type TruncationResult, truncateHead, truncateLine } from "./truncate.ts";

// Real graphify CLI (github.com/safishamsi/graphify). Overridable so tests can point at a
// specific binary (e.g. a project venv). Note: graphify exits 0 even on errors, so callers
// must validate stdout, not just the exit code.
function graphifyCommand(): string {
	return process.env.GRAPHIFY_COMMAND?.trim() || "graphify";
}
const GRAPHIFY_OUT_DIR = "graphify-out";
const GRAPHIFY_GRAPH_FILE = "graph.json";
const GRAPHIFY_TIMEOUT_MS = 8_000;
const GRAPHIFY_BUILD_TIMEOUT_MS = 20_000;
const MAX_TOOL_OUTPUT_BYTES = 64 * 1024;
const DEFAULT_MAX_SNIPPETS = 8;
const MAX_FALLBACK_FILES = 1_000;
const SNIPPET_CONTEXT_LINES = 2;
// §FS-003-agent-protocol.10.3: bound captured payloads like §FS-002-caller-context.6.
const DEBUG_PAYLOAD_PREVIEW_BYTES = 2_000;

// =============================================================================
// Required-graph mode (§FS-001-ensemble-explore.7.4)
// =============================================================================

// §FS-001-ensemble-explore.7.4.1: opt-in, off by default. When on, an enabled graph backend
// is a hard precondition — explore fails fast instead of falling back to the filesystem (§7.1).
// Enforced in two places: the CLI startup gate (main.ts, §7.4.2) refuses to start; for embedders
// that bypass main() (the SDK), the explore tool itself fails fast on each call (createExplore-
// ToolDefinition, §7.4.3). The startup gate is CLI-only by design; the tool-level check is the
// backstop that holds the guarantee everywhere.
export function requireGraphMode(): boolean {
	const raw = process.env.PI_REQUIRE_GRAPH?.trim().toLowerCase();
	return raw === "1" || raw === "true" || raw === "yes";
}

// §FS-001-ensemble-explore.7.4.1: "enabled" means graphify is both configured and reachable
// enough to answer (the binary resolves and runs). Deeper "can actually serve" failures are
// caught lazily and surface as the mid-session fail-fast of §7.4.3.
export async function graphBackendEnabled(cwd: string, signal?: AbortSignal): Promise<boolean> {
	return commandAvailable(graphifyCommand(), cwd, signal);
}

// §FS-001-ensemble-explore.7.4.2: the diagnostic naming graphify as the unmet precondition.
export function requireGraphUnavailableMessage(cwd: string): string {
	return [
		`Required-graph mode is on (PI_REQUIRE_GRAPH) but the graph backend (graphify) is not enabled in ${cwd}.`,
		`Install and configure graphify, or unset PI_REQUIRE_GRAPH to allow the filesystem fallback.`,
		`See FS-001-ensemble-explore §7.4.`,
	].join(" ");
}

// =============================================================================
// Explore debug visibility (§FS-003-agent-protocol.10)
// =============================================================================

// §FS-003-agent-protocol.10.3: tiered verbosity, cheapest first.
export type ExploreDebugLevel = "off" | "metadata" | "full";

// §FS-003-agent-protocol.10: an observed tool call (or product) of the explore agent. This is an
// out-of-band observation for the operator/logs — it never reaches the caller model (§10.4, §11.4).
export interface ExploreDebugEvent {
	type: "tool_call" | "product";
	// tool_call: status is "ok" | "error". product: status is "ok" | "aborted" (the sub-agent
	// errored or was aborted before producing a result).
	tool?: string;
	ordinal?: number;
	phase?: "start" | "end";
	status?: "ok" | "error" | "aborted";
	durationMs?: number;
	args?: unknown; // full level only (§10.3)
	resultPreview?: string; // full level only (§10.3)
	// product:
	// The current sub-agent returns free-form text, not structured NodeRefs (AR-001 future work),
	// so we report whether it produced output rather than a real node count.
	producedOutput?: boolean;
	summaryPreview?: string;
}

export type ExploreDebugSink = (event: ExploreDebugEvent) => void;

// §FS-003-agent-protocol.10.3: off by default; "1"/"true"/"yes"/"metadata" -> metadata; "full" -> full.
export function exploreDebugLevel(): ExploreDebugLevel {
	const raw = process.env.PI_EXPLORE_DEBUG?.trim().toLowerCase();
	if (!raw || raw === "off" || raw === "0" || raw === "false" || raw === "no") {
		return "off";
	}
	return raw === "full" ? "full" : "metadata";
}

// Tests and embedders may capture events directly instead of reading the log file.
let debugSinkOverride: ExploreDebugSink | undefined;
export function setExploreDebugSink(sink: ExploreDebugSink | undefined): void {
	debugSinkOverride = sink;
}

function previewPayload(value: unknown): string {
	let text: string;
	try {
		text = typeof value === "string" ? value : JSON.stringify(value);
	} catch {
		text = String(value);
	}
	if (text === undefined) {
		return "";
	}
	if (text.length <= DEBUG_PAYLOAD_PREVIEW_BYTES) {
		return text;
	}
	// §FS-003-agent-protocol.10.3 / §FS-002-caller-context.6.1: never dump unbounded; state truncation.
	return `${text.slice(0, DEBUG_PAYLOAD_PREVIEW_BYTES)}… [truncated ${text.length - DEBUG_PAYLOAD_PREVIEW_BYTES} bytes]`;
}

// Serialize appends through one chain so concurrent events cannot interleave in the JSONL file.
let debugLogChain: Promise<void> = Promise.resolve();

// §FS-003-agent-protocol.10.4: the default out-of-band sink appends JSONL to the debug log.
// §FS-003-agent-protocol.10.6: passive — every failure is swallowed so it never affects the run.
function defaultExploreDebugSink(cwd: string): ExploreDebugSink {
	return (event) => {
		try {
			const line = `${JSON.stringify({ ts: new Date().toISOString(), cwd, ...event })}\n`;
			const path = getExploreDebugLogPath();
			debugLogChain = debugLogChain
				.then(() => mkdir(dirname(path), { recursive: true }))
				.then(() => appendFile(path, line))
				.catch(() => {});
		} catch {}
	};
}

function resolveExploreDebugSink(cwd: string): ExploreDebugSink {
	return debugSinkOverride ?? defaultExploreDebugSink(cwd);
}

// §FS-003-agent-protocol.10.1: observation only — the wrapped tools return identical results.
// §FS-003-agent-protocol.10.2: each call reports name, ordinal, timing, and status.
function instrumentToolsForDebug(tools: AgentTool[], level: ExploreDebugLevel, sink: ExploreDebugSink): AgentTool[] {
	if (level === "off") {
		return tools;
	}
	const safeEmit = (event: ExploreDebugEvent) => {
		try {
			sink(event);
		} catch {}
	};
	let ordinal = 0;
	return tools.map((tool) => ({
		...tool,
		execute: async (toolCallId, params, signal, onUpdate) => {
			const n = ++ordinal;
			const startedAt = Date.now();
			safeEmit({
				type: "tool_call",
				tool: tool.name,
				ordinal: n,
				phase: "start",
				args: level === "full" ? params : undefined,
			});
			try {
				const result = await tool.execute(toolCallId, params, signal, onUpdate);
				safeEmit({
					type: "tool_call",
					tool: tool.name,
					ordinal: n,
					phase: "end",
					status: "ok",
					durationMs: Date.now() - startedAt,
					resultPreview: level === "full" ? previewPayload(getToolResultText(result)) : undefined,
				});
				return result;
			} catch (error) {
				safeEmit({
					type: "tool_call",
					tool: tool.name,
					ordinal: n,
					phase: "end",
					status: "error",
					durationMs: Date.now() - startedAt,
					resultPreview:
						level === "full" ? previewPayload(error instanceof Error ? error.message : String(error)) : undefined,
				});
				throw error;
			}
		},
	}));
}

function getToolResultText(result: { content: (TextContent | ImageContent)[] }): string {
	return result.content
		.filter((part): part is TextContent => part.type === "text")
		.map((part) => part.text)
		.join("\n");
}

const exploreSchema = Type.Object({
	task: Type.String({
		description:
			"File exploration task. Describe what needs to be found, understood, or read. Include symbols, paths, or behavior when known.",
	}),
	paths: Type.Optional(
		Type.Array(Type.String(), {
			description: "Optional file or directory paths to focus exploration on.",
		}),
	),
	wholeFiles: Type.Optional(
		Type.Boolean({
			description: "Fetch whole nodes/files instead of targeted subsets. Set true when you need — or will soon need — most of a file: fetching it whole once is cheaper than repeated partial fetches.",
		}),
	),
	maxSnippets: Type.Optional(
		Type.Number({
			description: `Maximum number of relevant snippets to return. Default: ${DEFAULT_MAX_SNIPPETS}.`,
		}),
	),
});

export type ExploreToolInput = Static<typeof exploreSchema>;

export interface ExploreToolDetails {
	backend: "graphify" | "filesystem";
	graphifyAvailable: boolean;
	sidekickUsed: boolean;
	truncation?: TruncationResult;
}

interface CommandResult {
	stdout: string;
	stderr: string;
	code: number | null;
	timedOut: boolean;
}

interface Snippet {
	path: string;
	startLine: number;
	endLine: number;
	text: string;
	score: number;
}

interface FileContentResult {
	text: string;
	truncation?: TruncationResult;
}

function toPosixPath(filePath: string): string {
	return filePath.split(sep).join("/");
}

function relativeToCwd(filePath: string, cwd: string): string {
	return toPosixPath(formatPathRelativeToCwdOrAbsolute(filePath, cwd));
}

function clampSnippetCount(value: number | undefined): number {
	if (value === undefined || !Number.isFinite(value)) {
		return DEFAULT_MAX_SNIPPETS;
	}
	return Math.max(1, Math.min(30, Math.floor(value)));
}

function splitTerms(task: string): string[] {
	const terms = task
		.toLowerCase()
		.split(/[^a-z0-9_.$/-]+/)
		.map((term) => term.trim())
		.filter((term) => term.length >= 3 && !["the", "and", "for", "with", "from", "that", "this"].includes(term));
	return [...new Set(terms)].slice(0, 20);
}

function isLikelyTextFile(filePath: string): boolean {
	const ext = extname(filePath).toLowerCase();
	if (!ext) return true;
	return new Set([
		".bat",
		".c",
		".cc",
		".cpp",
		".css",
		".go",
		".h",
		".hpp",
		".html",
		".java",
		".js",
		".json",
		".jsonl",
		".jsx",
		".md",
		".mjs",
		".ps1",
		".py",
		".rb",
		".rs",
		".sh",
		".sql",
		".ts",
		".tsx",
		".txt",
		".yml",
		".yaml",
	]).has(ext);
}

function shouldSkipDir(name: string): boolean {
	return new Set([".git", "node_modules", "dist", "build", "coverage", ".next", ".turbo", ".cache"]).has(name);
}

async function runCommand(
	command: string,
	args: string[],
	options: { cwd: string; signal?: AbortSignal; timeoutMs: number },
): Promise<CommandResult> {
	return new Promise((resolve) => {
		let stdout = "";
		let stderr = "";
		let timedOut = false;
		let settled = false;
		const child = spawn(command, args, {
			cwd: options.cwd,
			stdio: ["ignore", "pipe", "pipe"],
			signal: options.signal,
		});

		const timer = setTimeout(() => {
			timedOut = true;
			child.kill("SIGTERM");
		}, options.timeoutMs);

		const settle = (result: CommandResult) => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			resolve(result);
		};

		child.stdout?.on("data", (chunk: Buffer) => {
			if (stdout.length < MAX_TOOL_OUTPUT_BYTES) {
				stdout += chunk.toString("utf-8");
			}
		});
		child.stderr?.on("data", (chunk: Buffer) => {
			if (stderr.length < MAX_TOOL_OUTPUT_BYTES) {
				stderr += chunk.toString("utf-8");
			}
		});
		child.on("error", (error: NodeJS.ErrnoException) => {
			settle({ stdout, stderr: error.message, code: null, timedOut });
		});
		child.on("close", (code) => {
			settle({ stdout, stderr, code, timedOut });
		});
	});
}

async function commandAvailable(command: string, cwd: string, signal?: AbortSignal): Promise<boolean> {
	const result = await runCommand(command, ["--help"], { cwd, signal, timeoutMs: 2_000 });
	return result.code === 0;
}

async function readTextFile(absolutePath: string): Promise<string> {
	const buffer = await readFile(absolutePath);
	return buffer.toString("utf-8");
}

async function fetchFileContent(rawPath: string, cwd: string): Promise<FileContentResult> {
	const absolutePath = await resolveReadPathAsync(rawPath, cwd);
	const content = await readTextFile(absolutePath);
	const truncation = truncateHead(content);
	let text = truncation.content;
	if (truncation.truncated) {
		text += `\n\n[Truncated: showing ${truncation.outputLines} lines (${formatSize(truncation.maxBytes ?? DEFAULT_MAX_BYTES)} limit).]`;
	}
	return {
		text: `<file path="${relativeToCwd(absolutePath, cwd)}">\n${text}\n</file>`,
		truncation: truncation.truncated ? truncation : undefined,
	};
}

async function walkFiles(roots: string[], cwd: string): Promise<string[]> {
	const files: string[] = [];
	const stack = roots.map((root) => resolveToCwd(root, cwd));
	while (stack.length > 0 && files.length < MAX_FALLBACK_FILES) {
		const current = stack.pop();
		if (!current) continue;
		const currentStat = await stat(current).catch(() => undefined);
		if (!currentStat) {
			continue;
		}
		if (currentStat.isFile()) {
			if (isLikelyTextFile(current)) {
				files.push(current);
			}
			continue;
		}
		if (!currentStat.isDirectory()) continue;
		const entries = await readdir(current, { withFileTypes: true }).catch(() => undefined);
		if (!entries) {
			continue;
		}
		for (const entry of entries.reverse()) {
			if (entry.isDirectory() && shouldSkipDir(entry.name)) {
				continue;
			}
			stack.push(resolvePath(current, entry.name));
		}
	}
	return files;
}

function scorePath(filePath: string, terms: string[]): number {
	const lower = filePath.toLowerCase();
	return terms.reduce((score, term) => score + (lower.includes(term) ? 4 : 0), 0);
}

function findSnippetsInFile(filePath: string, content: string, terms: string[], cwd: string): Snippet[] {
	const lines = content.split("\n");
	const snippets: Snippet[] = [];
	for (let i = 0; i < lines.length; i++) {
		const lowerLine = lines[i].toLowerCase();
		let score = scorePath(filePath, terms);
		for (const term of terms) {
			if (lowerLine.includes(term)) {
				score += 8;
			}
		}
		if (score <= 0) continue;
		const start = Math.max(0, i - SNIPPET_CONTEXT_LINES);
		const end = Math.min(lines.length, i + SNIPPET_CONTEXT_LINES + 1);
		const text = lines
			.slice(start, end)
			.map((line, index) => `${start + index + 1}: ${truncateLine(line).text}`)
			.join("\n");
		snippets.push({
			path: relativeToCwd(filePath, cwd),
			startLine: start + 1,
			endLine: end,
			text,
			score,
		});
	}
	return snippets;
}

async function fallbackSearch(
	task: string,
	paths: string[] | undefined,
	cwd: string,
	maxSnippets: number,
): Promise<string> {
	const terms = splitTerms(task);
	if (terms.length === 0 && (!paths || paths.length === 0)) {
		return "Filesystem fallback needs search terms or paths. Ask for a more specific exploration target.";
	}
	const roots = paths && paths.length > 0 ? paths : ["."];
	const files = await walkFiles(roots, cwd);
	const snippets: Snippet[] = [];
	for (const file of files) {
		try {
			const content = await readTextFile(file);
			snippets.push(...findSnippetsInFile(file, content, terms, cwd));
		} catch {}
	}
	const ranked = snippets.sort((a, b) => b.score - a.score).slice(0, maxSnippets);
	if (ranked.length === 0) {
		const candidateFiles = files
			.map((file) => ({ file, score: scorePath(file, terms) }))
			.filter((entry) => entry.score > 0)
			.sort((a, b) => b.score - a.score)
			.slice(0, maxSnippets);
		if (candidateFiles.length === 0) {
			return "No relevant filesystem snippets found.";
		}
		return candidateFiles.map((entry) => `- ${relativeToCwd(entry.file, cwd)}`).join("\n");
	}
	return ranked
		.map((snippet) => `## ${snippet.path}:${snippet.startLine}-${snippet.endLine}\n${snippet.text}`)
		.join("\n\n");
}

// graphify exits 0 on failure, printing an error/empty-result line to stdout. Treat those as
// "no result" so callers fall back instead of relaying noise to the model.
function isGraphifyFailureOutput(stdout: string): boolean {
	const text = stdout.trim();
	if (!text) return true;
	return /^error:/i.test(text) || /^no node matching/i.test(text);
}

// §AR-001-ensemble-explore.5 / §FS-001-ensemble-explore.7.1: backend for the real graphify
// CLI (github.com/safishamsi/graphify). The graph is built offline by `update` (AST, no LLM)
// into <cwd>/graphify-out/graph.json; `query`/`explain` traverse it and return node structure.
class GraphifyBackend {
	private readonly cwd: string;
	private availableCache: boolean | undefined;

	constructor(cwd: string) {
		this.cwd = cwd;
	}

	private graphFile(): string {
		return resolvePath(this.cwd, GRAPHIFY_OUT_DIR, GRAPHIFY_GRAPH_FILE);
	}

	async isAvailable(signal?: AbortSignal): Promise<boolean> {
		if (this.availableCache !== undefined) {
			return this.availableCache;
		}
		this.availableCache = await commandAvailable(graphifyCommand(), this.cwd, signal);
		return this.availableCache;
	}

	async prepare(signal?: AbortSignal): Promise<boolean> {
		if (!(await this.isAvailable(signal))) {
			return false;
		}
		// `update` builds the graph when absent and re-extracts when present; both run offline.
		let hasGraph = false;
		try {
			await access(this.graphFile());
			hasGraph = true;
		} catch {
			hasGraph = false;
		}
		const timeoutMs = hasGraph ? GRAPHIFY_TIMEOUT_MS : GRAPHIFY_BUILD_TIMEOUT_MS;
		const result = await runCommand(graphifyCommand(), ["update", this.cwd], {
			cwd: this.cwd,
			signal,
			timeoutMs,
		});
		return result.code === 0;
	}

	async query(question: string, signal?: AbortSignal): Promise<string | undefined> {
		if (!(await this.prepare(signal))) {
			return undefined;
		}
		const result = await runCommand(
			graphifyCommand(),
			["query", question, "--graph", this.graphFile(), "--budget", "2400"],
			{ cwd: this.cwd, signal, timeoutMs: GRAPHIFY_TIMEOUT_MS },
		);
		if (result.code !== 0 || isGraphifyFailureOutput(result.stdout)) {
			return undefined;
		}
		return result.stdout.trim();
	}

	async explain(node: string, signal?: AbortSignal): Promise<string | undefined> {
		if (!(await this.prepare(signal))) {
			return undefined;
		}
		const result = await runCommand(graphifyCommand(), ["explain", node, "--graph", this.graphFile()], {
			cwd: this.cwd,
			signal,
			timeoutMs: GRAPHIFY_TIMEOUT_MS,
		});
		if (result.code !== 0 || isGraphifyFailureOutput(result.stdout)) {
			return undefined;
		}
		return result.stdout.trim();
	}

	// graphify has no `stats` command; summarize the built graph.json node/edge counts instead.
	async stats(signal?: AbortSignal): Promise<string | undefined> {
		if (!(await this.prepare(signal))) {
			return undefined;
		}
		try {
			const raw = await readFile(this.graphFile(), "utf-8");
			const graph = JSON.parse(raw) as { nodes?: unknown[]; links?: unknown[] };
			const nodes = Array.isArray(graph.nodes) ? graph.nodes.length : 0;
			const edges = Array.isArray(graph.links) ? graph.links.length : 0;
			return `graphify graph: ${nodes} nodes, ${edges} edges (${relativeToCwd(this.graphFile(), this.cwd)}).`;
		} catch {
			return undefined;
		}
	}
}

function makeTextTool<TParams extends TSchema>(
	name: string,
	description: string,
	parameters: TParams,
	execute: (params: Static<TParams>, signal?: AbortSignal) => Promise<string>,
): AgentTool<TParams> {
	return {
		name,
		label: name,
		description,
		parameters,
		execute: async (_toolCallId, params, signal) => ({
			content: [{ type: "text", text: await execute(params as Static<TParams>, signal) }],
			details: undefined,
			isError: false,
		}),
	};
}

// The explore sidekick's system prompt. Exported so harnesses can capture the exact
// instructions a run used; the two variants are graph-backed vs filesystem fallback.
export function exploreSidekickSystemPrompt(graphifyAvailable: boolean): string {
	// §FS-002-caller-context.8: announce the capability, push no content.
	const callerContextLine =
		'You may call caller_context to read the calling agent\'s transcript, its prior tool results and files, its system prompt, or the user\'s original request — op:"index" to survey, then op:"fetch" by ids/recency/query. Take only what you need.';
	return graphifyAvailable
		? [
				"You are Pi's private exploration sidekick.",
				"Explore only through the graph tools; do not read raw file contents.",
				"Think carefully about what the task genuinely needs before fetching. Select the minimal set of nodes that answers it; do not pull in neighboring or related nodes speculatively.",
				"Prefer fetching a whole node or file once when the task will need most of it, over many partial fetches of the same file — repeated partial fetches cost the caller more than one whole fetch.",
				"Return the relevant graph nodes exactly as the tools provide them — do not trim, reformat, summarize, or otherwise post-process their contents (your job is to choose which nodes to fetch, not to edit their bodies).",
				callerContextLine,
				"Do not propose edits. Do not answer the user directly.",
			].join("\n")
		: [
				"You are Pi's private exploration sidekick.",
				"The code graph is unavailable; you are working from raw filesystem results.",
				"Think carefully about what the task genuinely needs, then return only that.",
				"Return only the code relevant to the task and remove everything unnecessary.",
				"Remove whole declarations — fields, functions, methods, comments — that are not relevant to the task.",
				"If the task needs most of a file, return the whole file once rather than scattered fragments; if only a small part is relevant, return just that part.",
				"Never remove or alter code inside a function body you keep; reproduce kept bodies verbatim.",
				"Keep enough enclosing context (such as the class or module header) to locate what you return.",
				callerContextLine,
				"Do not propose edits. Do not answer the user directly.",
			].join("\n");
}

// §FS-001-ensemble-explore.2.1 / .5.6: the sidekick is backend-conditional — with graphify it
// relays graph nodes unchanged (no post-processing); without it, it reads raw files and trims
// them coarse-grained (whole declarations only, never inside a retained body).
async function runSidekick(
	input: ExploreToolInput,
	context: ExtensionContext,
	backend: GraphifyBackend,
	maxSnippets: number,
	graphifyAvailable: boolean,
	requireGraph: boolean,
	signal?: AbortSignal,
): Promise<string | undefined> {
	const model = context.model;
	if (!model) {
		return undefined;
	}

	const graphQuerySchema = Type.Object({ question: Type.String() });
	const graphExplainSchema = Type.Object({ node: Type.String() });
	const graphFetchNodeSchema = Type.Object({ node: Type.String() });
	const graphStatsSchema = Type.Object({});

	// §FS-001-ensemble-explore.7.4.4: in required-graph mode a runtime graph miss never degrades to
	// the filesystem; it surfaces an explicit no-result instead so the caller only ever sees
	// graph-derived content.
	const graphQueryTool = makeTextTool(
		"graph_query",
		"Query the code knowledge graph for relevant nodes and relationships.",
		graphQuerySchema,
		async ({ question }, toolSignal) => {
			const result = await backend.query(question, toolSignal);
			if (result !== undefined) {
				return result;
			}
			return requireGraph
				? `No graph result for "${question}". (Required-graph mode: filesystem fallback disabled.)`
				: fallbackSearch(question, input.paths, context.cwd, maxSnippets);
		},
	);
	const graphExplainTool = makeTextTool(
		"graph_explain",
		"Explain a graph node and its neighboring code relationships.",
		graphExplainSchema,
		async ({ node }, toolSignal) => {
			const result = await backend.explain(node, toolSignal);
			if (result !== undefined) {
				return result;
			}
			return requireGraph
				? `No graph result for "${node}". (Required-graph mode: filesystem fallback disabled.)`
				: fallbackSearch(node, input.paths, context.cwd, maxSnippets);
		},
	);
	const graphFetchNodeTool = makeTextTool(
		"graph_fetch_node",
		"Fetch full content for a graph node or file path so it can be trimmed to the relevant code.",
		graphFetchNodeSchema,
		async ({ node }) => {
			try {
				return (await fetchFileContent(node, context.cwd)).text;
			} catch (error) {
				return `Unable to fetch node "${node}": ${error instanceof Error ? error.message : String(error)}`;
			}
		},
	);
	const graphStatsTool = makeTextTool(
		"graph_stats",
		"Inspect code graph availability and size.",
		graphStatsSchema,
		async (params, toolSignal) => {
			void params;
			return (await backend.stats(toolSignal)) ?? "Graphify is not available; using filesystem nodes.";
		},
	);

	// Graph present: navigate + explain, relay nodes verbatim (no raw-file fetch).
	// Graph absent: search + fetch raw files so the sidekick can trim them itself.
	// Both modes also get caller_context (§FS-002-caller-context.9): read the caller's context.
	const callerContextTool = createCallerContextTool(context);
	const baseTools: AgentTool[] = graphifyAvailable
		? [graphQueryTool, graphExplainTool, graphStatsTool, callerContextTool]
		: [graphQueryTool, graphFetchNodeTool, graphStatsTool, callerContextTool];

	// §FS-003-agent-protocol.10: when debug is enabled, observe the sub-agent's tool calls through
	// an out-of-band sink. Observation is passive (§10.6) and changes neither the toolset's
	// behaviour nor the product (§10.1, §11.4).
	const debugLevel = exploreDebugLevel();
	const debugSink = debugLevel === "off" ? undefined : resolveExploreDebugSink(context.cwd);
	const tools = debugSink ? instrumentToolsForDebug(baseTools, debugLevel, debugSink) : baseTools;

	const systemPrompt = exploreSidekickSystemPrompt(graphifyAvailable);

	const thinkingLevel = clampThinkingLevel(model, "low") as ThinkingLevel;
	const sidekick = new Agent({
		initialState: {
			systemPrompt,
			model,
			thinkingLevel,
			tools,
			messages: [],
		},
		streamFn: async (streamModel, messages, options) => {
			const auth = await context.modelRegistry.getApiKeyAndHeaders(streamModel as Model<Api>);
			if (!auth.ok) {
				throw new Error(auth.error);
			}
			return streamSimple(streamModel, messages, {
				...options,
				apiKey: auth.apiKey,
				headers: auth.headers || options?.headers ? { ...auth.headers, ...options?.headers } : undefined,
			});
		},
		convertToLlm,
		toolExecution: "sequential",
	});
	const abortSidekick = () => sidekick.abort();
	signal?.addEventListener("abort", abortSidekick, { once: true });
	try {
		const focus = input.paths && input.paths.length > 0 ? `\nFocus paths: ${input.paths.join(", ")}` : "";
		const wholeFiles = input.wholeFiles ? "\nFetch whole graph nodes/files when they are relevant." : "";
		await sidekick.prompt(
			`Explore this task and return relevant code evidence only:\n${input.task}${focus}${wholeFiles}`,
		);
		// §FS-003-agent-protocol.10.2: always report a terminal product event so the trace shows the
		// full path from tools called to the outcome — including the abort/error case (§10.6).
		const emitProduct = (status: "ok" | "aborted", text?: string) => {
			if (!debugSink) {
				return;
			}
			try {
				debugSink({
					type: "product",
					status,
					producedOutput: !!text && text.length > 0,
					summaryPreview: debugLevel === "full" ? previewPayload(text ?? "") : undefined,
				});
			} catch {}
		};
		const last = sidekick.state.messages
			.slice()
			.reverse()
			.find((message) => message.role === "assistant");
		if (!last || last.role !== "assistant" || last.stopReason === "error" || last.stopReason === "aborted") {
			emitProduct("aborted");
			return undefined;
		}
		const text = last.content
			.filter((content): content is TextContent => content.type === "text")
			.map((content) => content.text)
			.join("\n")
			.trim();
		emitProduct("ok", text);
		return text.length > 0 ? text : undefined;
	} finally {
		signal?.removeEventListener("abort", abortSidekick);
	}
}

function formatExploreCall(args: Partial<ExploreToolInput> | undefined, theme: Theme, cwd: string): string {
	const task = str(args?.task);
	const paths = args?.paths;
	const pathDisplay =
		paths && paths.length > 0
			? paths.map((path) => renderToolPath(path, theme, cwd)).join(", ")
			: theme.fg("muted", ".");
	return `${theme.fg("toolTitle", theme.bold("explore"))} ${task ?? ""} ${theme.fg("toolOutput", "in")} ${pathDisplay}`;
}

function formatExploreResult(
	result: { content: (TextContent | ImageContent)[]; details?: ExploreToolDetails },
	options: ToolRenderResultOptions,
	theme: Theme,
	showImages: boolean,
): string {
	const output = getTextOutput(result, showImages).trim();
	if (!output) {
		return "";
	}
	const lines = output.split("\n");
	const maxLines = options.expanded ? lines.length : 18;
	const displayLines = lines.slice(0, maxLines);
	const remaining = lines.length - maxLines;
	let text = `\n${displayLines.map((line) => theme.fg("toolOutput", replaceTabs(line))).join("\n")}`;
	if (remaining > 0) {
		text += `${theme.fg("muted", `\n... (${remaining} more lines,`)} ${keyHint("app.tools.expand", "to expand")})`;
	}
	const backend = result.details?.backend;
	if (backend === "filesystem") {
		text += `\n${theme.fg("muted", "[Graphify unavailable; used filesystem nodes]")}`;
	}
	return text;
}

// §FS-001-ensemble-explore: graph-only node selection + dedup against caller context.
// Mechanism (sidekick/NodeRef/registry/assembly): §AR-001-ensemble-explore.
export function createExploreToolDefinition(
	cwd: string,
): ToolDefinition<typeof exploreSchema, ExploreToolDetails | undefined> {
	return {
		name: "explore",
		label: "explore",
		description:
			"Delegate code discovery to a smart explore sub-agent. Describe in natural language what you need to find, understand, or read; it navigates the code graph and returns small, targeted subsets — the specific functions, types, or lines relevant to your task, not whole files. One well-described explore call replaces many manual grep/find/sed reads: it batches the search and returns only what matters, which keeps your context small. Set wholeFiles: true only when you genuinely need complete file content (e.g. before a large edit).",
		promptSnippet: "Delegate discovery to a smart explore sub-agent; it returns the minimal relevant code",
		promptGuidelines: [
			"Prefer one explore call over several bash grep/find/cat/sed reads — describe the target and let the sub-agent fetch the minimal relevant code in a single round-trip.",
			"Trust the explore result: do not re-grep or re-read code it already returned.",
			"Use explore for discovery, search, reading, and pre-edit inspection; reach for bash file-reading only when explore fails or the user explicitly asks for shell output.",
			"When you know you will need an entire file (e.g. a large or cross-cutting edit), ask for it with wholeFiles: true rather than fetching it in pieces across several calls.",
		],
		parameters: exploreSchema,
		async execute(_toolCallId, input: ExploreToolInput, signal, _onUpdate, context) {
			const maxSnippets = clampSnippetCount(input.maxSnippets);
			const requireGraph = requireGraphMode();
			const backend = new GraphifyBackend(cwd);
			const graphifyAvailable = await backend.isAvailable(signal);
			// §FS-001-ensemble-explore.7.4.2/.7.4.3: required-graph mode never degrades. If the backend
			// is not enabled (including mid-session loss after a clean start), fail fast rather than
			// falling back to the filesystem. Throwing surfaces the precondition to the caller as a
			// tool error instead of silently returning filesystem-derived content.
			if (requireGraph && !graphifyAvailable) {
				throw new Error(requireGraphUnavailableMessage(cwd));
			}
			if (input.wholeFiles && input.paths && input.paths.length > 0) {
				const contents: string[] = [];
				let truncation: TruncationResult | undefined;
				for (const path of input.paths) {
					const result = await fetchFileContent(path, cwd);
					contents.push(result.text);
					truncation = truncation ?? result.truncation;
				}
				return {
					content: [{ type: "text", text: contents.join("\n\n") }],
					details: {
						backend: graphifyAvailable ? "graphify" : "filesystem",
						graphifyAvailable,
						sidekickUsed: false,
						truncation,
					},
				};
			}

			const sidekickText = context
				? await runSidekick(input, context, backend, maxSnippets, graphifyAvailable, requireGraph, signal)
				: undefined;
			if (sidekickText) {
				return {
					content: [{ type: "text", text: sidekickText }],
					details: {
						backend: graphifyAvailable ? "graphify" : "filesystem",
						graphifyAvailable,
						sidekickUsed: true,
					},
				};
			}

			// §FS-001-ensemble-explore.7.4.4: with the backend enabled but no sidekick result, fall back
			// to a direct backend query — never to the filesystem in required-graph mode.
			const fallbackText = requireGraph
				? ((await backend.query(input.task, signal)) ??
					`No graph result for "${input.task}". (Required-graph mode: filesystem fallback disabled.)`)
				: ((await backend.query(input.task, signal)) ??
					(await fallbackSearch(input.task, input.paths, cwd, maxSnippets)));
			return {
				content: [{ type: "text", text: fallbackText }],
				details: {
					backend: graphifyAvailable ? "graphify" : "filesystem",
					graphifyAvailable,
					sidekickUsed: false,
				},
			};
		},
		renderCall(args, theme, context) {
			const text = (context.lastComponent as Text | undefined) ?? new Text("", 0, 0);
			text.setText(formatExploreCall(args, theme, context.cwd));
			return text;
		},
		renderResult(result, options, theme, context) {
			const text = (context.lastComponent as Text | undefined) ?? new Text("", 0, 0);
			text.setText(formatExploreResult(result, options, theme, context.showImages));
			return text;
		},
	};
}

export function createExploreTool(cwd: string): AgentTool<typeof exploreSchema> {
	return wrapToolDefinition(createExploreToolDefinition(cwd));
}
