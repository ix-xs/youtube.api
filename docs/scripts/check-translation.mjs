// Verifies that a translated page still mirrors its English original:
//
//   node scripts/check-translation.mjs            every page of every language
//   node scripts/check-translation.mjs fr/basics  only the pages under a folder
//
// A translation changes the prose and nothing else. For each page this checks,
// against the English page of the same path:
//   - the same frontmatter keys;
//   - the same headings, in the same order and at the same levels (the build
//     gives a translated heading the id of its English counterpart, by position);
//   - the same code blocks: same language and title, same code once the
//     comments are set aside (comments may be translated);
//   - the same link targets, in the same order;
//   - no em or en dash (house style).
import { readFile, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { LOCALES } from "../plugins/base-links.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
/** The em dash and the en dash, by code point: this file follows the rule it enforces. */
const DASHES = new RegExp(`[${String.fromCharCode(0x2014, 0x2013)}]`);
const root = path.resolve(here, "..", "src", "content", "docs");


async function pages(dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await pages(full)));
    else if (/\.mdx?$/.test(entry.name)) out.push(full);
  }
  return out;
}

function split(source) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(source);
  return { frontmatter: match ? match[1] : "", body: match ? source.slice(match[0].length) : source };
}

/** Top-level keys of a YAML frontmatter, with the nested ones as "a.b". */
function keys(frontmatter) {
  const out = [];
  const stack = [];
  for (const line of frontmatter.split(/\r?\n/)) {
    const match = /^(\s*)(?:- )?([A-Za-z_][\w-]*):/.exec(line);
    if (!match) continue;
    const depth = match[1].length;
    while (stack.length > 0 && stack[stack.length - 1].depth >= depth) stack.pop();
    out.push([...stack.map((s) => s.key), match[2]].join("."));
    stack.push({ depth, key: match[2] });
  }
  return out;
}

/** Code blocks and the text around them. */
function parts(body) {
  const blocks = [];
  let prose = "";
  let open = null;
  for (const line of body.split(/\r?\n/)) {
    const fence = /^(\s*)(`{3,}|~{3,})(.*)$/.exec(line);
    if (!open && fence) {
      open = { fence: fence[2], info: fence[3].trim(), lines: [] };
      continue;
    }
    if (open && fence && fence[2].startsWith(open.fence) && fence[3].trim() === "") {
      blocks.push({ info: open.info, code: open.lines.join("\n") });
      open = null;
      continue;
    }
    if (open) open.lines.push(line);
    else prose += line + "\n";
  }
  return { blocks, prose };
}

/** A code block without its comments and without its spacing. */
function bare(code, info) {
  const hash = /^(bash|sh|shell|yaml|yml|env|ini|toml|dotenv|dockerfile|docker)\b/i.test(info);
  return code
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .map((line) => line.replace(/(^|\s)\/\/.*$/, "$1").replace(hash ? /(^|\s)#.*$/ : /$^/, "$1"))
    .join("\n")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/\s+/g, "");
}

const headings = (prose) => [...prose.matchAll(/^(#{1,6})\s+\S/gm)].map((m) => m[1].length);

function links(prose) {
  const out = [];
  for (const match of prose.matchAll(/\]\(([^)\s]+)(?:\s+"[^"]*")?\)|\b(?:href|link)="([^"]+)"|^\[[^\]]+\]:\s*(\S+)/gm)) {
    out.push(match[1] ?? match[2] ?? match[3]);
  }
  return out;
}

const filter = process.argv[2]?.replaceAll("\\", "/").replace(/^\/+|\/+$/g, "");
const problems = [];
let checked = 0;
for (const locale of LOCALES) {
  const dir = path.join(root, locale);
  if (!existsSync(dir)) continue;
  for (const file of await pages(dir)) {
    const relative = path.relative(dir, file).replaceAll("\\", "/");
    const name = `${locale}/${relative}`;
    if (filter && !name.startsWith(filter)) continue;
    checked++;
    const original = path.join(root, relative);
    if (!existsSync(original)) {
      problems.push(`${name}: no English page at ${relative}`);
      continue;
    }
    const [en, tr] = await Promise.all([readFile(original, "utf8"), readFile(file, "utf8")]);
    const [a, b] = [split(en), split(tr)];
    const say = (text) => problems.push(`${name}: ${text}`);

    const [ka, kb] = [keys(a.frontmatter), keys(b.frontmatter)];
    if (ka.join() !== kb.join()) say(`frontmatter keys differ: [${ka.join(", ")}] in English, [${kb.join(", ")}] here`);

    const [pa, pb] = [parts(a.body), parts(b.body)];
    const [ha, hb] = [headings(pa.prose), headings(pb.prose)];
    if (ha.join() !== hb.join()) say(`headings differ: ${ha.length} in English (levels ${ha.join("")}), ${hb.length} here (levels ${hb.join("")})`);

    if (pa.blocks.length !== pb.blocks.length) say(`${pa.blocks.length} code blocks in English, ${pb.blocks.length} here`);
    else {
      pa.blocks.forEach((block, index) => {
        const other = pb.blocks[index];
        if (block.info !== other.info) say(`code block ${index + 1}: opening line is "${other.info}", English has "${block.info}"`);
        else if (bare(block.code, block.info) !== bare(other.code, other.info)) say(`code block ${index + 1} (${block.info || "no language"}): the code differs from the English one (only comments may change)`);
      });
    }

    const [la, lb] = [links(pa.prose), links(pb.prose)];
    if (la.join("\n") !== lb.join("\n")) {
      const index = la.findIndex((target, i) => target !== lb[i]);
      const at = index === -1 ? la.length : index;
      say(`link targets differ at link ${at + 1}: English has "${la[at] ?? "(none)"}", here "${lb[at] ?? "(none)"}" (${la.length} links in English, ${lb.length} here)`);
    }

    const dash = DASHES.exec(tr);
    if (dash) say(`an em or en dash near "${tr.slice(Math.max(0, dash.index - 30), dash.index + 10).replace(/\s+/g, " ")}"`);
  }
}

if (problems.length > 0) {
  console.error(`✗ ${problems.length} problem(s) in ${checked} translated page(s):\n` + problems.map((p) => `  ${p}`).join("\n"));
  process.exit(1);
}
console.log(`✓ ${checked} translated page(s) mirror their English original`);
