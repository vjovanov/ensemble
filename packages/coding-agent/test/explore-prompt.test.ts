import { describe, expect, test } from "vitest";
import { exploreSidekickSystemPrompt } from "../src/core/tools/explore.ts";

describe("explore sidekick prompt", () => {
	test("caps first-pass evidence and discourages file dumps", () => {
		const prompt = exploreSidekickSystemPrompt(true);

		expect(prompt).toContain("Default output budget: <= 120 lines total and <= 4 code excerpts.");
		expect(prompt).toContain("Never return an entire file, class, or long method");
		expect(prompt).toContain("If a tool result is large, summarize what it proves");
		expect(prompt).toContain("ignore the breadth and return a narrow evidence set instead");
	});

	test("steers C-family local bugs toward rg-style search before graph traversal", () => {
		const prompt = exploreSidekickSystemPrompt(true);

		expect(prompt).toContain("For C/C++ local bugs");
		expect(prompt).toContain("use `search` like `rg` first");
		expect(prompt).toContain("Then use `source_slice` like `sed -n`");
		expect(prompt).toContain("Use graph traversal only when control flow or cross-file relationships remain unclear");
	});

	test("tightens evidence when caller context is already large", () => {
		const prompt = exploreSidekickSystemPrompt(true, "high");

		expect(prompt).toContain("The caller's context is already large");
		expect(prompt).toContain("avoid adding bulk");
		expect(prompt).not.toContain("prefer returning a fuller evidence set");
	});
});
