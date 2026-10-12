---
title: Quick start
description: Install the package, get an API key, and read a channel, its latest videos and a playlist. No OAuth needed.
---

```ts
import { YouTube } from "@ix-xs/youtube.api";

const yt = new YouTube({ apiKey: process.env.YOUTUBE_API_KEY });

const channel = await yt.channels.get("@GoogleDevelopers"); // 1 unit
console.log(channel?.snippet.title, channel?.statistics.subscriberCount);
```

## Install

```bash
npm install @ix-xs/youtube.api
```

It needs Node.js 20 or newer and has no dependency. For Bun, Deno, browsers and edge runtimes, see [Runtimes](/reference/runtimes/).

Both module systems work:

```ts
import { YouTube } from "@ix-xs/youtube.api";
```

```js
const { YouTube } = require("@ix-xs/youtube.api");
```

## Get an API key

An API key is enough to read public data. Create one in the [Google Cloud console](https://console.cloud.google.com/): enable **YouTube Data API v3** for a project, then create a key in **APIs & Services > Credentials**.

Keep the key out of your code. Put it in an environment variable named `YOUTUBE_API_KEY`: the client reads it when you pass no `apiKey`.

```ts
const yt = new YouTube(); // uses process.env.YOUTUBE_API_KEY
```

[Credentials](/start/credentials/) has the steps, how to restrict the key, and what needs OAuth instead.

## Read a channel

A channel can be given as an id, an `@handle`, a legacy username or a URL. The call costs 1 unit and resolves to `null` when nothing matches.

```ts
const channel = await yt.channels.get(
  "https://www.youtube.com/@GoogleDevelopers",
);

if (channel) {
  console.log(channel.id); // "UC_x5XG1OV2P6uZZ5FSM9Ttw"
  console.log(channel.snippet.title);
  console.log(channel.statistics.videoCount);
}
```

## Read its latest videos

```ts
const videos = await yt.channels.latestVideos("@GoogleDevelopers", {
  limit: 5,
});

for (const video of videos) {
  console.log(video.snippet.title);
  console.log(
    formatDuration(video.contentDetails.duration),
    formatCount(video.statistics.viewCount),
  );
}
```

This reads the channel's uploads playlist, then fetches the videos: 2 quota units for up to 50 videos, plus 1 the first time a handle is resolved. A search would take one of your 100 daily search calls and return no durations or statistics.

## Walk a list

Every `list` method, and every helper that returns a list, can be awaited for one page or iterated to the end. A page of `yt.playlists.items` holds up to 50 items and costs 1 unit.

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

The helpers above are shortcuts. Every method of the API is also there under its own name, with typed parameters. [Every method](/reference/methods/) lists them.

```ts
const { items } = await yt.videos.list({
  part: ["snippet", "statistics"],
  chart: "mostPopular",
  regionCode: "FR",
  maxResults: 10,
}); // 1 unit
```

The result type follows `part`: here each video has `id`, `snippet` and `statistics`, and reading another part does not compile. That is the subject of [Parts and types](/basics/parts-and-types/).

## Handle errors

A failed call throws. The error carries a `code` you can branch on.

```ts
try {
  await yt.videos.get(videoId); // 1 unit
} catch (error) {
  if (isYouTubeError(error, "QUOTA_EXCEEDED")) {
    console.log("Out of quota until", yt.quota.resetsAt);
  } else {
    throw error;
  }
}
```

[Errors](/basics/errors/) lists the codes and says what is retried.

## See also

- [Parts and types](/basics/parts-and-types/): how the result types are built.
- [Lists](/basics/lists/): pages, iteration, limits.
- [Quota](/basics/quota/): what calls cost and how to spend less.
- [OAuth](/auth/oauth/): private data and writes.
