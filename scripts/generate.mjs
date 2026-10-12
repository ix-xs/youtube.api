// Turns Google's discovery documents into the typed layer of the library:
//
//   src/generated/schemas.ts     every Data API resource, plus the part-aware aliases
//   src/generated/params.ts      one parameter interface per Data API method
//   src/generated/resources.ts   one class per Data API resource
//   src/generated/analytics.ts   YouTube Analytics API (types, parameters, classes)
//   src/generated/reporting.ts   YouTube Reporting API (types, parameters, classes)
//   src/generated/methods.ts     runtime table: path, verb, quota, scopes, pagination
//   test/types/examples.gen.ts   every doc example, compiled by `npm run test:types`
//
//   node scripts/generate.mjs           write the files
//   node scripts/generate.mjs --check   fail if the files on disk are out of date

import { mkdir, readFile, writeFile } from "node:fs/promises";
import * as config from "./api.config.mjs";

const CHECK = process.argv.includes("--check");
const here = new URL(".", import.meta.url);
const root = new URL("../", here);

const APIS = [
  { key: "data", file: "youtube.v3.json", strip: "youtube.", idPrefix: "", typePrefix: "", accessor: "yt" },
  { key: "analytics", file: "youtubeAnalytics.v2.json", strip: "youtubeAnalytics.", idPrefix: "analytics.", typePrefix: "Analytics", accessor: "yt.analytics" },
  { key: "reporting", file: "youtubereporting.v1.json", strip: "youtubereporting.", idPrefix: "reporting.", typePrefix: "Reporting", accessor: "yt.reporting" },
];

const RENAMED = { "youtube.v3.liveChat.messages.stream": "liveChatMessages.stream" };
const DROPPED_PARAMS = new Set(["onBehalfOf"]);
const VOID_RESPONSES = new Set(["Empty", "EmptyResponse"]);
const PROP_ORDER = ["kind", "etag", "id", "snippet", "contentDetails", "statistics", "status"];
const SCOPE_ROOT = "https://www.googleapis.com/auth/";
const DEFAULT_LIMITS = { "search.list": 100, "videos.insert": 100, "videos.batchGetStats": "10,000" };

const docsLinks = JSON.parse(await readFile(new URL("docs-links.json", here), "utf8"));

// ---------------------------------------------------------------- text helpers

// Built from code points so this file itself stays plain ASCII.
const LONG_DASHES = new RegExp(`[${String.fromCharCode(0x2013, 0x2014)}]`, "g");
const CURLY_SINGLE = new RegExp(`[${String.fromCharCode(0x2018, 0x2019)}]`, "g");
const CURLY_DOUBLE = new RegExp(`[${String.fromCharCode(0x201c, 0x201d)}]`, "g");

const pascal = (name) => name.charAt(0).toUpperCase() + name.slice(1);

