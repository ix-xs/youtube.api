// Checks the library against the real services. Read-only, about 15 quota
// units and 1 search call.
//
//   npm run live            needs YOUTUBE_API_KEY in the environment or in .env
//
// Beyond "does it work", this verifies the claims the types make: every field
// marked as always present in scripts/api.config.mjs must really be there in
// what YouTube returns.

import { existsSync, readFileSync } from "node:fs";
import * as config from "../../scripts/api.config.mjs";
import { type MethodId, YouTube, fetchFeed, isYouTubeError, oEmbed } from "../../src/index.js";

if (existsSync(".env")) process.loadEnvFile(".env");

const discovery = JSON.parse(readFileSync(new URL("../../scripts/discovery/youtube.v3.json", import.meta.url), "utf8")) as {
  schemas: Record<string, Schema>;
};

interface Schema {
  $ref?: string;
  type?: string;
  items?: Schema;
  properties?: Record<string, Schema>;
  additionalProperties?: Schema;
}

const required = config.required as Record<string, string[]>;
const missing = new Map<string, number>();
let checkedObjects = 0;

/** Walks a response alongside its schema and records required fields that are absent. */
function verify(value: unknown, schema: Schema | undefined, path: string): void {
  if (!schema || value === null || value === undefined) return;
  if (schema.$ref) return verify(value, discovery.schemas[schema.$ref], schema.$ref);
  if (schema.type === "array" && Array.isArray(value)) {
    for (const item of value) verify(item, schema.items, path);
    return;
  }
  if (typeof value !== "object") return;
  const object = value as Record<string, unknown>;
  if (schema.properties) {
    checkedObjects++;
    for (const field of required[path] ?? []) {
      if (object[field] === undefined) missing.set(`${path}.${field}`, (missing.get(`${path}.${field}`) ?? 0) + 1);
    }
    for (const [name, child] of Object.entries(schema.properties)) verify(object[name], child, child.$ref ?? `${path}.${name}`);
  } else if (schema.additionalProperties) {
    for (const child of Object.values(object)) verify(child, schema.additionalProperties, path);
  }
}

const results: Array<{ name: string; ok: boolean; detail: string }> = [];

async function step(name: string, run: () => Promise<string>): Promise<void> {
  try {
    results.push({ name, ok: true, detail: await run() });
  } catch (error) {
    const detail = isYouTubeError(error) ? `${error.code}: ${error.message}` : String(error);
    results.push({ name, ok: false, detail });
  }
  const last = results.at(-1)!;
  console.log(`${last.ok ? "ok  " : "FAIL"} ${last.name}: ${last.detail}`);
}

const CHANNEL = "@GoogleDevelopers";
const VIDEO = "dQw4w9WgXcQ";

await step("oEmbed, no key", async () => {
  const info = await oEmbed(`https://youtu.be/${VIDEO}`);
  if (!info?.title) throw new Error("no title");
  if ((await oEmbed("https://youtu.be/aaaaaaaaaaa")) !== null) throw new Error("a missing video should give null");
  return info.title;
});

await step("public feed, no key", async () => {
  try {
    const feed = await fetchFeed("UC_x5XG1OV2P6uZZ5FSM9Ttw");
    return `${feed.entries.length} entries`;
  } catch (error) {
    // The feed service has outages; that is a known state, not a library failure.
    if (isYouTubeError(error, "FEED_UNAVAILABLE")) return "feed service unavailable right now (reported as FEED_UNAVAILABLE)";
    throw error;
  }
});

if (!process.env.YOUTUBE_API_KEY) {
  console.log("\nYOUTUBE_API_KEY is not set: the API checks were skipped.");
  process.exit(results.every((result) => result.ok) ? 0 : 1);
}

const yt = new YouTube();

/** Runs a raw call and checks the response against the schema of the method. */
async function call(method: MethodId, schemaName: string, params: Record<string, unknown>): Promise<{ items?: unknown[] }> {
  const response = await yt.request<{ items?: unknown[] }>(method, params);
  verify(response, discovery.schemas[schemaName], schemaName);
  return response;
}

