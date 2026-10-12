// Compiles every TypeScript sample of the documentation against the library,
// so a page cannot show code that does not type-check.
//
//   node scripts/check-samples.mjs            every page
//   node scripts/check-samples.mjs basics     only the pages whose path contains "basics"
//
// How a sample is read:
// - A ```ts block is one module. Its imports from "@ix-xs/youtube.api" are
//   pointed at the source of the library.
// - A name the package exports can be used without importing it: the import
//   is added for you, which keeps short samples short.
// - `yt` and the names declared in GLOBALS below exist everywhere.
// - A block fenced as ```ts nocheck is skipped. Use it for fragments that are
//   not meant to stand alone, and sparingly.

import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..", "..");
const content = path.resolve(here, "..", "src", "content", "docs");
// One folder per run, so two checks at the same time do not step on each other.
const out = path.join(root, "node_modules", ".cache", "docs-samples", String(process.pid));
const require = createRequire(path.join(root, "package.json"));
const ts = require("typescript");
const filter = process.argv[2];

const GLOBALS = `import type { OAuth2, Tokens, Video, YouTube } from "${rel("src/index.ts")}";

declare global {
  /** A client, as created in the quick start. */
  const yt: YouTube;
  const oauth: OAuth2;
  const apiKey: string, clientId: string, clientSecret: string, secret: string;
  const videoId: string, channelId: string, playlistId: string, playlistItemId: string, commentId: string, captionId: string;
  const liveChatId: string, broadcastId: string, streamId: string, messageId: string, subscriptionId: string;
  const groupId: string, jobId: string, reportId: string;
  const ids: string[], videos: Video[];
  const file: File, image: Blob, blob: Blob, srtText: string;
  const code: string, state: string, codeVerifier: string, savedTokens: Tokens | undefined;
  /** The Request of whatever server framework the sample runs in. */
  const request: Request;
  /** Stand-ins for the reader's own application. */
  /** A router in the style of Express or Hono, typed just enough for handlers to be written without annotations. */
  const app: Record<"get" | "post" | "put" | "delete" | "all" | "use", (path: string, ...handlers: Array<(...args: any[]) => unknown>) => void>;
  const req: any, res: any, db: any, session: any, redis: any, env: any;
  function saveTokens(tokens: Tokens): void;
  function loadTokens(): Promise<Tokens | undefined>;
  function notify(message: string): Promise<void>;
}
`;

function rel(file) {
  return path.relative(out, path.join(root, file)).replace(/\\/g, "/").replace(/\.ts$/, ".js");
}

async function* pages(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* pages(full);
    else if (/\.mdx?$/.test(entry.name)) yield full;
  }
}

/** Names exported by the package, to import them on behalf of a sample. */
function exportedNames(program, file) {
  const checker = program.getTypeChecker();
  const symbol = checker.getSymbolAtLocation(program.getSourceFile(file));
  return new Set(checker.getExportsOfModule(symbol).map((item) => item.getName()));
}

const options = {
  target: ts.ScriptTarget.ES2022,
  module: ts.ModuleKind.NodeNext,
  moduleResolution: ts.ModuleResolutionKind.NodeNext,
  lib: ["lib.es2022.d.ts", "lib.dom.d.ts", "lib.dom.iterable.d.ts", "lib.dom.asynciterable.d.ts"],
  types: ["node"],
  typeRoots: [path.join(root, "node_modules", "@types")],
  strict: true,
  noUncheckedIndexedAccess: true,
  skipLibCheck: true,
  noEmit: true,
};

const indexFile = path.join(root, "src", "index.ts");
const nodeFile = path.join(root, "src", "node.ts");
const library = ts.createProgram([indexFile, nodeFile], options);
const mainExports = exportedNames(library, indexFile);
const nodeExports = exportedNames(library, nodeFile);

await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });
await writeFile(path.join(out, "globals.d.ts"), GLOBALS);