function clean(text) {
  if (!text) return "";
  let out = text.replace(/\s+/g, " ").trim();
  out = out
    .replace(/\s*@mutable\b.*$/, "")
    .replace(/\s*Next I[dD]: \d+\.?/g, "")
    .replace(/\s*LINT\.\w+.*$/, "")
    .replace(/\s*b\/\d+.*$/, "")
    .replace(/\s*required: true, pattern: .*$/, "");
  out = out.replace(/\*([^*\s][^*]*?)\*/g, (_, inner) => (/^[\w.]+$/.test(inner) ? `\`${inner}\`` : inner));
  out = out
    .replace(LONG_DASHES, "-")
    .replace(CURLY_SINGLE, "'")
    .replace(CURLY_DOUBLE, '"')
    .replace(/\*\//g, "* /");
  if (out && !/[.!?:)`]$/.test(out)) out += ".";
  return out.trim();
}

function wrap(text, width) {
  const lines = [];
  for (const paragraph of text.split("\n")) {
    if (paragraph.length <= width || /^\s/.test(paragraph)) {
      lines.push(paragraph);
      continue;
    }
    let line = "";
    for (const word of paragraph.split(" ")) {
      if (line && line.length + word.length + 1 > width) {
        lines.push(line);
        line = word;
      } else line = line ? `${line} ${word}` : word;
    }
    if (line) lines.push(line);
  }
  return lines;
}

/** Builds a doc comment. `blocks` are paragraphs, already-formatted lines start with a tab marker. */
function jsdoc(blocks, indent = "") {
  const lines = [];
  for (const block of blocks.filter(Boolean)) {
    if (lines.length && !block.startsWith("@")) lines.push("");
    if (block.startsWith("\t")) lines.push(...block.slice(1).split("\n"));
    else lines.push(...wrap(block, 100 - indent.length));
  }
  if (!lines.length) return "";
  if (lines.length === 1 && lines[0].length < 96 - indent.length) return `${indent}/** ${lines[0]} */\n`;
  return `${indent}/**\n${lines.map((line) => `${indent} *${line ? ` ${line}` : ""}`).join("\n")}\n${indent} */\n`;
}

const literal = (values) => values.map((value) => JSON.stringify(value)).join(" | ");

function sortProps(names) {
  return [...names].sort((a, b) => {
    const ia = PROP_ORDER.indexOf(a);
    const ib = PROP_ORDER.indexOf(b);
    if (ia !== -1 || ib !== -1) return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
    return a.localeCompare(b);
  });
}

// ------------------------------------------------------------------ the model

function flattenMethods(resources, out = []) {
  for (const resource of Object.values(resources ?? {})) {
    for (const method of Object.values(resource.methods ?? {})) out.push(method);
    flattenMethods(resource.resources, out);
  }
  return out;
}

function listInfo(doc, method) {
  if (method.httpMethod !== "GET" || !method.response) return undefined;
  const schema = doc.schemas[method.response.$ref];
  const arrays = Object.entries(schema?.properties ?? {}).filter(([, prop]) => prop.type === "array" && prop.items?.$ref);
  const found = arrays.find(([name]) => name === "items") ?? (arrays.length === 1 ? arrays[0] : undefined);
  return found ? { key: found[0], item: found[1].items.$ref } : undefined;
}

function buildModel(api, doc) {
  const methods = [];
  for (const raw of flattenMethods(doc.resources)) {
    if (config.omit.includes(raw.id)) continue;
    const meta = config.methods[raw.id];
    if (!meta) throw new Error(`No entry for ${raw.id} in scripts/api.config.mjs`);
    let local = raw.id.slice(api.strip.length);
    local = RENAMED[local] ?? local;
    const segments = local.split(".");
    const name = segments.pop();
    const resource = segments.at(-1);
    const list = meta.handwritten ? undefined : listInfo(doc, raw);
    methods.push({ raw, meta, id: api.idPrefix + local, name, resource, list, docs: docsLinks[raw.id] });
  }

  // Resources that are addressed by `part`.
  const partResources = new Map();
  if (api.key === "data") {
    for (const method of methods) {
      if (!method.raw.parameters?.part) continue;
      const ref = method.list?.item ?? method.raw.response?.$ref ?? method.raw.request?.$ref;
      const schema = ref && doc.schemas[ref];
      if (!schema?.properties?.kind) continue;
      if (method.name === "stream") continue;
      const parts = sortProps(Object.keys(schema.properties).filter((key) => key !== "kind" && key !== "etag"));
      if (parts.length) partResources.set(ref, parts);
    }
    // The streaming method returns the same messages as liveChatMessages.list.
    for (const method of methods) {
      if (method.raw.request && partResources.has(method.raw.request.$ref)) method.partOf = method.raw.request.$ref;
      const ref = method.list?.item ?? method.raw.response?.$ref;
      if (method.raw.parameters?.part && ref && partResources.has(ref)) method.partOf = ref;
    }
  }

  // Only the schemas a public method can reach are emitted.
  const reachable = new Set();
  const visit = (ref) => {
    if (!ref || reachable.has(ref) || !doc.schemas[ref]) return;
    reachable.add(ref);
    const walk = (node) => {
      if (!node || typeof node !== "object") return;
      if (node.$ref) visit(node.$ref);
      for (const child of Object.values(node.properties ?? {})) walk(child);
      walk(node.items);
      if (typeof node.additionalProperties === "object") walk(node.additionalProperties);
    };
    walk(doc.schemas[ref]);
  };
  for (const method of methods) {
    if (method.raw.supportsMediaDownload && method.meta.handwritten) continue;
    visit(method.raw.request?.$ref);
    if (!VOID_RESPONSES.has(method.raw.response?.$ref)) visit(method.raw.response?.$ref);
  }

  const typeName = (ref) => {
    if (partResources.has(ref)) {
      const name = `${ref}Resource`;
      if (doc.schemas[name]) throw new Error(`Name clash: ${name}`);
      return name;
    }
    return api.typePrefix + ref;
  };
  return { api, doc, methods, partResources, reachable, typeName };
}

// -------------------------------------------------------------------- schemas

function propType(model, prop, path) {
  if (prop.$ref) return model.typeName(prop.$ref);
  if (prop.type === "array") {
    const inner = propType(model, prop.items ?? {}, path);
    return /[ |]/.test(inner) ? `(${inner})[]` : `${inner}[]`;
  }
  if (prop.type === "object") {
    if (prop.properties) return inlineObject(model, prop, path);
    if (typeof prop.additionalProperties === "object") return `Record<string, ${propType(model, prop.additionalProperties, path)}>`;
    return "Record<string, unknown>";
  }
  if (prop.enum) return literal(prop.enum);
  if (prop.type === "integer" || prop.type === "number") return "number";
  if (prop.type === "boolean") return "boolean";
  if (prop.type === "string") return "string";
  return "unknown";
}

function propDoc(prop) {
  const blocks = [clean(prop.description)];
  if (prop.enum && prop.enumDescriptions?.some(Boolean)) {
    const lines = prop.enum.map((value, index) => [value, clean(prop.enumDescriptions[index])]).filter(([, text]) => text);
    if (lines.length) blocks.push(`\t${lines.map(([value, text]) => `- \`${value}\`: ${text}`).join("\n")}`);
  }
  if (prop.format === "uint64" || prop.format === "int64") blocks.push("A 64-bit integer, sent as a string.");
  if (prop.format === "date-time" || prop.format === "google-datetime") blocks.push("ISO 8601 date and time.");
  if (prop.format === "byte") blocks.push("Base64 encoded.");
  if (prop.deprecated) blocks.push("@deprecated");
  return blocks;
}

function members(model, schema, path, indent) {
  const requiredHere = new Set(config.required[path] ?? []);
  for (const name of requiredHere) {
    if (!schema.properties?.[name]) throw new Error(`config.required: ${path}.${name} does not exist`);
  }
  let out = "";
  for (const name of sortProps(Object.keys(schema.properties ?? {}))) {
    const prop = schema.properties[name];
    const key = /^[A-Za-z_$][\w$]*$/.test(name) ? name : JSON.stringify(name);
    out += jsdoc(propDoc(prop), indent);
    out += `${indent}${key}${requiredHere.has(name) ? "" : "?"}: ${propType(model, prop, `${path}.${name}`)};\n`;
  }
  return out;
}

function inlineObject(model, prop, path) {
  const depth = path.split(".").length;
  const indent = "  ".repeat(depth);
  return `{\n${members(model, prop, path, indent)}${"  ".repeat(depth - 1)}}`;
}

function emitSchemas(model) {
  const { doc, api } = model;
  let out = "";
  for (const ref of [...model.reachable].sort()) {
    const schema = doc.schemas[ref];
    const name = model.typeName(ref);
    const isList = /ListResponse$|^List\w+Response$/.test(ref) || ref === "BatchGetStatsResponse" || ref === "VideoGetRatingResponse";
    const path = ref;
    if (isList && !config.required[ref]) {
      config.required[ref] = Object.keys(schema.properties ?? {}).filter((key) => ["kind", "etag", "items"].includes(key));
      if (api.key !== "data") config.required[ref] = [];
    }
    const blocks = [clean(schema.description)];
    if (model.partResources.has(ref)) {
      blocks.push(`This is the full resource, with every part optional. \`${ref}<Parts>\` is the same resource narrowed to the parts you asked for.`);
    }
    out += jsdoc(blocks);
    out += `export interface ${name} {\n${members(model, schema, path, "  ")}}\n\n`;
  }
  return out;
}

