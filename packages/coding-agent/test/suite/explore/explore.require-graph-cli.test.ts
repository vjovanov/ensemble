import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ENV_AGENT_DIR } from "../../../src/config.ts";

// §FS-001-ensemble-explore.7.4.2: required-graph mode is a hard startup precondition. When graphify
// is not enabled, the CLI must refuse to start (exit 1) rather than run degraded. These tests drive
// the real `main()` startup path with graphify pointed at a missing binary.

const cliPath = resolve(__dirname, "../../../src/cli.ts");
const tempDirs: string[] = [];

afterEach(() => {
	for (const dir of tempDirs.splice(0)) {
		rmSync(dir, { recursive: true, force: true });
	}
});

interface CliResult {
	code: number | null;
	signal: NodeJS.Signals | null;
	stderr: string;
}

function setup(): { agentDir: string; projectDir: string } {
	const tempRoot = mkdtempSync(join(tmpdir(), "pi-require-graph-"));
	tempDirs.push(tempRoot);
	const dirs = { agentDir: join(tempRoot, "agent"), projectDir: join(tempRoot, "project") };
	mkdirSync(dirs.agentDir, { recursive: true });
	mkdirSync(dirs.projectDir, { recursive: true });
	return dirs;
}

async function runCli(
	args: string[],
	dirs: { agentDir: string; projectDir: string },
	extraEnv: Record<string, string>,
): Promise<CliResult> {
	let stderr = "";
	const child = spawn(process.execPath, [cliPath, ...args], {
		cwd: dirs.projectDir,
		env: {
			...process.env,
			[ENV_AGENT_DIR]: dirs.agentDir,
			PI_OFFLINE: "1",
			TSX_TSCONFIG_PATH: resolve(__dirname, "../../../../../tsconfig.json"),
			...extraEnv,
		},
		stdio: ["ignore", "ignore", "pipe"],
	});
	child.stderr.on("data", (chunk) => {
		stderr += chunk.toString();
	});

	return new Promise((resolvePromise, reject) => {
		const timeout = setTimeout(() => child.kill("SIGKILL"), 15_000);
		child.on("error", (error) => {
			clearTimeout(timeout);
			reject(error);
		});
		child.on("close", (code, signal) => {
			clearTimeout(timeout);
			resolvePromise({ code, signal, stderr });
		});
	});
}

describe("required-graph mode CLI startup gate (§FS-001-ensemble-explore.7.4.2)", () => {
	it("refuses to start (exit 1) with the precondition diagnostic when graphify is absent", async () => {
		const dirs = setup();
		const result = await runCli(["-p", "hi"], dirs, {
			PI_REQUIRE_GRAPH: "1",
			GRAPHIFY_COMMAND: "graphify-absent-xyzzy",
		});

		expect(result.code).toBe(1);
		expect(result.stderr).toContain("Required-graph mode is on (PI_REQUIRE_GRAPH)");
		expect(result.stderr).toContain("graphify");
	});

	it("does not fire the gate when required-graph mode is off", async () => {
		const dirs = setup();
		const result = await runCli(["-p", "hi"], dirs, {
			GRAPHIFY_COMMAND: "graphify-absent-xyzzy",
		});

		// It may still exit non-zero for unrelated reasons (e.g. no model configured), but never with
		// the required-graph precondition message.
		expect(result.stderr).not.toContain("Required-graph mode is on");
	});
});