let channelId = "";
let uploads = "";

await step("channels.get by handle", async () => {
  const channel = await yt.channels.get(CHANNEL);
  if (!channel) throw new Error("channel not found");
  channelId = channel.id;
  uploads = channel.contentDetails.relatedPlaylists.uploads;
  return `${channel.snippet.title}, ${channel.statistics.videoCount} videos`;
});

await step("channels.list, every public part", async () => {
  const response = await call("channels.list", "ChannelListResponse", { part: "snippet,contentDetails,statistics,status,brandingSettings,topicDetails,localizations", id: channelId });
  return `${response.items?.length} channel`;
});

await step("videos.list, the popular chart with every public part", async () => {
  const response = await call("videos.list", "VideoListResponse", {
    part: "snippet,contentDetails,statistics,status,player,topicDetails,recordingDetails,liveStreamingDetails,localizations,paidProductPlacementDetails",
    chart: "mostPopular",
    maxResults: 50,
  });
  return `${response.items?.length} videos`;
});

await step("videos.get from a URL", async () => {
  const video = await yt.videos.get(`https://youtu.be/${VIDEO}`);
  if (!video) throw new Error("video not found");
  return `${video.snippet.title}, ${video.statistics.viewCount} views, ${video.contentDetails.duration}`;
});

await step("playlistItems.list on the uploads playlist", async () => {
  const response = await call("playlistItems.list", "PlaylistItemListResponse", { part: "snippet,contentDetails,status", playlistId: uploads, maxResults: 50 });
  return `${response.items?.length} items`;
});

await step("channels.latestVideos", async () => {
  const videos = await yt.channels.latestVideos(channelId, { limit: 3 });
  return videos.map((video) => video.snippet.title).join(" | ");
});

await step("playlists.list of the channel", async () => {
  const response = await call("playlists.list", "PlaylistListResponse", { part: "snippet,contentDetails,status,player", channelId, maxResults: 50 });
  return `${response.items?.length} playlists`;
});

await step("commentThreads.list with replies", async () => {
  const response = await call("commentThreads.list", "CommentThreadListResponse", { part: "snippet,replies", videoId: VIDEO, maxResults: 100, order: "relevance" });
  return `${response.items?.length} threads`;
});

await step("search.list", async () => {
  const response = await call("search.list", "SearchListResponse", { part: "snippet", q: "typescript", maxResults: 50 });
  return `${response.items?.length} results`;
});

await step("videoCategories, i18nLanguages, i18nRegions", async () => {
  const [categories, languages, regions] = await Promise.all([
    call("videoCategories.list", "VideoCategoryListResponse", { part: "snippet", regionCode: "US" }),
    call("i18nLanguages.list", "I18nLanguageListResponse", { part: "snippet" }),
    call("i18nRegions.list", "I18nRegionListResponse", { part: "snippet" }),
  ]);
  return `${categories.items?.length} categories, ${languages.items?.length} languages, ${regions.items?.length} regions`;
});

await step("a write with only a key is refused before it is sent", async () => {
  const before = yt.quota.used;
  try {
    await yt.videos.rate({ id: VIDEO, rating: "like" });
  } catch (error) {
    if (isYouTubeError(error, "MISSING_CREDENTIALS") && yt.quota.used === before) return "refused locally, no quota spent";
    throw error;
  }
  throw new Error("the call went through");
});

await step("fields the types call always present", async () => {
  if (missing.size) {
    const list = [...missing].map(([field, count]) => `${field} (${count} times)`).join(", ");
    throw new Error(`absent in real responses: ${list}. Remove them from "required" in scripts/api.config.mjs.`);
  }
  return `${checkedObjects} objects checked, none missing a required field`;
});

console.log(`\nquota spent: ${JSON.stringify(yt.quota.usage)}`);
process.exit(results.every((result) => result.ok) ? 0 : 1);
