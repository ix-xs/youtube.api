<div align="center">

# @ix-xs/youtube.api

**The whole YouTube API, typed by what you ask for.**

[![npm version](https://img.shields.io/npm/v/@ix-xs/youtube.api.svg?color=cb3837&logo=npm)](https://www.npmjs.com/package/@ix-xs/youtube.api)
[![npm downloads](https://img.shields.io/npm/dm/@ix-xs/youtube.api.svg?color=cb3837&logo=npm)](https://www.npmjs.com/package/@ix-xs/youtube.api)
[![CI](https://img.shields.io/github/actions/workflow/status/ix-xs/youtube.api/ci.yml?branch=main&label=CI&logo=github)](https://github.com/ix-xs/youtube.api/actions)
[![dependencies](https://img.shields.io/badge/dependencies-0-brightgreen)](https://www.npmjs.com/package/@ix-xs/youtube.api?activeTab=dependencies)
[![node](https://img.shields.io/badge/node-%3E%3D20-brightgreen?logo=node.js&logoColor=white)](https://nodejs.org)
[![types](https://img.shields.io/badge/types-included-3178c6?logo=typescript&logoColor=white)](#typed-by-the-parts-you-request)
[![license](https://img.shields.io/badge/license-MIT-blue)](./LICENSE)

**[Documentation](https://ix-xs.github.io/youtube.api/)** ·
[Getting started](https://ix-xs.github.io/youtube.api/start/quick-start/) ·
[Every method](https://ix-xs.github.io/youtube.api/reference/methods/) ·
[Recipes](https://ix-xs.github.io/youtube.api/recipes/discord-upload-notifier/) ·
[Changelog](./CHANGELOG.md)

</div>

```bash
npm install @ix-xs/youtube.api
```

Node.js 20 or newer, Bun, Deno, browsers and edge runtimes. No dependencies: it is built on `fetch`.

---

```ts
import { YouTube } from "@ix-xs/youtube.api";

const yt = new YouTube({ apiKey: process.env.YOUTUBE_API_KEY });

// A channel from its handle, its URL or its id.
const channel = await yt.channels.get("@GoogleDevelopers");
console.log(channel?.snippet.title, channel?.statistics.subscriberCount);

// Its latest videos, with durations and view counts. 2 quota units.
const videos = await yt.channels.latestVideos("@GoogleDevelopers", { limit: 5 });

// Every video of a playlist, however long. Pages are fetched as you go.
for await (const item of yt.playlists.items("PLBCF2DAC6FFB574DE")) {
  console.log(item.snippet.position, item.snippet.title);
}
```

It covers every method of the YouTube Data API v3 (82, live streaming included), of the Analytics API (8) and of the Reporting API (8). The types are generated from Google's own API description, so a parameter or a field cannot be missing or misspelled.

## What it does for you

| The API as it is | With this library |
| --- | --- |
| Every field of every response is "maybe there" | **The result type follows `part`.** Ask for `snippet` and `statistics`: those two are there, typed, and reading `contentDetails` is a compile error |
| `nextPageToken` loops everywhere | **`for await`** over any list, or `.all({ limit })`, or one page with `await` |
| 50 ids per call | **Pass 500.** They are split into calls of 50 and merged |
| A channel is an id, but people have handles and URLs | **`"@handle"`, any URL or an id**, everywhere a channel, a video or a playlist is expected |
| Quota runs out without warning | **`yt.quota`** counts what you spend per bucket and per method, and can refuse a call before it is sent |
| A write with an API key fails after the round trip | **Refused locally**, with the scopes that would have worked, and no quota spent |
| OAuth is a project of its own | **`OAuth2`**: consent URL with PKCE, code exchange, automatic refresh, device flow, and a one-call local flow for scripts |
| Resumable uploads are a protocol to implement | **`media: file`**, with chunking, progress, retries and resume |
| Live chat means a polling loop to write | **`for await (const message of chat.messages())`** |
| "Tell me when this channel uploads" | **`yt.watch()`** by polling, or **`websub`** for push notifications. Neither needs quota |
| Errors are a status code and a blob | **`error.code` and `error.reason`**, both typed, plus `isQuotaExceeded`, `isRateLimited`, `isNotFound` |

## Typed by the parts you request

The YouTube API returns only the `part`s you ask for. The types know it.

```ts
const { items } = await yt.videos.list({ part: ["snippet", "statistics"], id: "dQw4w9WgXcQ" });
const video = items[0];

video.snippet.title;        // string
video.statistics.viewCount; // string
video.statistics.likeCount; // string | undefined, the owner can hide it
video.contentDetails;       // error: Property 'contentDetails' does not exist
```

Parts the API may leave out even when requested, such as `liveStreamingDetails` on a video that is not live, stay optional. `Video` alone is the full resource with every part optional, and any narrowed video can be passed where a `Video` is expected.

## Lists

Every `list` method returns a request you can await or iterate.

```ts
// One page.
const page = await yt.search.videos("lofi hip hop", { order: "viewCount" });
page.items, page.nextPageToken, page.totalResults;

// Everything, lazily. The largest page size is used, which is the cheapest.
for await (const thread of yt.commentThreads.forVideo("dQw4w9WgXcQ")) { /* ... */ }

// A bounded array.
const first200 = await yt.channels.uploads("@GoogleDevelopers").take(200);

// Hundreds of ids in one call.
const videos = await yt.videos.getMany(ids); // 1 unit per 50
```

## Quota

Since June 2026 YouTube counts quota in buckets: `search.list` and `videos.insert` have 100 calls a day each, `videos.batchGetStats` has its own 10,000, and everything else shares 10,000 units. The client knows what each method costs.

```ts
import { quotaCost } from "@ix-xs/youtube.api";

quotaCost("playlistItems.insert"); // { cost: 50, bucket: "default" }

yt.quota.used;                     // units spent today in the shared bucket
yt.quota.remaining("search.list"); // 97
yt.quota.byMethod;                 // { "videos.list": 12, "search.list": 3 }
yt.quota.resetsAt;                 // next midnight Pacific Time

// Refuse calls that would go over, before they are sent.
const safe = new YouTube({ apiKey, quota: { enforce: true, limits: { default: 2000 } } });
```

Caching is one option away, with ETag revalidation and a pluggable store:

```ts
const yt = new YouTube({ apiKey, cache: { ttl: "10m", methods: { "videoCategories.list": "1d" } } });
```

## OAuth 2.0

An API key reads public data. Private data and every write need OAuth.

```ts
import { OAuth2, YouTube } from "@ix-xs/youtube.api";

const oauth = new OAuth2({
  clientId: process.env.GOOGLE_CLIENT_ID!,
  clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
  redirectUri: "https://example.com/oauth/callback",
  onTokens: (tokens) => saveTokens(tokens), // called after every refresh
});

// 1. Send the user to Google.
const { url, state, codeVerifier } = await oauth.authUrl({ scopes: ["youtube.readonly"] });

// 2. On your callback route.
await oauth.exchange(code, { codeVerifier });

// 3. Tokens refresh on their own from here on.
const yt = new YouTube({ oauth });
const mine = await yt.channels.mine();
```

For a script on your own machine, the whole flow is one call:

```ts
import { authorize, tokenFile } from "@ix-xs/youtube.api/node";

const store = tokenFile("./tokens.json");
const oauth = new OAuth2({ clientId, clientSecret, tokens: await store.load(), onTokens: store.save });
if (!oauth.canRefresh) await authorize(oauth, { scopes: ["youtube.upload"] }); // opens the browser
```

## Uploads

```ts
import { fileMedia } from "@ix-xs/youtube.api/node";

const video = await yt.videos.insert({
  body: {
    snippet: { title: "Holiday 2026", description: "Uploaded from code", categoryId: "22" },
    status: { privacyStatus: "private", selfDeclaredMadeForKids: false },
  },
  media: await fileMedia("./holiday.mp4", { onProgress: ({ percent }) => console.log(`${percent}%`) }),
});

await yt.thumbnails.set({ videoId: video.id, media: await fileMedia("./cover.png") });
```

Large files go up in chunks over a resumable session and survive network errors. In the browser, pass a `File` or a `Blob` as `media`.

## Live chat

```ts
const chat = await yt.liveChatOf("https://www.youtube.com/watch?v=jfKfPfyJRdk");

for await (const message of chat.messages()) {
  console.log(`${message.authorDetails.displayName}: ${message.snippet.displayMessage}`);
  if (message.snippet.type === "superChatEvent") {
    console.log("Super Chat:", message.snippet.superChatDetails?.amountDisplayString);
  }
}
```

Reading works with an API key. `chat.send()`, `chat.ban()` and `chat.delete()` need OAuth.

## New upload notifications

Polling, with nothing to host. Reads the public feed, which costs no quota, and falls back on the API when the feed is down:

```ts
const watcher = yt.watch(["@GoogleDevelopers", "@YouTube"], { interval: "5m" });
watcher.on("video", (video) => console.log(`${video.channelTitle} uploaded ${video.title}: ${video.url}`));
watcher.start();
```

Push, when you have a public endpoint. The hub calls you within seconds of an upload:

```ts
import { websub } from "@ix-xs/youtube.api";

await websub.subscribe({ channelId, callbackUrl: "https://example.com/youtube", secret });

// In any handler that receives a Request (Hono, Next.js, Bun, Deno, Workers):
const { response, notifications } = await websub.receive(request, { secret });
```

## Analytics

```ts
const report = await yt.analytics.query({
  startDate: "2026-01-01",
  endDate: "2026-01-31",
  metrics: ["views", "estimatedMinutesWatched", "subscribersGained"],
  dimensions: "day",
});

for (const row of report.rows) console.log(row.day, row.views, row.estimatedMinutesWatched);
```

Rows are objects keyed by the metrics and dimensions you asked for. Metrics are numbers.

## Errors

```ts
import { YouTubeApiError, isYouTubeError } from "@ix-xs/youtube.api";

try {
  await yt.commentThreads.post(videoId, "Nice one");
} catch (error) {
  if (error instanceof YouTubeApiError && error.reason === "commentsDisabled") {
    // comments are turned off on that video
  } else if (isYouTubeError(error, "QUOTA_EXCEEDED")) {
    // wait until yt.quota.resetsAt
  } else {
    throw error;
  }
}
```

Rate limits, server errors and network failures are retried with exponential backoff. A write is only replayed when the API guarantees it was not applied.

## Small things that save time

```ts
import { parseUrl, parseDuration, formatDuration, bestThumbnail, urls, oEmbed, channelPlaylistId } from "@ix-xs/youtube.api";

parseUrl("https://youtu.be/dQw4w9WgXcQ?t=42");  // { type: "video", videoId: "dQw4w9WgXcQ", format: "watch", start: 42 }
parseDuration("PT1H2M3S");                      // 3723
formatDuration("PT1H2M3S");                     // "1:02:03"
bestThumbnail(video.snippet.thumbnails)?.url;   // the largest one available
urls.embed("dQw4w9WgXcQ", { noCookie: true });  // an <iframe> src
channelPlaylistId(channelId, "shorts");         // the channel's Shorts as a playlist, 1 unit to read
await oEmbed("https://youtu.be/dQw4w9WgXcQ");   // title, author, thumbnail. No key, no quota
```

## Coming from 1.x

Version 2 is a rewrite. The four methods of 1.x map to:

| 1.x | 2.x |
| --- | --- |
| `new YoutubeAPI({ apiKey })` | `new YouTube({ apiKey })` |
| `getChannelByUsername(name)`, `getChannelById(id)` | `yt.channels.get(nameOrIdOrUrl)` |
| `getLastVideoByUsername(name)`, `getLastVideoByChannelId(id)` | `yt.channels.latestVideo(nameOrIdOrUrl)` |
| `{ ok, status, statusText, data }` | the data, or a thrown `YouTubeApiError` |

The [migration page](https://ix-xs.github.io/youtube.api/start/migrating-from-v1/) has the details.

## Documentation

Everything is on **[ix-xs.github.io/youtube.api](https://ix-xs.github.io/youtube.api/)**: guides, one page per resource, the quota table, recipes, and the list of all methods. The same documentation is in your editor: every method, parameter and field carries its description, its quota cost and an example.

## License

[MIT](./LICENSE). Not affiliated with YouTube or Google. YouTube is a trademark of Google LLC. Using the API means accepting the [YouTube API Services Terms of Service](https://developers.google.com/youtube/terms/api-services-terms-of-service).
