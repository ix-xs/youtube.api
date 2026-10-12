---
title: Quick start
description: Install the package, get an API key, and read a channel, its latest videos and a playlist. Five minutes, no OAuth.
---

```ts
import { YouTube } from "@ix-xs/youtube.api";

const yt = new YouTube({ apiKey: process.env.YOUTUBE_API_KEY });

const channel = await yt.channels.get("@GoogleDevelopers");
console.log(channel?.snippet.title, channel?.statistics.subscriberCount);
```

## Install

```bash
npm install @ix-xs/youtube.api
```

It needs Node.js 20 or newer and has no dependency. It also runs in Bun, Deno, browsers and edge runtimes: see [Runtimes](/reference/runtimes/).

Both module systems work:

```ts
import { YouTube } from "@ix-xs/youtube.api";
```

```js
const { YouTube } = require("@ix-xs/youtube.api");
```

## Get an API key

An API key is enough to read anything public. It takes two minutes:

1. Open the [Google Cloud console](https://console.cloud.google.com/) and create a project, or pick one.
2. In **APIs & Services > Library**, enable **YouTube Data API v3**.
3. In **APIs & Services > Credentials**, choose **Create credentials > API key**.

Keep the key out of your code. Put it in an environment variable named `YOUTUBE_API_KEY`: the client reads it when you pass nothing.

```ts
const yt = new YouTube(); // uses process.env.YOUTUBE_API_KEY
```

[Credentials](/start/credentials/) covers restricting the key, and what needs OAuth instead.

## Read a channel

A channel can be given as a handle, a URL or an id. The result is `null` when nothing matches.

```ts
const channel = await yt.channels.get("https://www.youtube.com/@GoogleDevelopers");

if (channel) {
  console.log(channel.id); // "UC_x5XG1OV2P6uZZ5FSM9Ttw"
  console.log(channel.snippet.title);
  console.log(channel.statistics.videoCount);
}
```

## Read its latest videos

```ts
const videos = await yt.channels.latestVideos("@GoogleDevelopers", { limit: 5 });

for (const video of videos) {
  console.log(video.snippet.title);
  console.log(formatDuration(video.contentDetails.duration), formatCount(video.statistics.viewCount));
}
```

This reads the channel's uploads playlist, then fetches the videos: 2 quota units for up to 50 videos, plus 1 the first time a handle is resolved. A search would cost one of your 100 daily search calls and return less.

## Walk a list

Every `list` method, and every helper that returns a list, can be awaited for one page or iterated to the end.

```ts
// One page.
const page = await yt.playlists.items("PLBCF2DAC6FFB574DE");
console.log(page.items.length, page.nextPageToken);

// Every item, fetched page by page as the loop advances.
for await (const item of yt.playlists.items("PLBCF2DAC6FFB574DE")) {
  console.log(item.snippet.position, item.snippet.title);
}

// A bounded array.
const firstHundred = await yt.playlists.items("PLBCF2DAC6FFB574DE").take(100);
```

## Use the raw API

The helpers above are shortcuts. Every method of the API is there under the name the official reference gives it, with typed parameters:

```ts
const { items } = await yt.videos.list({
  part: ["snippet", "statistics"],
  chart: "mostPopular",
  regionCode: "FR",
  maxResults: 10,
});
```

The result type follows `part`: here each video has `snippet` and `statistics`, and nothing else. That is the subject of [Parts and types](/basics/parts-and-types/).

## Handle errors

A failed call throws. The error says what happened in a form you can branch on.

```ts
try {
  await yt.videos.get(videoId);
} catch (error) {
  if (isYouTubeError(error, "QUOTA_EXCEEDED")) {
    console.log("Out of quota until", yt.quota.resetsAt);
  } else {
    throw error;
  }
}
```

## Where to go next

- [Parts and types](/basics/parts-and-types/): how the result types are built.
- [Lists](/basics/lists/): pages, iteration, limits.
- [Quota](/basics/quota/): what calls cost and how to spend less.
- [OAuth](/auth/oauth/): private data and writes.
- [Every method](/reference/methods/): the whole API on one page.