function emitParts(model) {
  let out = "";
  for (const [ref, parts] of [...model.partResources].sort(([a], [b]) => a.localeCompare(b))) {
    for (const part of config.alwaysReturned[ref] ?? []) {
      if (!parts.includes(part)) throw new Error(`config.alwaysReturned: ${ref}.${part} does not exist`);
    }
    const always = config.alwaysReturned[ref] ?? ["snippet"].filter((part) => parts.includes(part));
    const noun = ref.replace(/([a-z0-9])([A-Z])/g, "$1 $2").toLowerCase().replace(/^i18n /, "i18n ");
    out += jsdoc([`Parts of a ${noun} resource, as accepted by the \`part\` parameter.`]);
    out += `export type ${ref}Part = ${literal(parts)};\n\n`;
    out += jsdoc([
      `A ${noun}, narrowed to the parts you requested: \`${ref}<"${parts.includes("snippet") ? "snippet" : parts[0]}">\`. Without a type argument it is the full resource with every part optional.`,
    ]);
    out += `export type ${ref}<P extends ${ref}Part = never> = WithParts<${ref}Resource, ${ref}Part, P, ${always.length ? literal(always) : "never"}>;\n\n`;
  }
  return out;
}

// ----------------------------------------------------------------- parameters

function paramsName(model, method) {
  return `${model.api.typePrefix}${pascal(method.resource)}${pascal(method.name)}Params`;
}

