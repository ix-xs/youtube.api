// A translated page gets the heading ids of its English original, by position.
//
// Ids are made from the text of a heading, so "## Typed params" and its French
// translation would get different anchors, and every link to a section would
// have to be rewritten by hand in every language. Giving the nth heading of a
// translation the id of the nth English heading keeps one set of anchors for
// the whole site: links are copied as they are, and a link shared in one
// language lands on the same section in the other.
//
// `scripts/check-translation.mjs` verifies that a translation has the headings
// of its original, in the same order.
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import GithubSlugger from "github-slugger";
import { localeOfFile } from "./base-links.mjs";

/** The text of a Markdown heading as a reader sees it. */
function plain(text) {
  return text
    .replace(/\s+#+\s*$/, "")
    .split("`")
    // Every other piece is inline code, which is kept as written.
    .map((piece, index) =>
      index % 2 === 1
        ? piece
        : piece
            .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
            .replace(/(\*\*|__)(.+?)\1/g, "$2")
            .replace(/(^|[^\w*])[*_]([^*_]+)[*_](?=[^\w*]|$)/g, "$1$2")
            .replace(/\\([\\`*_{}[\]()#+\-.!<>|])/g, "$1"),
    )
    .join("")
    .trim();
}

/** The ids Astro gives the headings of a Markdown source, in order. */
export function headingIds(source) {
  const slugger = new GithubSlugger();
  const ids = [];
  let fence = null;
  for (const line of source.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, "").split(/\r?\n/)) {
    const mark = /^\s*(`{3,}|~{3,})/.exec(line);
    if (mark) {
      if (!fence) fence = mark[1];
      else if (mark[1].startsWith(fence)) fence = null;
      continue;
    }
    if (fence) continue;
    const heading = /^#{1,6}\s+(.+)$/.exec(line);
    if (heading) ids.push(slugger.slug(plain(heading[1])));
  }
  return ids;
}

function visit(node, fn) {
  fn(node);
  if (Array.isArray(node.children)) for (const child of node.children) visit(child, fn);
}

/** The rehype plugin. It runs before Astro's own, which keeps an id that is already there. */
export function rehypeSharedHeadingIds() {
  return (tree, file) => {
    const source = file?.path ?? file?.history?.[0];
    const locale = localeOfFile(source);
    if (!locale) return;
    const original = String(source).replace(new RegExp(`([\\\\/]content[\\\\/]docs)[\\\\/]${locale}([\\\\/])`, "i"), "$1$2");
    if (!existsSync(original)) return;
    const ids = headingIds(readFileSync(path.normalize(original), "utf8"));
    let index = 0;
    visit(tree, (node) => {
      if (node.type !== "element" || !/^h[1-6]$/.test(node.tagName)) return;
      const id = ids[index++];
      if (id) (node.properties ??= {}).id = id;
    });
  };
}
