---
title: Migrating from 1.x
description: Version 2 is a rewrite. The four methods of 1.x map to two helpers, results are the data itself, and failures are thrown.
---

```js
// 1.x
const YoutubeAPI = require("@ix-xs/youtube.api");

const youtube = new YoutubeAPI({ apiKey: process.env.YOUTUBE_API_KEY });
const { ok, data } = await youtube.getChannelById("UC_x5XG1OV2P6uZZ5FSM9Ttw");
```

```ts
// 2.x
import { YouTube } from "@ix-xs/youtube.api";

const yt = new YouTube({ apiKey: process.env.YOUTUBE_API_KEY });
const channel = await yt.channels.get("UC_x5XG1OV2P6uZZ5FSM9Ttw");
```

## What changed

| 1.x | 2.x |
| --- | --- |
| A default export, `YoutubeAPI` | A named export, `YouTube` |
| `getChannelByUsername(username)`, `getChannelById(id)` | `yt.channels.get(channel)` |
| `getLastVideoByUsername(username)`, `getLastVideoByChannelId(id)` | `yt.channels.latestVideo(channel)` |
| Every call resolves to `{ ok, status, statusText, data }` | A call resolves to the data, or throws |
| The latest video is a playlist item snippet | The latest video is a full video resource |
| ISC license | MIT license |

## The import

The class is now a named export, and its name has a capital T.

```js
// 1.x
const YoutubeAPI = require("@ix-xs/youtube.api");
const youtube = new YoutubeAPI({ apiKey: "..." });
```

```ts
// 2.x, ES modules
import { YouTube } from "@ix-xs/youtube.api";
const yt = new YouTube({ apiKey });
```

```js
// 2.x, CommonJS
const { YouTube } = require("@ix-xs/youtube.api");
const yt = new YouTube({ apiKey: process.env.YOUTUBE_API_KEY });
```

The constructor still takes `{ apiKey }`. With no argument it reads the `YOUTUBE_API_KEY` environment variable. [Credentials](/start/credentials/) has the details.

## getChannelByUsername

```js
// 1.x
const result = await youtube.getChannelByUsername("GoogleDevelopers");
if (result.ok) console.log(result.data);
```

```ts
// 2.x
const channel = await yt.channels.get("GoogleDevelopers");
if (channel) console.log(channel.snippet.title, channel.statistics.subscriberCount);
```

`yt.channels.get` takes a channel in any form: an id, an `@handle`, a legacy username or a channel URL. It resolves to `null` when nothing matches.

A bare name such as `"GoogleDevelopers"` is tried as a handle first, then as a legacy username. That costs 1 quota unit, or 2 when the second lookup is needed. To skip the guess, say which one you mean:

```ts
// A handle: 1 unit.
await yt.channels.get("@GoogleDevelopers");

// A legacy username, through its URL: 1 unit.
await yt.channels.get("https://www.youtube.com/user/GoogleDevelopers");

// A legacy username, through the raw method: 1 unit.
await yt.channels.list({ part: ["snippet", "statistics"], forUsername: "GoogleDevelopers" }).first();
```

## getChannelById

```js
// 1.x
const result = await youtube.getChannelById("UC_x5XG1OV2P6uZZ5FSM9Ttw");
if (result.ok) console.log(result.data);
```

```ts
// 2.x
const channel = await yt.channels.get("UC_x5XG1OV2P6uZZ5FSM9Ttw");
if (channel) console.log(channel.snippet.title);
```

It costs 1 unit. The result has the parts `snippet`, `contentDetails` and `statistics`. Pass `part` to choose others, and the type follows:

```ts
const slim = await yt.channels.get(channelId, { part: "snippet" });
// Channel<"snippet"> | null
```

[Parts and types](/basics/parts-and-types/) explains how the result type is built.

## getLastVideoByUsername

```js
// 1.x
const result = await youtube.getLastVideoByUsername("GoogleDevelopers");
if (result.ok) console.log(result.data.title, result.data.resourceId.videoId);
```

```ts
// 2.x
const video = await yt.channels.latestVideo("GoogleDevelopers");
if (video) console.log(video.snippet.title, video.id);
```

It resolves to `null` when the channel has no upload. It costs 2 units: one to read the uploads playlist, one to fetch the video. Resolving a name to a channel id costs 1 more unit the first time (2 for a bare name that turns out to be a legacy username), and the client remembers the answer.