function paramType(model, method, name, param) {
  const override = method.meta.types?.[name];
  if (override) return override;
  if (name === "part") return method.partOf ? "OneOrMany<P>" : "OneOrMany<string>";
  let type;
  if (param.enum) {
    const values = param.enum.filter((value) => !/unspecified$|unknown$/i.test(value));
    type = literal(values);
  } else if (param.type === "integer" || param.type === "number") type = "number";
  else if (param.type === "boolean") type = "boolean";
  else if (param.format === "date-time" || param.format === "google-datetime") type = "string | Date";
  else type = "string";
  return param.repeated ? `OneOrMany<${type}>` : type;
}

function paramDoc(method, name, param, isWrite) {
  if (name === "part") {
    if (!method.partOf) return [clean(param.description)];
    return [
      isWrite
        ? "Parts the request writes and the response returns. Defaults to the parts present in `body`."
        : "Parts to return. The response type follows this list: a part you did not ask for is not on the result.",
    ];
  }
  const blocks = [clean(param.description)];
  if (param.enum && param.enumDescriptions?.some(Boolean) && !method.meta.types?.[name]) {
    const lines = param.enum
      .map((value, index) => [value, clean(param.enumDescriptions[index])])
      .filter(([value, text]) => text && !/unspecified$|unknown$/i.test(value));
    if (lines.length) blocks.push(`\t${lines.map(([value, text]) => `- \`${value}\`: ${text}`).join("\n")}`);
  }
  const bounds = [];
  if (param.minimum !== undefined && param.maximum !== undefined) bounds.push(`Between ${param.minimum} and ${param.maximum}.`);
  else if (param.maximum !== undefined) bounds.push(`At most ${param.maximum}.`);
  if (param.default !== undefined && param.type !== "string") bounds.push(`Default ${param.default}.`);
  if (bounds.length) blocks.push(bounds.join(" "));
  if (method.raw.httpMethod === "GET" && param.repeated && name === "id") blocks.push("Any number of ids: lists longer than 50 are split across calls.");
  return blocks;
}

function methodParams(model, method) {
  const raw = method.raw;
  const isWrite = raw.httpMethod !== "GET";
  const requires = new Set(method.meta.requires ?? []);
  const entries = [];
  const names = Object.keys(raw.parameters ?? {}).filter((name) => {
    const param = raw.parameters[name];
    return !param.deprecated && !DROPPED_PARAMS.has(name) && !/^onBehalfOfContentOwner/.test(name);
  });
  for (const name of requires) if (!names.includes(name)) throw new Error(`${raw.id}: requires unknown parameter ${name}`);

  for (const name of names) {
    const param = raw.parameters[name];
    let required = Boolean(param.required) || requires.has(name);
    if (name === "part" && isWrite && method.partOf && raw.request) required = false;
    entries.push({ name, required, type: paramType(model, method, name, param), doc: paramDoc(method, name, param, isWrite) });
  }
  if (raw.request) {
    const ref = raw.request.$ref;
    entries.push({ name: "body", required: !method.meta.optionalBody, type: `Body<${model.typeName(ref)}>`, doc: ["The resource to send. Every field is optional in the type, the API checks what it needs."] });
  }
  if (raw.supportsMediaUpload) {
    const accept = raw.mediaUpload.accept.map((type) => (type === "*/*" ? "any" : type)).join(", ");
    entries.push({
      name: "media",
      required: raw.httpMethod !== "PUT",
      type: "MediaInput",
      doc: [`The file to upload: a Blob, bytes, a stream, or \`{ body, mimeType, onProgress }\` for more control. Accepted types: ${accept}.`],
    });
  }
  const rank = (entry) => (entry.name === "part" ? 0 : entry.name === "body" ? 2 : entry.name === "media" ? 3 : entry.required ? 1 : 4);
  entries.sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));

  const owner = raw.parameters?.onBehalfOfContentOwnerChannel ? "OnBehalfOfContentOwnerChannel" : raw.parameters?.onBehalfOfContentOwner ? "OnBehalfOfContentOwner" : undefined;
  return { entries, owner, allOptional: entries.every((entry) => !entry.required) };
}

