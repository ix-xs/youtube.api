// The words of the site's own interface (header, search, landing page), in
// each language. Starlight translates its own; page content is translated in
// `src/content/docs/<language>/`.
import { withBase, withLocale } from "../plugins/base-links.mjs";

const en = {
  // Header
  "nav.sections": "Sections",
  "nav.docs": "Docs",
  "nav.recipes": "Recipes",
  "nav.reference": "Reference",
  "nav.github": "GitHub repository",
  "nav.theme": "Switch between dark and light",
  "nav.language": "Language",

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

  // The playground of the landing page
  "picker.resource": "Resource",
  "picker.parts": "Parts to request",
  "picker.write": "You write",
  "picker.writeLabel": "The call you write",
  "picker.read": "You can read",
  "picker.readLabel": "What the result lets you read",
  "picker.off": "not requested: does not compile",
  "picker.live": "Only live videos have it, so it stays optional even when requested.",
  "picker.quota": "Quota: <strong>1 unit</strong> per call, whatever the parts.",
  "picker.empty": "Pick at least one part.",
  "picker.refused": "The API refuses a call without parts.",
} as const;

export type UiKey = keyof typeof en;

const fr: Record<UiKey, string> = {
  "nav.sections": "Rubriques",
  "nav.docs": "Docs",
  "nav.recipes": "Recettes",
  "nav.reference": "Référence",
  "nav.github": "Dépôt GitHub",
  "nav.theme": "Basculer entre sombre et clair",
  "nav.language": "Langue",

  "area.start": "Démarrer",
  "area.basics": "Bases",
  "area.auth": "Authentification",
  "area.resources": "Ressources",
  "area.live": "Direct",
  "area.notifications": "Notifications",
  "area.analytics": "Analytics",
  "area.recipes": "Recettes",
  "area.reference": "Référence",

  "search.recent": "Ouvertes récemment",
  "search.clear": "Effacer",
  "search.start": "Pour commencer",
  "search.try": "Essayer une recherche",
  "search.move": "naviguer",
  "search.open": "ouvrir",
  "search.close": "fermer",

  "hero.eyebrow": "Un client de l'API YouTube pour JavaScript et TypeScript",
  "hero.copy": "Copier la commande d'installation",
  "hero.facts": "Open source, MIT|Aucune dépendance|Node, Bun, Deno, navigateurs, edge",

  "picker.resource": "Ressource",
  "picker.parts": "Parties à demander",
  "picker.write": "Vous écrivez",
  "picker.writeLabel": "L'appel que vous écrivez",
  "picker.read": "Vous pouvez lire",
  "picker.readLabel": "Ce que le résultat vous laisse lire",
  "picker.off": "non demandée : ne compile pas",
  "picker.live": "Seules les vidéos en direct l'ont : elle reste optionnelle même demandée.",
  "picker.quota": "Quota : <strong>1 unité</strong> par appel, quelles que soient les parties.",
  "picker.empty": "Choisissez au moins une partie.",
  "picker.refused": "L'API refuse un appel sans partie.",
};

const DICTIONARIES: Record<string, Record<UiKey, string>> = { en, fr };

/** The languages of the site, in the order the switch lists them. `locale` is the folder and URL prefix. */
export const LANGUAGES = [
  { locale: undefined, code: "en", label: "English" },
  { locale: "fr", code: "fr", label: "Français" },
] as const;

/**
 * The translator for a page: `t("search.clear")`. `locale` is Starlight's
 * (`undefined` for English).
 */
export function useT(locale: string | undefined) {
  const dictionary = DICTIONARIES[locale ?? "en"] ?? en;
  return (key: UiKey, values: Record<string, string> = {}): string =>
    (dictionary[key] ?? en[key]).replace(/\{(\w+)\}/g, (whole, name: string) => values[name] ?? whole);
}

/** A link written as in English ("/start/quick-start/"), for a page in `locale` and the site's base path. */
export function href(path: string, locale: string | undefined): string {
  return withBase(withLocale(path, locale), import.meta.env.BASE_URL);
}
