// The call shown in the playground, as highlighted HTML. Shared by the page
// (first render) and the browser (every change), so the two cannot disagree.

export interface PickerResource {
  call: string;
  id: string;
  variable: string;
  /** The comment shown in place of the result when no part is ticked, in the language of the page. */
  refused: string;
}

const k = (text: string) => `<span class="pp-k">${text}</span>`;
const s = (text: string) => `<span class="pp-s">"${text}"</span>`;
const p = (text: string) => `<span class="pp-p">${text}</span>`;
const c = (text: string) => `<span class="pp-c">${text}</span>`;

export function callHtml(resource: PickerResource, parts: readonly string[]): string {
  // A short list stays on one line; a long one is written one part per line,
  // as a formatter would, so the pane never needs to scroll sideways for it.
  const part =
    parts.length <= 3
      ? [`  part${p(":")} ${p("[")}${parts.map(s).join(p(", "))}${p("],")}`]
      : [`  part${p(":")} ${p("[")}`, ...parts.map((name) => `    ${s(name)}${p(",")}`), `  ${p("],")}`];
  const lines = [
    `${k("const")} ${p("{")} items ${p("}")} ${p("=")} ${k("await")} ${resource.call}${p("({")}`,
    ...part,
    `  id${p(":")} ${s(resource.id)}${p(",")}`,
    `${p("});")}`,
    "",
    parts.length ? `${k("const")} ${resource.variable} ${p("=")} items${p("[")}<span class="pp-n">0</span>${p("];")}` : c(`// ${resource.refused}`),
  ];
  return lines.join("\n");
}