function emitParams(model) {
  let out = "";
  for (const method of model.methods) {
    const { entries, owner } = (method.params = methodParams(model, method));
    const generic = method.partOf ? `<P extends ${method.partOf}Part = ${method.partOf}Part>` : "";
    out += jsdoc([`Parameters of \`${method.id}\`.`]);
    out += `export interface ${paramsName(model, method)}${generic}${owner ? ` extends ${owner}` : ""} {\n`;
    for (const entry of entries) {
      out += jsdoc(entry.doc, "  ");
      out += `  ${entry.name}${entry.required ? "" : "?"}: ${entry.type};\n`;
    }
    out += "}\n\n";
  }
  return out;
}

// -------------------------------------------------------------------- classes

function quotaLine(method, api) {
  if (api.key !== "data") return "";
  const { quota, bucket } = method.meta;
  if (bucket) return `Quota: ${quota} call from the \`${bucket}\` bucket (${DEFAULT_LIMITS[bucket]} a day by default).`;
  return `Quota: ${quota} unit${quota === 1 ? "" : "s"}.`;
}

function authOf(method, api) {
  return api.key !== "data" || method.meta.auth === "oauth" || method.raw.httpMethod !== "GET" ? "oauth" : "any";
}

function shortScopes(method) {
  return (method.raw.scopes ?? []).map((scope) => scope.replace(SCOPE_ROOT, ""));
}

