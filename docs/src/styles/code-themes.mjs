// The two syntax themes of the site. Restrained on purpose: red for the
// language's own words, sage for strings, a warm tone for numbers, and the
// text colour for everything you named yourself.

function theme(name, type, c) {
  return {
    name,
    type,
    colors: {
      "editor.background": c.surface,
      "editor.foreground": c.fg,
      "editor.selectionBackground": c.selection,
      "editorLineNumber.foreground": c.faint,
      "editorGroupHeader.tabsBackground": c.surface,
      "editorGroupHeader.tabsBorder": c.line,
      "tab.activeBackground": c.surface,
      "tab.activeForeground": c.fg,
      "tab.activeBorder": c.accent,
      "tab.border": c.surface,
      "titleBar.activeBackground": c.surface,
      "titleBar.activeForeground": c.faint,
      "titleBar.border": c.line,
      "terminal.background": c.surface,
      "terminal.foreground": c.fg,
      "panel.border": c.line,
      focusBorder: c.accent,
    },
    tokenColors: [
      { scope: ["comment", "punctuation.definition.comment"], settings: { foreground: c.faint, fontStyle: "italic" } },
      { scope: ["string", "string.template", "punctuation.definition.string"], settings: { foreground: c.string } },
      { scope: ["constant.numeric", "constant.language", "constant.character.escape"], settings: { foreground: c.number } },
      {
        scope: ["keyword", "storage", "storage.type", "storage.modifier", "keyword.control", "keyword.operator.new", "keyword.operator.expression", "variable.language.this"],
        settings: { foreground: c.keyword },
      },
      { scope: ["keyword.operator", "punctuation", "meta.brace", "meta.delimiter"], settings: { foreground: c.muted } },
      { scope: ["entity.name.function", "support.function", "meta.function-call entity.name.function"], settings: { foreground: c.fg } },
      { scope: ["entity.name.type", "entity.name.class", "support.type", "support.class", "entity.other.inherited-class"], settings: { foreground: c.type } },
      { scope: ["variable", "variable.other", "variable.parameter", "meta.object-literal.key", "support.variable"], settings: { foreground: c.fg } },
      { scope: ["entity.name.tag", "support.type.property-name", "entity.other.attribute-name"], settings: { foreground: c.keyword } },
      { scope: ["markup.heading", "markup.bold"], settings: { foreground: c.fg, fontStyle: "bold" } },
      { scope: ["markup.inserted"], settings: { foreground: c.string } },
      { scope: ["markup.deleted"], settings: { foreground: c.number } },
    ],
  };
}

export const atelierDark = theme("atelier-dark", "dark", {
  surface: "#191917",
  line: "#2b2a26",
  fg: "#edebe4",
  muted: "#a29f95",
  faint: "#8a877d",
  accent: "#ff4e45",
  keyword: "#ff8f87",
  string: "#a9c49f",
  number: "#e0b96a",
  type: "#c9c2ae",
  selection: "#3d1b19",
});

export const atelierLight = theme("atelier-light", "light", {
  surface: "#fffdf8",
  line: "#e1ddd0",
  fg: "#1b1a16",
  muted: "#5d594e",
  faint: "#7a7567",
  accent: "#c2180f",
  keyword: "#b3261e",
  string: "#3c6a39",
  number: "#8a6100",
  type: "#4f4a3c",
  selection: "#f8dcd8",
});
