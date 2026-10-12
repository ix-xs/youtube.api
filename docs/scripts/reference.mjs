// Writes the pages and data of the site that come straight from the library,
// so they cannot drift from it:
//
//   src/content/docs/reference/methods.md       every API method
//   src/content/docs/reference/quota-costs.md   what each method costs
//   src/content/docs/reference/exports.md       every export of the package
//   src/content/docs/fr/reference/*.md          the same three pages in French
//   src/data/parts.json                         the landing page's playground
//   src/data/parts.worst.json                   the same with the worst real data, to test the playground
//
//   node scripts/reference.mjs           write the files
//   node scripts/reference.mjs --check   fail if a file is out of date

import { existsSync, readFileSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as config from "../../scripts/api.config.mjs";

const CHECK = process.argv.includes("--check");
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..", "..");
const require = createRequire(path.join(root, "package.json"));
const ts = require("typescript");

const read = async (file) => JSON.parse(await readFile(path.join(root, file), "utf8"));
const discovery = {
  data: await read("scripts/discovery/youtube.v3.json"),
  analytics: await read("scripts/discovery/youtubeAnalytics.v2.json"),
  reporting: await read("scripts/discovery/youtubereporting.v1.json"),
};
const docsLinks = await read("scripts/docs-links.json");

// ---------------------------------------------------------------- methods

const APIS = [
  { key: "data", strip: "youtube.", accessor: "yt", title: "YouTube Data API v3" },
  { key: "analytics", strip: "youtubeAnalytics.", accessor: "yt.analytics", title: "YouTube Analytics API" },
  { key: "reporting", strip: "youtubereporting.", accessor: "yt.reporting", title: "YouTube Reporting API" },
];
const RENAMED = { "youtube.v3.liveChat.messages.stream": "liveChatMessages.stream" };
const LIVE = new Set(["liveBroadcasts", "liveStreams", "liveChatMessages", "liveChatBans", "liveChatModerators", "superChatEvents"]);
const ORDER = ["list", "get", "query", "insert", "create", "update", "set", "unset", "rate", "getRating"];

/** The guide that covers a resource, when there is one. */
const GUIDES = {
  channels: "/resources/channels/",
  channelSections: "/resources/channels/",
  channelBanners: "/resources/uploads/",
  videos: "/resources/videos/",
  videoCategories: "/resources/videos/",
  playlists: "/resources/playlists/",
  playlistItems: "/resources/playlists/",
  playlistImages: "/resources/uploads/",
  search: "/resources/search/",
  comments: "/resources/comments/",
  commentThreads: "/resources/comments/",
  subscriptions: "/resources/subscriptions/",
  captions: "/resources/captions/",
  thumbnails: "/resources/uploads/",
  watermarks: "/resources/uploads/",
  liveBroadcasts: "/live/broadcasts/",
  liveStreams: "/live/broadcasts/",
  liveChatMessages: "/live/live-chat/",
  liveChatBans: "/live/live-chat/",
  liveChatModerators: "/live/live-chat/",
  superChatEvents: "/live/live-chat/",
  "analytics.reports": "/analytics/analytics/",
  "analytics.groups": "/analytics/analytics/",
  "analytics.groupItems": "/analytics/analytics/",
  "reporting.jobs": "/analytics/reporting/",
  "reporting.reports": "/analytics/reporting/",
  "reporting.reportTypes": "/analytics/reporting/",
  "reporting.media": "/analytics/reporting/",
};

function flatten(resources, out = []) {
  for (const resource of Object.values(resources ?? {})) {
    for (const method of Object.values(resource.methods ?? {})) out.push(method);
    flatten(resource.resources, out);
  }
  return out;
}

const firstSentence = (text) => {
  const match = /^(.*?[.!?])(\s|$)/s.exec(text.trim());
  return (match ? match[1] : text.trim()).replace(/\s+/g, " ");
};

const methods = [];
for (const api of APIS) {
  for (const raw of flatten(discovery[api.key].resources)) {
    if (config.omit.includes(raw.id)) continue;
    const meta = config.methods[raw.id];
    let local = raw.id.slice(api.strip.length);
    local = RENAMED[local] ?? local;
    const segments = local.split(".");
    const name = segments.pop();
    const resource = segments.at(-1);
    const oauth = api.key !== "data" || meta.auth === "oauth" || raw.httpMethod !== "GET";
    let call = `${api.accessor}.${resource}.${name}`;
    if (raw.id === "youtubeAnalytics.reports.query") call = "yt.analytics.query";
    if (raw.id === "youtubereporting.media.download") call = "yt.reporting.download";
    methods.push({
      api,
      resource,
      name,
      call,
      id: (api.key === "data" ? "" : `${api.key}.`) + local,
      summary: firstSentence(meta.summary),
      quota: api.key === "data" ? meta.quota : undefined,
      bucket: meta.bucket,
      oauth,
      deprecated: Boolean(meta.deprecated),
      docs: docsLinks[raw.id],
      live: LIVE.has(resource),
      guide: GUIDES[api.key === "data" ? resource : `${api.key}.${resource}`],
    });
  }
}

// ------------------------------------------------------------------ words

/** The languages the pages are written in: English, then the translations. */
const LANGUAGES = ["en", "fr"];
const content = path.join(here, "..", "src", "content", "docs");

/**
 * The words of the pages themselves. What describes a method or an export
 * comes from the source, in English, as an editor shows it.
 */
const WORDS = {
  en: {
    methods: {
      title: "Every method",
      description: (count) => `The ${count} methods of the YouTube Data, Analytics and Reporting APIs, with what each one does, what it costs and the credentials it needs.`,
      intro: "Each method name links to Google's reference for it. The same information is in your editor: hover a method to see its description, its quota cost and an example.",
      quota: "- **Quota** is the cost of one call in units. Three methods draw from a bucket of their own instead: see [Quota](/basics/quota/).",
      auth: "- **Auth** is `key` when an API key is enough for public data, `OAuth` when the method always needs a user. A `key` method still needs OAuth for private data or with parameters such as `mine`.",
      count: (count, live) => `${count} methods${live ? ", live streaming included" : ""}.`,
      live: "Live streaming",
      liveNote: "These methods are part of the Data API and share its quota.",
      guide: (title, link) => `Guide: [${title}](${link}).`,
      columns: "| Method | What it does | Quota | Auth |",
      shortColumns: "| Method | What it does |",
      deprecated: "Deprecated.",
      bucket: (name) => `1 call, \`${name}\` bucket`,
      key: "key",
    },
    quota: {
      title: "Quota costs",
      description: "What every method of the YouTube Data API costs, sorted from the cheapest to the most expensive.",
      intro:
        "The numbers come from YouTube's [quota calculator](https://developers.google.com/youtube/v3/determine_quota_cost) and from the method pages for the ones the calculator leaves out. They are what `yt.quota` counts and what `quotaCost()` returns. [Quota](/basics/quota/) explains how the buckets work and how to spend less.",
      own: "Methods with their own bucket",
      ownNote: "Calls to these are not counted in units of the shared budget. Each has a daily allowance of its own.",
      columns: "| Method | Default allowance | Cost of a call |",
      allowance: { "search.list": "100 calls a day", "videos.insert": "100 calls a day", "videos.batchGetStats": "10,000 calls a day" },
      shared: "Shared budget",
      sharedNote: "Everything else draws from one budget of 10,000 units a day by default.",
      units: (units) => `${units} unit${units === 1 ? "" : "s"}`,
      other: "Analytics and Reporting",
      otherNote:
        "The Analytics and Reporting APIs are not billed in units. They have request rate limits of their own, visible in the Google Cloud console. `yt.quota.usage` counts their calls under `analytics` and `reporting` for information.",
    },
    exports: {
      title: "All exports",
      description: "Everything the package exports, with one line on what each thing is.",
      intro: "Two entry points: `@ix-xs/youtube.api` runs anywhere `fetch` does, `@ix-xs/youtube.api/node` holds the few helpers that need Node.js itself.",
      classes: "Classes",
      functions: "Functions",
      constants: "Constants",
      types: "Types",
      columns: "| Name | What it is |",
      generated: "Generated types",
      generatedNote: "These come from Google's API description and follow its names.",
      resources: "Resources",
      resourcesNote: (count) =>
        `${count} resources are addressed by \`part\`. Each has three types: \`Video<"snippet" | "statistics">\` is the resource narrowed to those parts, \`VideoPart\` is the union of its part names, and \`VideoResource\` is the full resource with every part optional (\`Video\` alone means the same).`,
      schemas: "Other schemas",
      schemasNote: (count) =>
        `${count} interfaces describe everything else the API sends or accepts: the parts themselves (\`VideoSnippet\`, \`ChannelStatistics\`), list responses (\`VideoListResponse\`) and nested objects (\`Thumbnail\`, \`ResourceId\`). Types of the Analytics and Reporting APIs carry an \`Analytics\` or \`Reporting\` prefix.`,
      params: "Parameters",
      paramsNote: (count) => `One interface per method, named after it: \`VideosListParams\`, \`PlaylistItemsInsertParams\`, \`AnalyticsGroupsListParams\`. There are ${count}.`,
      methodClasses: "Method classes",
      methodClassesNote: (count) =>
        `${count} classes hold the methods of each resource, such as \`PlaylistItemsApi\` behind \`yt.playlistItems\`. You reach them through the client and rarely name them. \`MethodId\` is the union of every method name.`,
    },
  },
  fr: {
    methods: {
      title: "Toutes les méthodes",
      description: (count) => `Les ${count} méthodes des API YouTube Data, Analytics et Reporting, avec ce que fait chacune, ce qu'elle coûte et les identifiants qu'elle demande.`,
      intro:
        "Chaque nom de méthode mène à la référence de Google. Les mêmes informations sont dans votre éditeur : survolez une méthode pour voir sa description, son coût en quota et un exemple. Les descriptions viennent du code source, en anglais comme dans votre éditeur.",
      quota: "- **Quota** est le coût d'un appel, en unités. Trois méthodes puisent dans une enveloppe qui leur est propre : voir [Quota](/basics/quota/).",
      auth: "- **Auth** vaut `clé` quand une clé d'API suffit pour les données publiques, `OAuth` quand la méthode demande toujours un utilisateur. Une méthode `clé` demande quand même OAuth pour des données privées ou avec des paramètres comme `mine`.",
      count: (count, live) => `${count} méthodes${live ? ", diffusion en direct comprise" : ""}.`,
      live: "Diffusion en direct",
      liveNote: "Ces méthodes font partie de l'API Data et partagent son quota.",
      guide: (title, link) => `Guide : [${title}](${link}).`,
      columns: "| Méthode | Ce qu'elle fait | Quota | Auth |",
      shortColumns: "| Méthode | Ce qu'elle fait |",
      deprecated: "Dépréciée.",
      bucket: (name) => `1 appel, enveloppe \`${name}\``,
      key: "clé",
    },
    quota: {
      title: "Coûts en quota",
      description: "Ce que coûte chaque méthode de l'API YouTube Data, de la moins chère à la plus chère.",
      intro:
        "Les chiffres viennent du [calculateur de quota](https://developers.google.com/youtube/v3/determine_quota_cost) de YouTube et, pour les méthodes qu'il ne liste pas, de leur page de référence. Ce sont ceux que `yt.quota` compte et que `quotaCost()` renvoie. [Quota](/basics/quota/) explique le fonctionnement des enveloppes et comment dépenser moins.",
      own: "Méthodes avec leur propre enveloppe",
      ownNote: "Les appels à ces méthodes ne sont pas comptés en unités du budget commun. Chacune a sa propre allocation quotidienne.",
      columns: "| Méthode | Allocation par défaut | Coût d'un appel |",
      allowance: { "search.list": "100 appels par jour", "videos.insert": "100 appels par jour", "videos.batchGetStats": "10 000 appels par jour" },
      shared: "Budget commun",
      sharedNote: "Tout le reste puise dans un seul budget, de 10 000 unités par jour par défaut.",
      units: (units) => `${units} unité${units === 1 ? "" : "s"}`,
      other: "Analytics et Reporting",
      otherNote:
        "Les API Analytics et Reporting ne sont pas facturées en unités. Elles ont leurs propres limites de débit, visibles dans la console Google Cloud. `yt.quota.usage` compte leurs appels sous `analytics` et `reporting`, à titre indicatif.",
    },
    exports: {
      title: "Tous les exports",
      description: "Tout ce que le paquet exporte, avec une ligne sur ce qu'est chaque élément.",
      intro:
        "Deux points d'entrée : `@ix-xs/youtube.api` fonctionne partout où `fetch` existe, `@ix-xs/youtube.api/node` regroupe les quelques fonctions qui ont besoin de Node.js lui-même. Les descriptions viennent des commentaires du code source, en anglais comme dans votre éditeur.",
      classes: "Classes",
      functions: "Fonctions",
      constants: "Constantes",
      types: "Types",
      columns: "| Nom | Ce que c'est |",
      generated: "Types générés",
      generatedNote: "Ils viennent de la description de l'API publiée par Google et en reprennent les noms.",
      resources: "Ressources",
      resourcesNote: (count) =>
        `${count} ressources se lisent par \`part\`. Chacune a trois types : \`Video<"snippet" | "statistics">\` est la ressource réduite à ces parties, \`VideoPart\` est l'union des noms de ses parties, et \`VideoResource\` est la ressource complète, toutes parties optionnelles (\`Video\` seul veut dire la même chose).`,
      schemas: "Autres schémas",
      schemasNote: (count) =>
        `${count} interfaces décrivent tout le reste de ce que l'API envoie ou accepte : les parties elles-mêmes (\`VideoSnippet\`, \`ChannelStatistics\`), les réponses de liste (\`VideoListResponse\`) et les objets imbriqués (\`Thumbnail\`, \`ResourceId\`). Les types des API Analytics et Reporting portent le préfixe \`Analytics\` ou \`Reporting\`.`,
      params: "Paramètres",
      paramsNote: (count) => `Une interface par méthode, nommée d'après elle : \`VideosListParams\`, \`PlaylistItemsInsertParams\`, \`AnalyticsGroupsListParams\`. Il y en a ${count}.`,
      methodClasses: "Classes de méthodes",
      methodClassesNote: (count) =>
        `${count} classes portent les méthodes de chaque ressource, comme \`PlaylistItemsApi\` derrière \`yt.playlistItems\`. Vous y accédez par le client et les nommez rarement. \`MethodId\` est l'union de tous les noms de méthodes.`,
    },
  },
};

/** The name of a guide in a language: the title of its translation when there is one. */
function guideName(address, language) {
  const slug = address.replace(/^\/|\/$/g, "");
  const fallback = slug.split("/").pop().replace(/-/g, " ");
  if (language === "en") return fallback;
  for (const extension of [".md", ".mdx"]) {
    const file = path.join(content, language, slug + extension);
    if (!existsSync(file)) continue;
    const title = /^title:\s*(.+)$/m.exec(readFileSync(file, "utf8"))?.[1];
    if (title) return title.trim().replace(/^(["'])(.*)\1$/, "$2");
  }
  return fallback;
}

const NOTICE = `<!-- Generated by docs/scripts/reference.mjs. Edit scripts/api.config.mjs, then run "npm run reference" in docs/. -->`;
const linked = (method) => (method.docs ? `[\`${method.call}\`](${method.docs})` : `\`${method.call}\``);

function methodsPage(language) {
  const words = WORDS[language].methods;
  const cost = (method) => (method.quota === undefined ? "" : method.bucket ? words.bucket(method.bucket) : String(method.quota));
  const counts = APIS.map((api) => methods.filter((method) => method.api === api).length);
  let out = `---
title: ${words.title}
description: ${words.description(methods.length)}
---

${NOTICE}

${words.intro}

${words.quota}
${words.auth}

`;
  APIS.forEach((api, index) => {
    const own = methods.filter((method) => method.api === api);
    const sections = api.key === "data" ? [["", own.filter((method) => !method.live)], [words.live, own.filter((method) => method.live)]] : [["", own]];
    out += `## ${api.title}\n\n${words.count(counts[index], api.key === "data")}\n\n`;
    for (const [title, list] of sections) {
      if (title) out += `## ${title}\n\n${words.liveNote}\n\n`;
      const groups = new Map();
      for (const method of list) groups.set(method.resource, [...(groups.get(method.resource) ?? []), method]);
      for (const [resource, group] of [...groups].sort(([a], [b]) => a.localeCompare(b))) {
        group.sort((a, b) => (ORDER.indexOf(a.name) === -1 ? 50 : ORDER.indexOf(a.name)) - (ORDER.indexOf(b.name) === -1 ? 50 : ORDER.indexOf(b.name)) || a.name.localeCompare(b.name));
        out += `### ${resource}\n\n`;
        if (group[0].guide) out += `${words.guide(guideName(group[0].guide, language), group[0].guide)}\n\n`;
        out += api.key === "data" ? `${words.columns}\n| --- | --- | --- | --- |\n` : `${words.shortColumns}\n| --- | --- |\n`;
        for (const method of group) {
          const what = method.deprecated ? `${words.deprecated} ${method.summary}` : method.summary;
          out += api.key === "data" ? `| ${linked(method)} | ${what} | ${cost(method)} | ${method.oauth ? "OAuth" : words.key} |\n` : `| ${linked(method)} | ${what} |\n`;
        }
        out += "\n";
      }
    }
  });
  return out;
}

function quotaPage(language) {
  const words = WORDS[language].quota;
  const data = methods.filter((method) => method.api.key === "data");
  const tiers = new Map();
  for (const method of data.filter((item) => !item.bucket)) tiers.set(method.quota, [...(tiers.get(method.quota) ?? []), method]);
  let out = `---
title: ${words.title}
description: ${words.description}
---

${NOTICE}

${words.intro}

## ${words.own}

${words.ownNote}

${words.columns}
| --- | --- | --- |
`;
  for (const method of data.filter((item) => item.bucket)) out += `| \`${method.call}\` | ${words.allowance[method.bucket]} | 1 |\n`;
  out += `\n## ${words.shared}\n\n${words.sharedNote}\n\n`;
  for (const [units, list] of [...tiers].sort(([a], [b]) => a - b)) {
    out += `### ${words.units(units)}\n\n`;
    out += `${list.map((method) => `\`${method.call.replace(/^yt\./, "")}\``).join(", ")}\n\n`;
  }
  out += `## ${words.other}\n\n${words.otherNote}\n`;
  return out;
}

// ---------------------------------------------------------------- exports

/** What the two entry points export, read once from the source. */
function readExports() {
  const entry = path.join(root, "src", "index.ts");
  const nodeEntry = path.join(root, "src", "node.ts");
  const program = ts.createProgram([entry, nodeEntry], {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.NodeNext,
    moduleResolution: ts.ModuleResolutionKind.NodeNext,
    strict: true,
    skipLibCheck: true,
    lib: ["lib.es2022.d.ts", "lib.dom.d.ts", "lib.dom.iterable.d.ts"],
    types: ["node"],
    noEmit: true,
  });
  const checker = program.getTypeChecker();

  const describe = (file) => {
    const source = program.getSourceFile(file);
    const moduleSymbol = checker.getSymbolAtLocation(source);
    return checker.getExportsOfModule(moduleSymbol).map((exported) => {
      const symbol = exported.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(exported) : exported;
      const declaration = symbol.declarations?.[0];
      const generated = declaration?.getSourceFile().fileName.includes("/generated/") ?? false;
      let kind = "type";
      if (symbol.flags & ts.SymbolFlags.Class) kind = "class";
      else if (symbol.flags & ts.SymbolFlags.Function) kind = "function";
      else if (symbol.flags & ts.SymbolFlags.Variable) kind = "constant";
      const doc = ts.displayPartsToString(symbol.getDocumentationComment(checker)).trim();
      return { name: exported.getName(), kind, generated, summary: doc ? firstSentence(doc.split("\n\n")[0]) : "" };
    });
  };

  const main = describe(entry);
  const node = describe(nodeEntry);
  const handwritten = main.filter((item) => !item.generated);
  const generated = main.filter((item) => item.generated);
  const params = generated.filter((item) => item.kind === "type" && item.name.endsWith("Params"));
  const partTypes = generated.filter((item) => item.kind === "type" && item.name.endsWith("Part"));
  const undocumented = handwritten.filter((item) => !item.summary).map((item) => item.name);
  if (undocumented.length) throw new Error(`Exports without a doc comment: ${undocumented.join(", ")}`);
  return {
    node,
    handwritten,
    generated,
    params,
    resourceClasses: generated.filter((item) => item.kind === "class"),
    partAware: partTypes.map((item) => item.name.slice(0, -4)).sort(),
    schemas: generated.filter((item) => item.kind === "type" && !params.includes(item) && !partTypes.includes(item) && item.name !== "MethodId"),
  };
}

const exported = readExports();

function exportsPage(language) {
  const words = WORDS[language].exports;
  const { node, handwritten, generated, params, resourceClasses, partAware, schemas } = exported;
  const table = (items) =>
    `${words.columns}\n| --- | --- |\n${[...items]
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((item) => `| \`${item.name}\` | ${item.summary.replace(/\|/g, "\\|").replace(/\{@link ([^}]+)\}/g, "`$1`") || " "} |`)
      .join("\n")}\n`;

  return `---
title: ${words.title}
description: ${words.description}
---

<!-- Generated by docs/scripts/reference.mjs from the doc comments of src/. Run "npm run reference" in docs/ after changing an export. -->

${words.intro}

## ${words.classes}

${table(handwritten.filter((item) => item.kind === "class"))}
## ${words.functions}

${table(handwritten.filter((item) => item.kind === "function"))}
## ${words.constants}

${table([...handwritten.filter((item) => item.kind === "constant"), ...generated.filter((item) => item.kind === "constant")])}
## ${words.types}

${table(handwritten.filter((item) => item.kind === "type"))}
## \`@ix-xs/youtube.api/node\`

${table(node)}
## ${words.generated}

${words.generatedNote}

### ${words.resources}

${words.resourcesNote(partAware.length)}

${partAware.map((name) => `\`${name}\``).join(", ")}

### ${words.schemas}

${words.schemasNote(schemas.length)}

### ${words.params}

${words.paramsNote(params.length)}

### ${words.methodClasses}

${words.methodClassesNote(resourceClasses.length)}
`;
}

// ------------------------------------------------------------- playground

/**
 * The worst real data the playground could be given: every part of the
 * resources with the most parts and the longest names, every field, unions
 * written in full. Build the site with PICKER_DATA=worst to look at it.
 */
const WORST = {
  Video: { call: "yt.videos.list", id: "dQw4w9WgXcQ", variable: "video", parts: "all" },
  LiveChatMessage: { call: "yt.liveChatMessages.list", id: "KicKGFVDX3g1WEcxT1YyUDZ1Wlo1RlNNOVR0dxILalE0dzlXZ1hjUQ", variable: "message", parts: "all" },
  VideoAbuseReportReason: { call: "yt.videoAbuseReportReasons.list", id: "V", variable: "videoAbuseReportReason", parts: "all" },
  ThirdPartyLink: { call: "yt.thirdPartyLinks.list", id: "UC_x5XG1OV2P6uZZ5FSM9Ttw", variable: "thirdPartyLink", parts: "all" },
  PlaylistItem: { call: "yt.playlistItems.list", id: "PLrAXtmErZgOeiKm4sgNOknGvNjby9efdf", variable: "playlistItem", parts: "all" },
};

function partsData(worst = false) {
  const doc = discovery.data;
  const PICK = worst ? WORST : {
    Video: { call: "yt.videos.list", id: "dQw4w9WgXcQ", variable: "video", parts: ["snippet", "contentDetails", "statistics", "status", "liveStreamingDetails"] },
    Channel: { call: "yt.channels.list", id: "UC_x5XG1OV2P6uZZ5FSM9Ttw", variable: "channel", parts: ["snippet", "statistics", "contentDetails", "brandingSettings", "status"] },
    Playlist: { call: "yt.playlists.list", id: "PLBCF2DAC6FFB574DE", variable: "playlist", parts: ["snippet", "contentDetails", "status", "player"] },
  };
  /** The fields worth showing for each part, most useful first. */
  const FIELDS = {
    VideoSnippet: ["title", "description", "publishedAt", "channelTitle", "thumbnails", "tags"],
    VideoContentDetails: ["duration", "definition", "caption", "regionRestriction"],
    VideoStatistics: ["viewCount", "likeCount", "commentCount"],
    VideoStatus: ["privacyStatus", "embeddable", "madeForKids", "publishAt"],
    VideoLiveStreamingDetails: ["activeLiveChatId", "actualStartTime", "concurrentViewers"],
    ChannelSnippet: ["title", "description", "customUrl", "publishedAt", "thumbnails", "country"],
    ChannelStatistics: ["subscriberCount", "viewCount", "videoCount", "hiddenSubscriberCount"],
    ChannelContentDetails: ["relatedPlaylists"],
    ChannelBrandingSettings: ["channel", "image"],
    ChannelStatus: ["privacyStatus", "madeForKids", "longUploadsStatus"],
    PlaylistSnippet: ["title", "description", "publishedAt", "channelTitle", "thumbnails"],
    PlaylistContentDetails: ["itemCount"],
    PlaylistStatus: ["privacyStatus"],
    PlaylistPlayer: ["embedHtml"],
  };
  const typeOf = (prop) => {
    if (prop.$ref) return prop.$ref;
    if (prop.type === "array") return `${typeOf(prop.items ?? {})}[]`;
    if (prop.enum) return prop.enum.length > 3 && !worst ? `${prop.enum.slice(0, 2).map((value) => JSON.stringify(value)).join(" | ")} | ...` : prop.enum.map((value) => JSON.stringify(value)).join(" | ");
    if (prop.type === "integer" || prop.type === "number") return "number";
    if (prop.type === "boolean") return "boolean";
    if (prop.type === "object") return "{ ... }";
    return "string";
  };
  return Object.entries(PICK).map(([name, pick]) => {
    const schema = doc.schemas[name];
    const always = config.alwaysReturned[name] ?? ["snippet"];
    return {
      name,
      call: pick.call,
      id: pick.id,
      variable: pick.variable,
      parts: (pick.parts === "all" ? Object.keys(schema.properties).filter((key) => key !== "kind" && key !== "etag" && key !== "id") : pick.parts).map((part) => {
        const ref = schema.properties[part].$ref;
        // A part that is not an object of its own (a plain string, a map) has no fields to list.
        if (!ref) return { name: part, type: typeOf(schema.properties[part]), always: always.includes(part), fields: [] };
        const required = new Set(config.required[ref] ?? []);
        const properties = doc.schemas[ref].properties ?? {};
        return {
          name: part,
          type: ref,
          always: always.includes(part),
          fields: (worst ? Object.keys(properties) : (FIELDS[ref] ?? Object.keys(properties).slice(0, 4))).map((field) => {
            if (!properties[field]) throw new Error(`${ref}.${field} does not exist`);
            return { name: field, type: typeOf(properties[field]), optional: !required.has(field) };
          }),
        };
      }),
    };
  });
}

// ------------------------------------------------------------------ write

const files = new Map([
  // English at the root of the content, a translation in the folder of its language.
  ...LANGUAGES.flatMap((language) => {
    const folder = `src/content/docs/${language === "en" ? "" : `${language}/`}reference`;
    return [
      [`${folder}/methods.md`, methodsPage(language)],
      [`${folder}/quota-costs.md`, quotaPage(language)],
      [`${folder}/exports.md`, exportsPage(language)],
    ];
  }),
  ["src/data/parts.json", `${JSON.stringify(partsData(), null, 2)}\n`],
  ["src/data/parts.worst.json", `${JSON.stringify(partsData(true), null, 2)}\n`],
]);

let stale = 0;
for (const [file, content] of files) {
  const target = path.join(here, "..", file);
  if (CHECK) {
    const current = await readFile(target, "utf8").catch(() => "");
    if (current.replace(/\r\n/g, "\n") !== content) {
      console.error(`out of date: docs/${file}`);
      stale++;
    }
    continue;
  }
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, content);
}
if (stale) {
  console.error("Run `npm run reference` in docs/ and commit the result.");
  process.exit(1);
}
console.log(CHECK ? `reference pages are up to date (${files.size} files)` : `wrote ${files.size} files, ${methods.length} methods`);
