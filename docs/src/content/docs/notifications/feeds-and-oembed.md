---
title: Feeds and oEmbed
description: Two public YouTube endpoints that need no API key and cost no quota. The feed lists the 15 latest videos of a channel or a playlist. oEmbed describes one video from its URL.
sidebar:
  order: 3
---

```ts
import { fetchFeed, oEmbed } from "@ix-xs/youtube.api";

const feed = await fetchFeed("UC_x5XG1OV2P6uZZ5FSM9Ttw");
console.log(feed.title, feed.entries[0]?.title);

const info = await oEmbed("https://youtu.be/dQw4w9WgXcQ");
console.log(info?.title, info?.authorName);
```

Both are plain functions: no client, no key, no quota. Neither is part of the YouTube Data API, and YouTube does not guarantee the feed. Use them where a missing answer is acceptable, and the API where it is not.

## Reading a feed

`fetchFeed(id)` takes a channel id (`UC...`) or a playlist id and resolves to the 15 most recent videos, newest first.

```ts
const feed = await fetchFeed("UC_x5XG1OV2P6uZZ5FSM9Ttw");

for (const entry of feed.entries) {
  console.log(entry.publishedAt, entry.title, entry.url);
  console.log(entry.isShort ? "Short" : "Video", entry.views);
  console.log(entry.thumbnail?.url);
}
```

A feed needs an id. A handle or a URL throws a `YouTubeArgumentError`. Resolve it first with `yt.channels.resolveId()`, which costs 1 unit the first time for a handle:

```ts
const id = await yt.channels.resolveId("@GoogleDevelopers");
const feed = id ? await fetchFeed(id) : undefined;
```

There are always 15 entries at most, and no way to page further back. For a whole channel, read its uploads playlist through the API: see [Channels](/resources/channels/).

`views` and `likes` are the counts at the time the feed was generated. Feeds lag behind the API by a few minutes.

## Only the Shorts, or only the long videos

Every channel has playlists that YouTube generates: one with only its Shorts, one with only its regular videos, and others. `channelPlaylistId()` derives their ids without any call, and `fetchFeed` accepts them like any playlist id.

```ts
const shorts = await fetchFeed(channelPlaylistId(channelId, "shorts"));
const longVideos = await fetchFeed(channelPlaylistId(channelId, "videos"));
const liveStreams = await fetchFeed(channelPlaylistId(channelId, "live"));
```

[IDs and URLs](/basics/ids-and-urls/) lists the kinds. Only `uploads` is documented by YouTube.

## When a feed fails

A failure throws a `YouTubeRequestError`. Check `error.code`:

| Code | Meaning |
| --- | --- |
| `FEED_UNAVAILABLE` | YouTube answered with an error status, or could not be reached |
| `TIMEOUT` | No answer within `timeout`, 15 seconds by default |
| `ABORTED` | Your `signal` was aborted |

`FEED_UNAVAILABLE` does not mean the channel is gone. The feed service has outages where every feed answers 404 for hours, so a 404 means one of two things: the id is wrong, or the service is down. The feed cannot tell you which.

```ts
try {
  const feed = await fetchFeed(channelId, { timeout: "10s" });
  console.log(feed.entries.length);
} catch (error) {
  if (!isYouTubeError(error, "FEED_UNAVAILABLE")) throw error;
  // Ask the API instead: 1 unit, and a real answer.
  const uploads = await yt.channels.uploads(channelId).take(15);
  console.log(uploads.length);
}
```

`yt.watch()` does this fallback for you: see [Watching for uploads](/notifications/watching-uploads/).

## Parsing a feed you fetched yourself

`feedUrl(id)` gives the address, and `parseFeed(xml)` turns the document into the same `Feed` object. Use them when the request has to go through your own HTTP client or cache.

```ts
const url = feedUrl("UC_x5XG1OV2P6uZZ5FSM9Ttw");
// "https://www.youtube.com/feeds/videos.xml?channel_id=UC_x5XG1OV2P6uZZ5FSM9Ttw"

const response = await fetch(url);
const feed = parseFeed(await response.text());
```

`feedUrl` throws a `YouTubeArgumentError` for anything but a channel id or a playlist id. `parseFeed` throws one when the document is not an Atom feed.

## Describing a video with oEmbed

`oEmbed(url)` returns the title, the author, the thumbnail and ready-made embed markup for a video or playlist URL. A bare video id works too.

```ts
const info = await oEmbed("https://www.youtube.com/watch?v=dQw4w9WgXcQ", {
  maxWidth: 640,
  maxHeight: 360,
});

if (info) {
  console.log(info.title, "by", info.authorName, info.authorUrl);
  console.log(info.thumbnailUrl, info.thumbnailWidth, info.thumbnailHeight);
  console.log(info.html); // an <iframe>, sized info.width by info.height
}
```

