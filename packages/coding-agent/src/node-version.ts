const MINIMUM_NODE_VERSION = {
	major: 22,
	minor: 19,
	patch: 0,
} as const;

function parseNodeVersion(version: string): { major: number; minor: number; patch: number } | undefined {
	const match = /^v?(\d+)\.(\d+)\.(\d+)/.exec(version);
	if (!match) return undefined;
	const [, major, minor, patch] = match;
	return {
		major: Number(major),
		minor: Number(minor),
		patch: Number(patch),
	};
}

function supportsCurrentNodeVersion(): boolean {
	const current = parseNodeVersion(process.versions.node);
	if (!current) return false;
	if (current.major !== MINIMUM_NODE_VERSION.major) return current.major > MINIMUM_NODE_VERSION.major;
	if (current.minor !== MINIMUM_NODE_VERSION.minor) return current.minor > MINIMUM_NODE_VERSION.minor;
	return current.patch >= MINIMUM_NODE_VERSION.patch;
}

if (!supportsCurrentNodeVersion()) {
	console.error(`Error: ensemble requires Node.js >= 22.19.0. Current Node.js is ${process.versions.node}.`);
	console.error("Use Node.js 22.19.0 or newer to run this version.");
	process.exit(1);
}

export {};
