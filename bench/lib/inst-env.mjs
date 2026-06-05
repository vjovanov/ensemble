// Print shell variable assignments for an instance json, for `eval "$(...)"`.
// Emits: ID ORG REPO NUMBER SHA LANG  (shell-quoted).
import { readFileSync } from "node:fs";
import { instanceId } from "./build-prompt.mjs";

const inst = JSON.parse(readFileSync(process.argv[2], "utf8"));
const sha = (inst.base && (inst.base.sha || inst.base.commit)) || inst.base || inst.base_commit || "";
const q = (s) => `'${String(s).replace(/'/g, "'\\''")}'`;
const out = {
  ID: instanceId(inst),
  ORG: inst.org ?? "",
  REPO: inst.repo ?? "",
  NUMBER: inst.number ?? "",
  SHA: sha,
  LANG: inst.language ?? inst.lang ?? "",
};
process.stdout.write(Object.entries(out).map(([k, v]) => `${k}=${q(v)}`).join("\n") + "\n");