const samples = new Map();
let skipped = 0;
for await (const page of pages(content)) {
  const name = path.relative(content, page).replace(/\\/g, "/");
  if (filter && !name.includes(filter)) continue;
  const lines = (await readFile(page, "utf8")).split(/\r?\n/);
  let block;
  let count = 0;
  lines.forEach((line, index) => {
    const fence = /^\s*```(\w*)\s*(.*)$/.exec(line);
    if (!block) {
      if (fence && (fence[1] === "ts" || fence[1] === "typescript")) {
        if (/\bnocheck\b/.test(fence[2])) skipped++;
        else block = { start: index + 1, lines: [], indent: line.indexOf("`") };
      }
      return;
    }
    if (fence && fence[1] === "") {
      const file = path.join(out, `${name.replace(/[^\w]+/g, "_")}_${++count}.mts`);
      samples.set(file, { page: name, start: block.start, code: block.lines.join("\n") });
      block = undefined;
    } else block.lines.push(line.slice(Math.min(block.indent, line.length - line.trimStart().length)));
  });
}

for (const [file, sample] of samples) {
  let code = sample.code
    .replace(/(from\s+["'])@ix-xs\/youtube\.api\/node(["'])/g, `$1${rel("src/node.ts")}$2`)
    .replace(/(from\s+["'])@ix-xs\/youtube\.api(["'])/g, `$1${rel("src/index.ts")}$2`);
  // Names the sample introduces itself: imports, declarations, parameters.
  const declared = new Set();
  for (const match of code.matchAll(/import\s+(?:type\s+)?(?:\*\s+as\s+(\w+)|\{([^}]*)\}|(\w+))/g)) {
    if (match[1]) declared.add(match[1]);
    if (match[3]) declared.add(match[3]);
    for (const part of (match[2] ?? "").split(",")) {
      const local = part.trim().replace(/^type\s+/, "").split(/\s+as\s+/).pop();
      if (local) declared.add(local);
    }
  }
  for (const match of code.matchAll(/\b(?:const|let|var|function|class|type|interface|enum)\s+(\w+)/g)) declared.add(match[1]);
  // Quoted strings are skipped. Template literals are not: what sits in ${...} is code.
  const used = new Set([...code.replace(/(["'])(?:\\.|(?!\1).)*\1/g, "").matchAll(/(?<![.\w$])([A-Za-z_$][\w$]*)/g)].map((match) => match[1]));
  const fromMain = [...used].filter((id) => mainExports.has(id) && !declared.has(id));
  const fromNode = [...used].filter((id) => nodeExports.has(id) && !mainExports.has(id) && !declared.has(id));
  let header = "";
  if (fromMain.length) header += `import { ${fromMain.join(", ")} } from "${rel("src/index.ts")}";`;
  if (fromNode.length) header += `import { ${fromNode.join(", ")} } from "${rel("src/node.ts")}";`;
  // The header stays on the first line so the sample keeps its line numbers.
  sample.code = `${header} export {};\n${code}`;
  await writeFile(file, sample.code);
}

const program = ts.createProgram([...samples.keys(), path.join(out, "globals.d.ts")], options);
const diagnostics = ts.getPreEmitDiagnostics(program).filter((diagnostic) => diagnostic.file && samples.has(path.normalize(diagnostic.file.fileName)));

for (const diagnostic of diagnostics) {
  const sample = samples.get(path.normalize(diagnostic.file.fileName));
  const { line } = diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start ?? 0);
  const text = sample.code.split("\n")[line] ?? "";
  // Line 0 of the module is the added header; line 1 is the first line of the block.
  console.error(`${sample.page}:${sample.start + line}  ${ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n  ")}\n    ${text.trim()}\n`);
}

await rm(out, { recursive: true, force: true });

if (diagnostics.length) {
  console.error(`${diagnostics.length} error${diagnostics.length === 1 ? "" : "s"} in the samples of the documentation.`);
  process.exit(1);
}
console.log(`${samples.size} samples compile${skipped ? `, ${skipped} skipped with "nocheck"` : ""}`);