function authLine(method, api) {
  const scopes = shortScopes(method)
    .map((scope) => `\`${scope}\``)
    .join(", ");
  if (authOf(method, api) === "any") return "Auth: API key, or OAuth to see private data.";
  return `Auth: OAuth${scopes ? `, with one of ${scopes}` : ""}.`;
}

function returnType(model, method) {
  const raw = method.raw;
  const P = method.partOf && raw.parameters?.part ? "<P>" : "";
  if (method.list) {
    const item = model.partResources.has(method.list.item) ? `${method.list.item}${P}` : model.typeName(method.list.item);
    return { kind: "list", type: `ListRequest<${item}, ${model.typeName(raw.response.$ref)}>` };
  }
  if (method.meta.response === "text") return { kind: "call", type: "Promise<string>", inner: "string" };
  if (!raw.response || VOID_RESPONSES.has(raw.response.$ref)) return { kind: "call", type: "Promise<void>", inner: "void" };
  const ref = raw.response.$ref;
  let inner = model.partResources.has(ref) && method.partOf === ref ? `${ref}${P}` : model.partResources.has(ref) ? ref : model.typeName(ref);
  // A write whose `part` is optional still returns a resource with its id.
  if (P && raw.httpMethod !== "GET" && raw.request && method.partOf === ref) {
    inner = `[P] extends [never] ? Identified<${model.typeName(ref)}> : ${ref}<P>`;
  }
  return { kind: "call", type: `Promise<${inner}>`, inner };
}

function className(model, resource) {
  return `${model.api.typePrefix}${pascal(resource)}Api`;
}

function emitClasses(model) {
  const groups = new Map();
  for (const method of model.methods) {
    if (!groups.has(method.resource)) groups.set(method.resource, []);
    groups.get(method.resource).push(method);
  }
  const ORDER = ["list", "get", "query", "insert", "create", "update", "set", "unset", "rate", "getRating"];
  let out = "";
  const names = [];
  for (const [resource, list] of [...groups].sort(([a], [b]) => a.localeCompare(b))) {
    const visible = list.filter((method) => !method.meta.handwritten);
    visible.sort((a, b) => {
      const ia = ORDER.indexOf(a.name);
      const ib = ORDER.indexOf(b.name);
      return (ia === -1 ? 50 : ia) - (ib === -1 ? 50 : ib) || a.name.localeCompare(b.name);
    });
    if (!visible.length) continue;
    const name = className(model, resource);
    names.push({ resource, name });
    out += jsdoc([`\`${model.api.accessor}.${resource}\`: the \`${resource}\` methods of the ${model.doc.title}.`]);
    out += `export class ${name} extends ResourceBase {\n`;
    for (const method of visible) {
      const ret = returnType(model, method);
      const generic = method.partOf && method.raw.parameters?.part ? `<P extends ${method.partOf}Part = never>` : "";
      const paramsType = `${paramsName(model, method)}${generic ? "<P>" : ""}`;
      const optional = method.params.allOptional;
      const blocks = [method.meta.summary, [quotaLine(method, model.api), authLine(method, model.api)].filter(Boolean).join(" ")];
      if (method.meta.example) blocks.push(`\t@example\n${method.meta.example}`);
      if (method.docs) blocks.push(`@see ${method.docs}`);
      if (method.meta.deprecated) blocks.push(`@deprecated ${method.meta.deprecated}`);
      out += jsdoc(blocks, "  ");
      out += `  ${method.name}${generic}(params${optional ? "?" : ""}: ${paramsType}, options?: RequestOptions): ${ret.type} {\n`;
      out +=
        ret.kind === "list"
          ? `    return this._list(METHODS[${JSON.stringify(method.id)}], params, options);\n`
          : `    return this._call<${ret.inner}>(METHODS[${JSON.stringify(method.id)}], params, options);\n`;
      out += "  }\n\n";
    }
    out = `${out.trimEnd()}\n}\n\n`;
  }
  return { code: out, names };
}

