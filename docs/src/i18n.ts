// The words of the site's own interface (header, search, landing page).
// Starlight translates its own; page content lives in `src/content/docs/`.
// Adding a language means adding a dictionary here and a folder there.
import { withBase, withLocale } from "../plugins/base-links.mjs";

const en = {
  // Header
  "nav.sections": "Sections",
  "nav.docs": "Docs",
  "nav.recipes": "Recipes",
  "nav.reference": "Reference",
  "nav.github": "GitHub repository",
  "nav.theme": "Switch between dark and light",

  // Names of the parts of the documentation, as the sidebar writes them
  "area.start": "Start",
  "area.basics": "Basics",
  "area.auth": "Authentication",
  "area.resources": "Resources",
  "area.live": "Live",
  "area.notifications": "Notifications",
  "area.analytics": "Analytics",
  "area.recipes": "Recipes",
  "area.reference": "Reference",

  // Search
  "search.recent": "Recently opened",
  "search.clear": "Clear",
  "search.start": "Start here",
  "search.try": "Try a search",
  "search.move": "move",
  "search.open": "open",
  "search.close": "close",

  // Landing page
  "hero.eyebrow": "A YouTube API client for JavaScript and TypeScript",
  "hero.copy": "Copy the install command",
  "hero.facts": "Open source, MIT|No dependency|Node, Bun, Deno, browsers, edge",
} as const;

export type UiKey = keyof typeof en;

const DICTIONARIES: Record<string, Record<UiKey, string>> = { en };

/**
 * The translator for a page: `t("search.clear")`. `locale` is Starlight's
 * (`undefined` for English).
 */
export function useT(locale: string | undefined) {
  const dictionary = DICTIONARIES[locale ?? "en"] ?? en;
  return (key: UiKey, values: Record<string, string> = {}): string =>
    (dictionary[key] ?? en[key]).replace(/\{(\w+)\}/g, (whole, name: string) => values[name] ?? whole);
}

/** A link written as in the content ("/start/quick-start/"), for a page in `locale` and the site's base path. */
export function href(path: string, locale: string | undefined): string {
  return withBase(withLocale(path, locale), import.meta.env.BASE_URL);
}
