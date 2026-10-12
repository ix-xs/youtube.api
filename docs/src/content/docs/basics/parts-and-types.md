---
title: Parts and types
description: YouTube only returns the parts of a resource you ask for. The result type follows that list, so a missing part is a compile error instead of an undefined at runtime.
sidebar:
  order: 1
---

```ts
const { items } = await yt.videos.list({
  part: ["snippet", "statistics"],
  id: "dQw4w9WgXcQ",
}); // 1 unit
const video = items[0];

if (video) {
  video.snippet.title; // string
  video.statistics.viewCount; // string
  // @ts-expect-error contentDetails was not requested
  video.contentDetails;
}
```

## What a part is

A YouTube resource is split into parts. A video has `snippet` (title, description, thumbnails), `contentDetails` (duration, definition), `statistics` (views, likes), `status` (privacy) and 13 more. A read that takes a `part` parameter returns those parts and nothing else. Asking for more parts makes the response larger. It does not change the quota cost.

`part` takes one name or a list. Each of these calls costs 1 unit:

```ts
await yt.channels.list({ part: "snippet", forHandle: "@GoogleDevelopers" });
await yt.channels.list({
  part: ["snippet", "statistics"],
  forHandle: "@GoogleDevelopers",
});
```

The names are checked. A typo, or a part of another resource, does not compile:

```ts
// @ts-expect-error "snipet" is not a part of a video
yt.videos.list({ part: "snipet", id: videoId });
```

## What the result type contains

The type of each item is built from the parts in the call.

| On the result | Typed as |
| --- | --- |
| `kind`, `etag`, `id` | Always there, never optional |
| A requested part the API always returns | Required: `video.snippet` |
| A requested part the API may leave out | Optional: `video.liveStreamingDetails?` |
| A part that was not requested | Absent. Reading it is a compile error |

Some parts only exist in some situations, even when you ask for them. `liveStreamingDetails` is only there when the video is an upcoming, live or completed live broadcast. Those parts stay optional, so the compiler makes you handle the case:

```ts
const video = await yt.videos
  .list({ part: ["snippet", "liveStreamingDetails"], id: videoId })
  .first(); // 1 unit

const chatId = video?.liveStreamingDetails?.activeLiveChatId;
```

Parts that are always returned when requested, for the three resources you will use most:

| Resource | Always returned |
| --- | --- |
| Video | `snippet`, `contentDetails`, `statistics`, `status`, `player` |
| Channel | `snippet`, `contentDetails`, `statistics`, `status`, `brandingSettings` |
| Playlist | `snippet`, `contentDetails`, `status`, `player` |

## Fields inside a part

Inside a part, some fields are required and others optional. The optional ones are worth knowing, because they are where code written from a single example breaks:

```ts
const video = await yt.videos.get(videoId); // 1 unit

if (video) {
  video.snippet.title; // string
  video.snippet.tags; // string[] | undefined
  video.statistics.viewCount; // string
  video.statistics.likeCount; // string | undefined
  video.statistics.commentCount; // string | undefined
}
```

Counts are 64-bit integers, which the API sends as strings. Convert with `Number()` when you need arithmetic, or display them with [`formatCount`](/basics/ids-and-urls/#formatting).

A thumbnail set can be empty: a deleted or private video inside a playlist has none. [`bestThumbnail`](/basics/ids-and-urls/#formatting) picks the largest one there is.

## Naming the types

Each resource has a type that takes the parts as an argument. Use it to type your own functions:

```ts
import type { Video } from "@ix-xs/youtube.api";

function describe(video: Video<"snippet" | "statistics">): string {
  return `${video.snippet.title} (${video.statistics.viewCount} views)`;
}

const video = await yt.videos.get(videoId, {
  part: ["snippet", "statistics", "status"],
});
if (video) describe(video); // more parts than needed is fine
```

`Video` without an argument is the full resource with every part optional. Any narrowed video can be passed where a plain `Video` is expected, so it is the right type for "some video, I will check what is on it":

```ts
import type { Video } from "@ix-xs/youtube.api";

function titleOf(video: Video): string {
  return video.snippet?.title ?? "(no snippet)";
}

const video = await yt.videos.get(videoId, { part: "snippet" });
if (video) titleOf(video);
```

## Helpers choose parts for you

The helpers that take an id or a URL have default parts, so the common case needs no list. Pass `part` to change them, and the type follows as usual.

```ts
const video = await yt.videos.get("https://youtu.be/dQw4w9WgXcQ");
// Video<"snippet" | "contentDetails" | "statistics"> | null

const slim = await yt.videos.get(videoId, { part: "status" });
// Video<"status"> | null
```

| Helper | Default parts |
| --- | --- |
| `yt.videos.get`, `getMany`, `popular`, `yt.channels.latestVideo`, `latestVideos`, `yt.playlists.videos` | `snippet`, `contentDetails`, `statistics` |
| `yt.channels.get`, `mine` | `snippet`, `contentDetails`, `statistics` |
| `yt.playlists.get` | `snippet`, `contentDetails`, `status` |
| `yt.channels.uploads`, `yt.playlists.items` | `snippet`, `contentDetails` |
| `yt.commentThreads.forVideo`, `yt.comments.replies` | `snippet` |

## Writes

A write sends parts and gets the same parts back. `part` is optional there: left out, it is the list of parts present in `body`. Each of these two calls costs 50 units:

```ts
const playlist = await yt.playlists.insert({
  body: {
    snippet: { title: "Favourites" },
    status: { privacyStatus: "private" },
  },
});
playlist.id; // string: a created resource always has its id

const typed = await yt.playlists.insert({
  part: ["snippet", "status"],
  body: {
    snippet: { title: "Favourites" },
    status: { privacyStatus: "private" },
  },
});
typed.snippet.title; // string: with an explicit part, the result is narrowed
```

Bodies accept any subset of the resource, at any depth, and their values are still checked:

```ts
await yt.playlists.insert({
  body: {
    snippet: { title: "Favourites" },
    // @ts-expect-error privacyStatus is "public", "unlisted" or "private"
    status: { privacyStatus: "secret" },
  },
});
```

:::caution
An update replaces every part it sends, whole. What you leave out of a part is not kept. Read the part, change it, send it back. [Videos](/resources/videos/#updating-a-video) shows the pattern.
:::

## Smaller responses with `fields`

`part` chooses whole parts. The `fields` request option goes further and names the exact fields to return, which shrinks the payload. The types are not narrowed by it, so only read what you asked for.

```ts
const page = await yt.playlistItems.list(
  { part: "snippet", playlistId },
  { fields: "items(snippet(title,resourceId/videoId)),nextPageToken" },
); // 1 unit
```

## Reference

| Type | What it is |
| --- | --- |
| `Video<P>`, `Channel<P>`, `Playlist<P>`, ... | A resource narrowed to the parts `P` |
| `Video`, `Channel`, ... without argument | The full resource, every part optional |
| `VideoPart`, `ChannelPart`, ... | The union of the part names of a resource |
| `VideoResource`, `ChannelResource`, ... | The same full resource, under its own name |
| `Identified<T>` | What a write returns without `part`: `kind`, `etag` and `id` are known, every part is optional |
| `Body<T>` | A request body: the resource with every field optional, at any depth |

There are 26 resources typed this way. [All exports](/reference/exports/#resources) lists them.

## See also

- [Lists](/basics/lists/) for what `list` returns and how to walk it.
- [Quota](/basics/quota/): parts are free, calls are not.
- [Videos](/resources/videos/) and [Channels](/resources/channels/) for the parts of each in detail.