## getLastVideoByChannelId

```js
// 1.x
const result = await youtube.getLastVideoByChannelId("UC_x5XG1OV2P6uZZ5FSM9Ttw");
if (result.ok) console.log(result.data.title, result.data.resourceId.videoId);
```

```ts
// 2.x
const video = await yt.channels.latestVideo("UC_x5XG1OV2P6uZZ5FSM9Ttw");
if (video) console.log(video.snippet.title, video.id);
```

2 units. For more than one video, `yt.channels.latestVideos(channel, { limit })` costs the same 2 units for up to 50 videos.

## The shape of the latest video

1.x returned the snippet of a playlist item: the entry of the video in the channel's uploads playlist. 2.x returns the video itself, with `snippet`, `contentDetails` and `statistics`. The fields you were reading moved:

| 1.x, on `data` | 2.x, on `video` |
| --- | --- |
| `resourceId.videoId` | `id` |
| `title` | `snippet.title` |
| `description` | `snippet.description` |
| `publishedAt` | `snippet.publishedAt` |
| `thumbnails` | `snippet.thumbnails` |
| `channelId` | `snippet.channelId` |
| `channelTitle` | `snippet.channelTitle` |
| `playlistId`, `position` | Not on a video. See below |

You also get what a playlist item does not carry:

```ts
const video = await yt.channels.latestVideo(channelId);

if (video) {
  video.contentDetails.duration; // "PT4M13S"
  video.statistics.viewCount; // string
  formatDuration(video.contentDetails.duration); // "4:13"
}
```

If you want the old object, read the uploads playlist yourself. The `snippet` of its first item is what 1.x returned in `data`:

```ts
const item = await yt.channels.uploads(channelId, { part: "snippet" }).first();

if (item) {
  item.snippet.title;
  item.snippet.resourceId.videoId;
  item.snippet.position;
}
```

That is 1 unit instead of 2, and no duration or statistics.

## Error handling

1.x resolved to a result object whatever happened. You checked `ok`, then read `status` and `statusText`. 2.x resolves to the data and throws when the call fails.

```js
// 1.x
const result = await youtube.getChannelById(id);
if (!result.ok) {
  console.error(result.status, result.statusText);
  return;
}
use(result.data);
```

```ts
// 2.x
try {
  const channel = await yt.channels.get(channelId);
  if (channel) console.log(channel.snippet.title);
} catch (error) {
  if (error instanceof YouTubeApiError) {
    console.error(error.status, error.reason, error.message);
  } else {
    throw error;
  }
}
```

Three things to keep in mind:

- A channel that does not exist is not an API error. `yt.channels.get` resolves to `null`. `yt.channels.latestVideo` resolves to `null` for a channel without uploads, and throws a `YouTubeArgumentError` when the channel itself cannot be found.
- `error.status` is the HTTP status. `error.code` and `error.reason` are easier to branch on: `isYouTubeError(error, "QUOTA_EXCEEDED")`, `error.reason === "keyInvalid"`.
- Rate limits, server errors and network failures are retried before anything is thrown.

[Errors](/basics/errors/) lists every class and code.

## Requirements

- Node.js 20 or newer. The library is built on the global `fetch` and has no dependency.
- The package ships ES module and CommonJS builds, each with its type declarations.
- The license is MIT. It was ISC.

## Reference

| 1.x | 2.x | Quota |
| --- | --- | --- |
| `new YoutubeAPI({ apiKey })` | `new YouTube({ apiKey })` | |
| `getChannelByUsername(username)` | `yt.channels.get(username)` | 1 unit, 2 when a bare name is a legacy username |
| `getChannelById(id)` | `yt.channels.get(id)` | 1 unit |
| `getLastVideoByUsername(username)` | `yt.channels.latestVideo(username)` | 2 units, plus the lookup of the name the first time |
| `getLastVideoByChannelId(id)` | `yt.channels.latestVideo(id)` | 2 units |
| `result.ok === false` | A thrown `YouTubeApiError` | |
| `result.status`, `result.statusText` | `error.status`, `error.message` | |
| `result.data` | The resolved value | |

## See also

- [Quick start](/start/quick-start/): the rest of what version 2 does, in five minutes.
- [Channels](/resources/channels/): every channel helper.
- [Errors](/basics/errors/): what is thrown and what is retried.
- [Quota](/basics/quota/): what calls cost.