`maxWidth` and `maxHeight` bound the size of the player in `html`.

This is enough for a link preview. It has no duration, no statistics and no description: those need `yt.videos.get()`, 1 unit.

## Checking that a video exists, for free

`oEmbed` resolves to `null` when the video does not exist, is private, or cannot be embedded. That makes it an existence check that costs nothing:

```ts
async function isWatchable(videoId: string): Promise<boolean> {
  return (await oEmbed(videoId)) !== null;
}
```

Read the result the right way round. A non-null answer means the video exists, is not private and can be embedded. `null` covers three cases, and one of them is a video that exists with embedding turned off. When you must know which, ask `yt.videos.get()`, 1 unit.

Anything else that goes wrong throws a `YouTubeRequestError`. Check `error.code`:

| Code | Meaning |
| --- | --- |
| `TIMEOUT` | No answer within `timeout`, 15 seconds by default |
| `ABORTED` | Your `signal` was aborted |
| `NETWORK` | YouTube could not be reached |
| `SERVER_ERROR` | YouTube answered with a status the function does not expect: anything but a success, 400, 401, 403 or 404 |
| `PARSE_ERROR` | YouTube answered with a success status and a body that is not JSON |

The four statuses named in the `SERVER_ERROR` row are the ones that give `null`.

## Reference

### Functions

| Function | Returns | What it does |
| --- | --- | --- |
| `fetchFeed(id, options?)` | `Promise<Feed>` | Reads the feed of a channel id or a playlist id |
| `feedUrl(id)` | `string` | The URL of that feed |
| `parseFeed(xml)` | `Feed` | Parses the XML of a feed |
| `oEmbed(url, options?)` | `Promise<OEmbed \| null>` | Describes a video or playlist URL |
| `channelPlaylistId(channelId, kind?)` | `string` | The id of one of a channel's auto-generated playlists |

Options of `fetchFeed` and `oEmbed`:

| Option | Default | Meaning |
| --- | --- | --- |
| `timeout` | `"15s"` | Time allowed for the request |
| `signal` | none | Cancels the request |
| `fetch` | The global one | Custom `fetch` |
| `maxWidth`, `maxHeight` | none | `oEmbed` only: largest player size, in pixels |

Both functions honour `timeout` and `signal` together: the request ends when it answers, when the timeout passes (code `TIMEOUT`) or when you abort it (code `ABORTED`).

### `Feed`

| Field | Type | Notes |
| --- | --- | --- |
| `title` | `string` | |
| `channelId` | `string \| undefined` | Set for channel feeds |
| `playlistId` | `string \| undefined` | Set for playlist feeds |
| `url` | `string \| undefined` | Page of the channel or the playlist |
| `author` | `{ name, url } \| undefined` | |
| `entries` | `FeedEntry[]` | The 15 most recent videos, newest first |

### `FeedEntry`

| Field | Type | Notes |
| --- | --- | --- |
| `videoId` | `string` | |
| `channelId` | `string` | |
| `title` | `string` | |
| `url` | `string` | Link to the video. A Short links to the Shorts player |
| `isShort` | `boolean` | Whether `url` points to the Shorts player |
| `author` | `{ name, url }` | `url` may be `undefined` |
| `publishedAt` | `string` | ISO 8601 date the video went public |
| `updatedAt` | `string` | ISO 8601 date of the last change to the entry |
| `description` | `string` | |
| `thumbnail` | `{ url, width, height } \| undefined` | `width` and `height` may be `undefined` |
| `views` | `number \| undefined` | When the feed was generated |
| `likes` | `number \| undefined` | When the feed was generated |

### `OEmbed`

| Field | Type | Notes |
| --- | --- | --- |
| `title` | `string` | |
| `authorName` | `string` | |
| `authorUrl` | `string` | Page of the channel |
| `type` | `"video" \| "rich"` | |
| `html` | `string` | Ready-to-use `<iframe>` markup |
| `width`, `height` | `number` | Size of the player in `html` |
| `thumbnailUrl` | `string` | |
| `thumbnailWidth`, `thumbnailHeight` | `number` | |

## See also

- [Watching for uploads](/notifications/watching-uploads/), which is built on the feed and falls back on the API.
- [Push notifications](/notifications/push-notifications/) to be called instead of asking.
- [IDs and URLs](/basics/ids-and-urls/) for `channelPlaylistId`, `urls.embed` and the other helpers.
- [Channels](/resources/channels/) for the dependable way to list uploads.
