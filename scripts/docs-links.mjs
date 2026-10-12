// Finds the reference page of every API method and writes scripts/docs-links.json.
// The generator only links to pages listed there, so a doc comment never points
// to a 404.
//
//   node scripts/docs-links.mjs

import { readFile, writeFile } from "node:fs/promises";

const here = new URL(".", import.meta.url);
const LIVE = new Set(["liveBroadcasts", "liveStreams", "liveChatMessages", "liveChatBans", "liveChatModerators", "superChatEvents"]);

function collect(resources, out = []) {
  for (const resource of Object.values(resources ?? {})) {
    for (const method of Object.values(resource.methods ?? {})) out.push(method.id);
    collect(resource.resources, out);
  }
  return out;
}

function candidates(id) {
  const parts = id.split(".");
  const api = parts.shift();
  const method = parts.pop();
  const resource = parts.at(-1);
  if (api === "youtube") {
    const base = "https://developers.google.com/youtube/v3";
    const urls = [`${base}/${LIVE.has(resource) ? "live/" : ""}docs/${resource}/${method}`];
    if (resource === "messages") urls.unshift(`${base}/live/docs/liveChatMessages/streamList`);
    if (method === "insertCuepoint") urls.unshift(`${base}/live/docs/liveBroadcasts/cuepoint`);
    return urls;
  }
  if (api === "youtubeAnalytics") return [`https://developers.google.com/youtube/analytics/reference/${resource}/${method}`];
  return [`https://developers.google.com/youtube/reporting/v1/reference/rest/v1/${parts.join(".")}/${method}`];
}

const links = {};
for (const file of ["youtube.v3.json", "youtubeAnalytics.v2.json", "youtubereporting.v1.json"]) {
  const doc = JSON.parse(await readFile(new URL(`discovery/${file}`, here), "utf8"));
  const ids = collect(doc.resources);
  await Promise.all(
    ids.map(async (id) => {
      for (const url of candidates(id)) {
        const response = await fetch(url, { redirect: "follow" }).catch(() => undefined);
        if (!response?.ok) continue;
        await response.body?.cancel();
        links[id] = url;
        const cost = /quota cost of (?:approximately )?<?[^>]*>?\s*([\d,]+)\s*units?/i.exec(html.replace(/<[^>]+>/g, " "));
        if (cost) costs[id] = Number(cost[1].replace(",", ""));
        return;
      }
    }),
  );
  for (const id of ids) if (!links[id]) console.log("no page:", id);
}

const sorted = Object.fromEntries(Object.entries(links).sort(([a], [b]) => a.localeCompare(b)));
await writeFile(new URL("docs-links.json", here), `${JSON.stringify(sorted, null, 2)}\n`);
console.log(`${Object.keys(sorted).length} pages found`);