// -------------------------------------------------------------- methods table

function emitSpec(model, method) {
  const raw = method.raw;
  const { api } = model;
  const spec = {
    id: method.id,
    api: api.key,
    verb: raw.httpMethod,
    path: raw.path,
    quota: api.key === "data" ? method.meta.quota : 1,
    bucket: api.key === "data" ? (method.meta.bucket ?? "default") : api.key,
    auth: authOf(method, api),
    scopes: shortScopes(method),
  };
  const params = raw.parameters ?? {};
  const sizeName = params.maxResults ? "maxResults" : params.pageSize ? "pageSize" : undefined;
  if (params.pageToken && sizeName && params[sizeName].maximum) {
    spec.paged = { size: sizeName, max: Number(params[sizeName].maximum) };
    if (Number(params[sizeName].minimum) > 1) spec.paged.min = Number(params[sizeName].minimum);
  }
  if (raw.httpMethod === "GET" && params.id?.repeated) spec.chunk = { param: "id", size: 50 };
  if (method.list && method.list.key !== "items") spec.items = method.list.key;
  if (raw.supportsMediaUpload) {
    spec.upload = { path: raw.mediaUpload.protocols.simple.path, accept: raw.mediaUpload.accept, maxSize: Number(raw.mediaUpload.maxSize) };
  }
  if (raw.httpMethod !== "GET" && method.partOf && raw.request && params.part) spec.autoPart = true;
  if (method.meta.response === "text") spec.response = "text";
  else if (!raw.response || VOID_RESPONSES.has(raw.response.$ref)) spec.response = "none";
  return spec;
}

// ---------------------------------------------------------------------- files

const header = (model, extra = "") =>
  `// Generated by scripts/generate.mjs from scripts/discovery/${model.api.file} (revision ${model.doc.revision}).\n// Do not edit by hand: change scripts/api.config.mjs or the generator, then run \`npm run generate\`.\n${extra}\n`;

const models = [];
for (const api of APIS) {
  const doc = JSON.parse(await readFile(new URL(`discovery/${api.file}`, here), "utf8"));
  models.push(buildModel(api, doc));
}
const known = new Set(models.flatMap((model) => flattenMethods(model.doc.resources).map((method) => method.id)));
for (const id of Object.keys(config.methods)) if (!known.has(id)) throw new Error(`api.config.mjs describes ${id}, which no longer exists`);

const files = new Map();
const [data, ...others] = models;

files.set(
  "src/generated/schemas.ts",
  `${header(data)}import type { WithParts } from "../core/resource.js";\n\n${emitSchemas(data)}${emitParts(data)}`,
);

const dataParams = emitParams(data);
const dataTypes = [...new Set([...dataParams.matchAll(/\b(?:Body<(\w+)>|P extends (\w+Part))/g)].map((match) => match[1] ?? match[2]))].sort();
files.set(
  "src/generated/params.ts",
  `${header(data)}import type { Body, OnBehalfOfContentOwner, OnBehalfOfContentOwnerChannel, OneOrMany } from "../core/resource.js";\nimport type { MediaInput } from "../core/upload.js";\nimport type { ${dataTypes.join(", ")} } from "./schemas.js";\n\n${dataParams}`,
);

