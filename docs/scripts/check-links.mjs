// Verifies every internal link of the built site: the target page must exist,
// and so must the `#anchor` when there is one. Run after a build:
//
//   npm run build && npm run check-links
//
// A renamed heading silently breaks the anchors pointing at it, and nothing in
// the build notices. This does.
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { LOCALES, normalizeBase } from "../plugins/base-links.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const dist = path.resolve(here, "..", "dist");
const base = normalizeBase(process.env.DOCS_BASE || "/youtube.api");

async function htmlFiles(dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await htmlFiles(full)));
    else if (entry.name.endsWith(".html")) out.push(full);
  }
  return out;
}

/** "/youtube.api/basics/quota/" -> absolute path of dist/basics/quota/index.html */
function targetFile(urlPath) {
  const relative = urlPath.slice(base.length).replace(/^\/+/, "");
  if (relative === "" || relative.endsWith("/")) return path.join(dist, relative, "index.html");
  // "/getting-started" is served from its directory index; a real file keeps its name.
  return path.extname(relative) ? path.join(dist, relative) : path.join(dist, relative, "index.html");
}

const files = await htmlFiles(dist);
const pages = new Map();
for (const file of files) {
  const html = await readFile(file, "utf8");
  pages.set(path.normalize(file), {
    html,
    ids: new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1])),
  });
}

const problems = [];

// A translated page shares the heading ids of its English page (see
// plugins/heading-ids.mjs): a link to a section works in every language.
const headingIds = (html) => [...html.matchAll(/<h[1-6][^>]*\sid="([^"]+)"/g)].map((m) => m[1]).join(" ");
for (const locale of LOCALES) {
  const folder = path.join(dist, locale) + path.sep;
  for (const [file, { html }] of pages) {
    if (!file.startsWith(folder)) continue;
    const original = pages.get(path.join(dist, file.slice(folder.length)));
    if (original && headingIds(original.html) !== headingIds(html)) {
      problems.push(`${path.relative(dist, file).replaceAll("\\", "/")}: its headings do not have the ids of the English page`);
    }
  }
}

for (const [file, { html }] of pages) {
  const from = path.relative(dist, file).replaceAll("\\", "/");
  for (const [, href] of html.matchAll(/<a\s[^>]*?href="([^"]+)"/g)) {
    if (/^(https?:|mailto:|tel:|\/\/)/.test(href)) continue;

    const [rawPath, anchor] = href.split("#");
    // A same-page anchor: "#heading".
    if (rawPath === "") {
      if (anchor && !pages.get(file).ids.has(decodeURIComponent(anchor))) {
        problems.push(`${from}: missing anchor #${anchor}`);
      }
      continue;
    }
    // Relative links are not used in this site: anything else that is not
    // root-relative is a mistake (a path rewritten by a shell, a typo).
    if (!rawPath.startsWith("/")) {
      problems.push(`${from}: not a link of this site nor a full address -> ${href}`);
      continue;
    }

    if (base && rawPath !== base && !rawPath.startsWith(`${base}/`)) {
      problems.push(`${from}: link without the base path -> ${href}`);
      continue;
    }

    const target = path.normalize(targetFile(rawPath));
    const page = pages.get(target);
    if (!page) {
      // Assets (css, js, images) live outside the html set; only pages are checked.
      if (!path.extname(rawPath)) problems.push(`${from}: broken link -> ${href}`);
      continue;
    }
    if (anchor && !page.ids.has(decodeURIComponent(anchor))) {
      problems.push(`${from}: missing anchor -> ${href}`);
    }
  }
}

if (problems.length > 0) {
  const unique = [...new Set(problems)].sort();
  console.error(`✗ ${unique.length} broken link(s):\n` + unique.map((p) => `  ${p}`).join("\n"));
  process.exit(1);
}
console.log(`✓ ${pages.size} pages checked, every internal link and anchor resolves`);
