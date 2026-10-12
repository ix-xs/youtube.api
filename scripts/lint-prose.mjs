// House style check for everything that ships or gets read: no long dashes.
// A spaced hyphen, a comma or a new sentence reads better and survives every
// terminal and font.
//
//   node scripts/lint-prose.mjs

import { readFile, readdir } from "node:fs/promises";
import { extname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const SKIP_DIRS = new Set(["node_modules", "dist", ".git", ".astro", "discovery", "coverage"]);
const EXTENSIONS = new Set([".ts", ".mts", ".js", ".mjs", ".cjs", ".json", ".md", ".mdx", ".astro", ".css", ".yml", ".yaml", ".html", ".svg", ".txt"]);
// Built from code points so this file passes its own check.
const FORBIDDEN = new RegExp(`[${String.fromCharCode(0x2013, 0x2014)}]`);

async function* walk(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) yield* walk(join(dir, entry.name));
    } else if (EXTENSIONS.has(extname(entry.name)) && entry.name !== "package-lock.json") {
      yield join(dir, entry.name);
    }
  }
}

let problems = 0;
let files = 0;
for await (const file of walk(root)) {
  files++;
  const lines = (await readFile(file, "utf8")).split("\n");
  lines.forEach((line, index) => {
    if (!FORBIDDEN.test(line)) return;
    problems++;
    console.error(`${relative(root, file)}:${index + 1}: long dash, use " - " or rephrase`);
  });
}

if (problems) {
  console.error(`\n${problems} line${problems === 1 ? "" : "s"} to fix.`);
  process.exit(1);
}
console.log(`prose is clean (${files} files)`);
