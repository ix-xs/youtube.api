// Wraps every Markdown table in a scroll container. A table then keeps its
// shape on a phone and scrolls sideways, instead of squeezing its columns
// until words break.

import { localeOfFile } from "./base-links.mjs";

/** What a screen reader calls the scrolling region, in the language of the page. */
const LABELS = { en: "Table", fr: "Tableau" };

function visit(node, fn) {
  if (!Array.isArray(node.children)) return;
  for (let index = 0; index < node.children.length; index++) {
    const child = node.children[index];
    if (fn(child, index, node) !== false) visit(child, fn);
  }
}

/** The rehype plugin. */
export function rehypeWrapTables() {
  return (tree, file) => {
    const label = LABELS[localeOfFile(file?.path ?? file?.history?.[0]) ?? "en"] ?? LABELS.en;
    visit(tree, (node, index, parent) => {
      if (node.type !== "element" || node.tagName !== "table") return undefined;
      parent.children[index] = {
        type: "element",
        tagName: "div",
        // Focusable, so a keyboard user can scroll it too.
        properties: { className: ["at-table"], tabIndex: 0, role: "region", ariaLabel: label },
        children: [node],
      };
      return false;
    });
  };
}
