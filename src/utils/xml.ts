/** A parsed XML element. */
export interface XmlNode {
  /** Tag name with its prefix, for example `yt:videoId`. */
  name: string;
  attributes: Record<string, string>;
  children: XmlNode[];
  /** Text directly inside the element. */
  text: string;
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
/** Nesting beyond this is flattened: no feed comes close, and it bounds the work on hostile input. */
const MAX_DEPTH = 64;
/** A tag longer than this keeps its name and loses its attributes. */
const MAX_TAG = 4096;

function decode(text: string): string {
  if (!text.includes("&")) return text;
  return text.replace(/&(#x[\da-f]{1,6}|#\d{1,7}|\w{1,10});/gi, (whole, entity: string) => {
    if (entity[0] === "#") {
      const code = entity[1] === "x" || entity[1] === "X" ? Number.parseInt(entity.slice(2), 16) : Number.parseInt(entity.slice(1), 10);
      return code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff) ? String.fromCodePoint(code) : whole;
    }
    return ENTITIES[entity] ?? whole;
  });
}

/** Index of the `>` that closes a tag opened before `from`, skipping quoted attribute values. */
function tagEnd(source: string, from: number): number {
  let quote = "";
  for (let index = from; index < source.length; index++) {
    const char = source[index]!;
    if (quote) {
      if (char === quote) quote = "";
    } else if (char === '"' || char === "'") quote = char;
    else if (char === ">") return index;
  }
  return -1;
}

/**
 * A small XML reader, enough for the Atom documents YouTube produces. It is
 * not a validating parser: malformed input gives a partial tree, never an
 * exception. It reads its input once, left to right, so the time it takes
 * grows with the size of the document and nothing else.
 *
 * @internal
 */
export function parseXml(source: string): XmlNode {
  const root: XmlNode = { name: "#document", attributes: {}, children: [], text: "" };
  const stack: XmlNode[] = [root];
  let position = 0;

  while (position < source.length) {
    const current = stack[stack.length - 1]!;
    const open = source.indexOf("<", position);
    if (open === -1) {
      current.text += decode(source.slice(position));
      break;
    }
    if (open > position) current.text += decode(source.slice(position, open));

    if (source.startsWith("<![CDATA[", open)) {
      const close = source.indexOf("]]>", open + 9);
      current.text += source.slice(open + 9, close === -1 ? source.length : close);
      if (close === -1) break;
      position = close + 3;
      continue;
    }
    if (source.startsWith("<!--", open)) {
      const close = source.indexOf("-->", open + 4);
      if (close === -1) break;
      position = close + 3;
      continue;
    }

    const close = tagEnd(source, open + 1);
    if (close === -1) break;
    const inner = source.slice(open + 1, close);
    position = close + 1;
    // Declarations and processing instructions carry nothing we read.
    if (inner[0] === "?" || inner[0] === "!") continue;

    if (inner[0] === "/") {
      const name = inner.slice(1).trim();
      for (let index = stack.length - 1; index > 0; index--) {
        if (stack[index]!.name === name) {
          stack.length = index;
          break;
        }
      }
      continue;
    }

    const selfClosing = inner.endsWith("/");
    const body = selfClosing ? inner.slice(0, -1) : inner;
    const space = body.search(/\s/);
    const name = space === -1 ? body : body.slice(0, space);
    if (!name) continue;
    const node: XmlNode = { name, attributes: {}, children: [], text: "" };
    if (space !== -1 && body.length <= MAX_TAG) {
      for (const attribute of body.slice(space).matchAll(/([^\s=]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) {
        node.attributes[attribute[1]!] = decode(attribute[2] ?? attribute[3] ?? "");
      }
    }
    current.children.push(node);
    if (!selfClosing && stack.length < MAX_DEPTH) stack.push(node);
  }
  return root;
}

/** First direct child with that tag name. */
export function child(node: XmlNode | undefined, name: string): XmlNode | undefined {
  return node?.children.find((candidate) => candidate.name === name);
}

/** Every direct child with that tag name. */
export function children(node: XmlNode | undefined, name: string): XmlNode[] {
  return node?.children.filter((candidate) => candidate.name === name) ?? [];
}

/** Trimmed text of a direct child, or `undefined`. */
export function textOf(node: XmlNode | undefined, name: string): string | undefined {
  const value = child(node, name)?.text.trim();
  return value || undefined;
}
