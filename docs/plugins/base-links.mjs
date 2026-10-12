// Internal links in the docs are written root-relative ("/api/store/"), with no
// knowledge of where the site is hosted nor of the language of the page. This
// remark plugin prepends the language and the configured base path at build
// time, so moving the site (another domain, a sub-path, the root) is a
// configuration change, and a translated page keeps the links of its original.

/** Normalises a base path to "" (root) or "/segment" with no trailing slash. */
export function normalizeBase(base) {
  const trimmed = String(base ?? "").replace(/^\/+|\/+$/g, "");
  return trimmed ? `/${trimmed}` : "";
}

/**
 * Prefixes a root-relative URL with the base path. External URLs, anchors,
 * protocol-relative URLs and URLs that already carry the base are left alone.
 */
export function withBase(url, base) {
  const prefix = normalizeBase(base);
  if (typeof url !== "string" || !prefix) return url;
  if (!url.startsWith("/") || url.startsWith("//")) return url;
  if (url === prefix || url.startsWith(`${prefix}/`)) return url;
  return prefix + url;
}

/**
 * The languages the site is translated into. English is the original: its
 * pages sit at the root of the content and of the site, a translation sits in
 * a folder named after its language, at the same paths.
 */
export const LOCALES = ["fr"];

/** The language of a content file ("fr"), or undefined for an English page. */
export function localeOfFile(file) {
  const match = /[\\/]content[\\/]docs[\\/]([a-z]{2}(?:-[a-z]{2})?)[\\/]/i.exec(String(file ?? ""));
  return match && LOCALES.includes(match[1].toLowerCase()) ? match[1].toLowerCase() : undefined;
}

/** The language of a site path without its base ("/fr/quick-start/"), or undefined. */
export function localeOfPath(pathname) {
  const first = String(pathname ?? "").split("/").filter(Boolean)[0];
  return LOCALES.includes(first) ? first : undefined;
}

/**
 * Sends a root-relative link to the page of the given language. Links are
 * written once, as in English ("/data/store/"); a French page gets
 * "/fr/data/store/". Files (an image, a download) have no translation.
 */
export function withLocale(url, locale) {
  if (!locale || typeof url !== "string") return url;
  if (!url.startsWith("/") || url.startsWith("//")) return url;
  if (localeOfPath(url)) return url;
  if (/\.[a-z0-9]+(?:[?#].*)?$/i.test(url)) return url;
  return `/${locale}${url}`;
}

/** The same page in another language: "/fr/data/store/" <-> "/data/store/". */
export function switchLocale(pathname, locale) {
  const current = localeOfPath(pathname);
  const bare = current ? pathname.replace(new RegExp(`^/${current}(?=/|$)`), "") || "/" : pathname;
  return locale ? `/${locale}${bare}` : bare;
}

/** Attributes of MDX components that hold an internal link. */
const LINK_ATTRIBUTES = new Set(["href", "link"]);

function visit(node, fn) {
  fn(node);
  if (Array.isArray(node.children)) for (const child of node.children) visit(child, fn);
}

/** The remark plugin. `options.base` is the site's base path. */
export function remarkBaseLinks(options = {}) {
  const { base } = options;
  return (tree, file) => {
    const locale = localeOfFile(file?.path ?? file?.history?.[0]);
    const resolve = (url) => withBase(withLocale(url, locale), base);
    visit(tree, (node) => {
      // [text](/path) and [ref]: /path
      if ((node.type === "link" || node.type === "definition") && typeof node.url === "string") {
        node.url = resolve(node.url);
        return;
      }
      // <LinkCard href="/path" /> in .mdx files
      if (node.type === "mdxJsxFlowElement" || node.type === "mdxJsxTextElement") {
        for (const attribute of node.attributes ?? []) {
          if (attribute.type === "mdxJsxAttribute" && LINK_ATTRIBUTES.has(attribute.name)) {
            if (typeof attribute.value === "string") attribute.value = resolve(attribute.value);
          }
        }
      }
    });
  };
}
