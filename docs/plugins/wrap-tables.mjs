// Wraps every Markdown table in a scroll container. A table then keeps its
// shape on a phone and scrolls sideways, instead of squeezing its columns
// until words break.

function visit(node, fn) {
  if (!Array.isArray(node.children)) return;
  for (let index = 0; index < node.children.length; index++) {
    const child = node.children[index];
    if (fn(child, index, node) !== false) visit(child, fn);
  }
}

/** The rehype plugin. */
export function rehypeWrapTables() {
  return (tree) => {
    visit(tree, (node, index, parent) => {
      if (node.type !== "element" || node.tagName !== "table") return undefined;
      parent.children[index] = {
        type: "element",
        tagName: "div",
        // Focusable, so a keyboard user can scroll it too.
        properties: { className: ["at-table"], tabIndex: 0, role: "region", ariaLabel: "Table" },
        children: [node],
      };
      return false;
    });
  };
}
