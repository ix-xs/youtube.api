// Downloads the current discovery documents from Google and reports what
// changed since the pinned copies: new methods, removed methods, new schemas.
// Run `npm run generate` afterwards, then describe any new method in
// scripts/api.config.mjs.
//
//   node scripts/update-discovery.mjs          update scripts/discovery/
//   node scripts/update-discovery.mjs --check  report only, exit 1 on changes

import { readFile, writeFile } from "node:fs/promises";

const CHECK = process.argv.includes("--check");
const here = new URL(".", import.meta.url);

const SOURCES = {
  "youtube.v3.json": "https://youtube.googleapis.com/$discovery/rest?version=v3",
  "youtubeAnalytics.v2.json": "https://youtubeanalytics.googleapis.com/$discovery/rest?version=v2",
  "youtubereporting.v1.json": "https://youtubereporting.googleapis.com/$discovery/rest?version=v1",
};

function methodIds(resources, out = new Set()) {
  for (const resource of Object.values(resources ?? {})) {
    for (const method of Object.values(resource.methods ?? {})) out.add(method.id);
    methodIds(resource.resources, out);
  }
  return out;
}

/** Stable key order, so a diff of the files shows real changes only. */
function sorted(value) {
  if (Array.isArray(value)) return value.map(sorted);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, sorted(value[key])]),
    );
  }
  return value;
}

let changes = 0;
for (const [file, url] of Object.entries(SOURCES)) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url} answered ${response.status}`);
  const next = sorted(await response.json());
  const path = new URL(`discovery/${file}`, here);
  const previous = JSON.parse(await readFile(path, "utf8").catch(() => "{}"));

  const before = methodIds(previous.resources);
  const after = methodIds(next.resources);
  const added = [...after].filter((id) => !before.has(id));
  const removed = [...before].filter((id) => !after.has(id));
  const newSchemas = Object.keys(next.schemas ?? {}).filter((name) => !previous.schemas?.[name]);
  const goneSchemas = Object.keys(previous.schemas ?? {}).filter((name) => !next.schemas?.[name]);
  const same = JSON.stringify(sorted({ ...previous, revision: 0 })) === JSON.stringify({ ...next, revision: 0 });

  console.log(`${file}: revision ${previous.revision ?? "none"} -> ${next.revision}${same ? " (no change)" : ""}`);
  for (const id of added) console.log(`  + method ${id}`);
  for (const id of removed) console.log(`  - method ${id}`);
  if (newSchemas.length) console.log(`  + schemas ${newSchemas.join(", ")}`);
  if (goneSchemas.length) console.log(`  - schemas ${goneSchemas.join(", ")}`);
  if (!same && !added.length && !removed.length && !newSchemas.length && !goneSchemas.length) console.log("  fields or descriptions changed");

  if (!same) changes++;
  // Always written, so the pinned copy keeps its stable key order.
  if (!CHECK) await writeFile(path, `${JSON.stringify(next, null, 1)}\n`);
}

if (CHECK && changes) {
  console.log("\nThe API changed. Run `npm run discovery:update`, then `npm run generate`.");
  process.exit(1);
}
