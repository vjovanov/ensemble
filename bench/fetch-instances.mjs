// Fetch Multi-SWE-bench instances from HuggingFace and save them under
// bench/instances/. The full ByteDance-Seed/Multi-SWE-bench repo stores data as
// small per-repo jsonl files grouped by language dir (go/, rust/, ts/, java/, …),
// which is far cheaper to pull than the single-file mini/flash variants.
//
// NOTE: Python is empty in this dataset — Multi-SWE-bench is the non-Python
// multilingual complement to the original (Python) SWE-bench.
//
// Usage:
//   node fetch-instances.mjs --list                 # languages + files (+sizes)
//   node fetch-instances.mjs --list rust            # files under one language
//   node fetch-instances.mjs <lang> <idx> [idx...]  # smallest file in <lang>, save those rows
//   node fetch-instances.mjs <path.jsonl> <idx>...  # a specific per-repo file
//
// Env: HF_DATASET (default ByteDance-Seed/Multi-SWE-bench), INST_DIR, MAX_FILE_MB.

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { instanceId } from "./lib/build-prompt.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const DATASET = process.env.HF_DATASET || "ByteDance-Seed/Multi-SWE-bench";
const INST_DIR = process.env.INST_DIR || join(HERE, "instances");
const MAX_FILE_MB = Number(process.env.MAX_FILE_MB || 25);
const TREE = `https://huggingface.co/api/datasets/${DATASET}/tree/main?recursive=true`;
const resolveUrl = (p) => `https://huggingface.co/datasets/${DATASET}/resolve/main/${p}`;

async function getJSON(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`HTTP ${r.status} for ${url}`);
  return r.json();
}

async function dataFiles() {
  const tree = await getJSON(TREE);
  return tree
    .filter((f) => f.type === "file" && f.path.endsWith(".jsonl") && f.path.includes("/"))
    .map((f) => ({ path: f.path, size: f.size || 0, lang: f.path.split("/")[0] }))
    .filter((f) => f.size > 0); // python/ is an empty placeholder
}

function pickFile(files, langOrPath) {
  if (langOrPath.includes("/")) {
    const hit = files.find((f) => f.path === langOrPath);
    if (!hit) throw new Error(`no such data file: ${langOrPath}`);
    return hit;
  }
  const inLang = files.filter((f) => f.lang === langOrPath).sort((a, b) => a.size - b.size);
  if (!inLang.length) throw new Error(`no files for language "${langOrPath}". Languages: ${[...new Set(files.map((f) => f.lang))].join(", ")}`);
  return inLang[0]; // smallest = cheapest to pull and graph
}

async function loadRows(file) {
  if (file.size > MAX_FILE_MB * 1e6) {
    throw new Error(`${file.path} is ${(file.size / 1e6).toFixed(0)}MB > MAX_FILE_MB=${MAX_FILE_MB}. Pick a smaller repo or raise MAX_FILE_MB.`);
  }
  const text = await (await fetch(resolveUrl(file.path))).text();
  return text.split("\n").filter(Boolean).map((l) => JSON.parse(l));
}

async function main() {
  const argv = process.argv.slice(2);
  const files = await dataFiles();

  if (argv[0] === "--list") {
    const lang = argv[1];
    const show = lang ? files.filter((f) => f.lang === lang) : files;
    if (!lang) {
      const byLang = {};
      for (const f of files) (byLang[f.lang] ||= []).push(f);
      console.log(`Dataset: ${DATASET}`);
      for (const [l, fs] of Object.entries(byLang)) console.log(`  ${l.padEnd(8)} ${fs.length} repos (smallest: ${fs.sort((a, b) => a.size - b.size)[0].path.split("/")[1]})`);
      console.log(`\nPreview a language:  node fetch-instances.mjs --list rust`);
      return;
    }
    show.sort((a, b) => a.size - b.size).forEach((f) => console.log(`${(f.size / 1024).toFixed(0).padStart(7)}KB  ${f.path}`));
    return;
  }

  const [target, ...idxs] = argv;
  if (!target || idxs.length === 0) {
    console.error("usage: node fetch-instances.mjs <lang|path.jsonl> <index> [index...]   (or --list)");
    process.exit(2);
  }
  const file = pickFile(files, target);
  console.log(`file: ${file.path} (${(file.size / 1024).toFixed(0)}KB)`);
  const rows = await loadRows(file);
  console.log(`  ${rows.length} instances in file`);
  mkdirSync(INST_DIR, { recursive: true });
  for (const idx of idxs.map(Number)) {
    const row = rows[idx];
    if (!row) { console.error(`! no instance at index ${idx} (file has ${rows.length})`); continue; }
    row.language = row.language || file.lang;
    const id = instanceId(row);
    const out = join(INST_DIR, `${id}.json`);
    writeFileSync(out, JSON.stringify(row, null, 2));
    console.log(`saved ${out}  (${row.org}/${row.repo}#${row.number}, base ${(row.base?.sha || "?").slice(0, 12)})`);
  }
}

main().catch((e) => { console.error(e.message); process.exit(1); });