const dataClasses = emitClasses(data);
const used = (code, pattern) => [...new Set([...code.matchAll(pattern)].map((match) => match[1]))].sort();
const classParams = used(dataClasses.code, /\b(\w+Params)\b/g);
const schemaNames = new Set([...data.reachable].map((ref) => data.typeName(ref)));
for (const ref of data.partResources.keys()) {
  schemaNames.add(ref);
  schemaNames.add(`${ref}Part`);
}
const signatures = dataClasses.code.split("\n").filter((line) => /^  \w+.*\): /.test(line)).join("\n");
const classSchemas = used(signatures, /\b([A-Z]\w+)\b/g).filter((name) => schemaNames.has(name));
files.set(
  "src/generated/resources.ts",
  `${header(data)}import type { ListRequest } from "../core/pagination.js";\nimport { type Identified, ResourceBase } from "../core/resource.js";\nimport type { RequestOptions } from "../core/rest.js";\nimport { METHODS } from "./methods.js";\nimport type {\n  ${classParams.join(",\n  ")},\n} from "./params.js";\nimport type {\n  ${classSchemas.join(",\n  ")},\n} from "./schemas.js";\n\n${dataClasses.code}`,
);

for (const model of others) {
  const schemas = emitSchemas(model);
  const params = emitParams(model);
  const classes = emitClasses(model);
  const needsMany = /OneOrMany</.test(params);
  const needsOwner = /extends OnBehalfOfContentOwner\b/.test(params);
  const imports = ["type Body", needsOwner && "type OnBehalfOfContentOwner", needsMany && "type OneOrMany", "ResourceBase"].filter(Boolean).join(", ");
  files.set(
    `src/generated/${model.api.key}.ts`,
    `${header(model)}import type { ListRequest } from "../core/pagination.js";\nimport { ${imports} } from "../core/resource.js";\nimport type { RequestOptions } from "../core/rest.js";\nimport { METHODS } from "./methods.js";\n\n${schemas}${params}${classes.code}`,
  );
}

const specs = models.flatMap((model) => model.methods.map((method) => emitSpec(model, method))).sort((a, b) => a.id.localeCompare(b.id));
const specLines = specs.map((spec) => `  ${JSON.stringify(spec.id)}: ${JSON.stringify(spec)},`).join("\n");
files.set(
  "src/generated/methods.ts",
  `// Generated by scripts/generate.mjs. Do not edit by hand.\n\nimport type { MethodSpec } from "../core/rest.js";\n\n/** Name of every API method this library knows, for example \`videos.list\`. */\nexport type MethodId =\n${specs.map((spec) => `  | ${JSON.stringify(spec.id)}`).join("\n")};\n\n/** Static facts about each method: HTTP verb, path, quota cost, accepted scopes, pagination. */\nexport const METHODS: Readonly<Record<MethodId, MethodSpec>> = {\n${specLines}\n};\n`,
);

let examples = `// Generated by scripts/generate.mjs. Every doc example of the library, compiled by \`npm run test:types\`.\n\nimport type { YouTube } from "../../src/index.js";\n\n${config.exampleScope}\n\n`;
for (const model of models) {
  for (const method of model.methods) {
    if (!method.meta.example) continue;
    const body = method.meta.example
      .split("\n")
      .map((line) => `  ${line}`)
      .join("\n");
    examples += `export async function ${method.id.replace(/\W/g, "_")}() {\n${body}\n}\n\n`;
  }
}
files.set("test/types/examples.gen.ts", `${examples.trimEnd()}\n`);

let stale = 0;
for (const [path, content] of files) {
  const url = new URL(path, root);
  if (CHECK) {
    const current = await readFile(url, "utf8").catch(() => "");
    if (current.replace(/\r\n/g, "\n") !== content) {
      console.error(`out of date: ${path}`);
      stale++;
    }
    continue;
  }
  await mkdir(new URL(".", url), { recursive: true });
  await writeFile(url, content);
}
if (CHECK) {
  if (stale) {
    console.error("Run `npm run generate` and commit the result.");
    process.exit(1);
  }
  console.log(`generated files are up to date (${files.size} files, ${specs.length} methods)`);
} else {
  const schemaCount = models.reduce((sum, model) => sum + model.reachable.size, 0);
  console.log(`wrote ${files.size} files: ${specs.length} methods, ${schemaCount} schemas, ${data.partResources.size} part-aware resources`);
}
