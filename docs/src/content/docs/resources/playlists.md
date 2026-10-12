---
title: Playlists
description: Read a playlist and walk its videos however long it is, create playlists, and add, move or remove their items.
sidebar:
  order: 3
---

```ts
for await (const item of yt.playlists.items("PLBCF2DAC6FFB574DE")) {
  const { position, title } = item.snippet;
  console.log(position, title, item.contentDetails.videoId);
}
```

## Getting a playlist

`yt.playlists.get` takes a playlist id, or any URL with a `list` parameter: a playlist page, or a watch page that plays a video inside the playlist. It costs 1 quota unit and resolves to `null` when the playlist does not exist or is private.

```ts
const playlist = await yt.playlists.get(
  "https://www.youtube.com/playlist?list=PLBCF2DAC6FFB574DE",
);

if (playlist) {
  const { title, channelTitle } = playlist.snippet;

  console.log(title, "by", channelTitle);
  console.log(playlist.contentDetails.itemCount, "videos");
  console.log(playlist.status.privacyStatus);
}
```

The default parts are `snippet`, `contentDetails` and `status`. A string that is neither such a URL nor shaped like a playlist id (`PL...`, `UU...` and the like) throws a `YouTubeArgumentError` before anything is sent.

## Listing the items of a playlist

`yt.playlists.items` lists what is in a playlist, in playlist order. It costs 1 unit per page of 50. Awaited, it returns a page of 50.

```ts
const firstHundred = await yt.playlists.items(playlistId).take(100); // 2 units

for (const item of firstHundred) {
  console.log(item.snippet.position, item.snippet.title);
  console.log(item.contentDetails.videoId, item.snippet.videoOwnerChannelTitle);
}
```

A playlist item is not a video. It is a light entry that points to one:

| Field | What it is |
| --- | --- |
| `item.id` | The id of the item itself. Updating and deleting take this one |
| `item.contentDetails.videoId` | The id of the video |
| `item.snippet.position` | Position in the playlist, starting at 0 |
| `item.snippet.title`, `description`, `thumbnails` | Title, description and thumbnails of the entry |
| `item.snippet.publishedAt` | When the item was added to the playlist |
| `item.contentDetails.videoPublishedAt` | When the video was published. Optional |
| `item.snippet.videoOwnerChannelId`, `videoOwnerChannelTitle` | The channel of the video. Optional |
| `item.snippet.channelId`, `channelTitle` | The channel that added the item |
| `item.contentDetails.note` | A note written by the playlist owner. Optional |

There is no duration and no view count. For those, use [`yt.playlists.videos`](#walking-the-videos-of-a-playlist).

A deleted or private video keeps its item in the list. The item has the title "Deleted video" or "Private video" and no thumbnails, so [`bestThumbnail`](/basics/ids-and-urls/#formatting) returns `undefined` for it.

`get` resolves to `null` for a playlist that does not exist. Listing the items of one fails instead, with a `NOT_FOUND` error.

## Walking the videos of a playlist

`yt.playlists.videos` yields full video resources in playlist order. For every page of 50 items it makes one more call to fetch the videos, so it costs 2 units per 50 videos.

```ts
for await (const video of yt.playlists.videos(playlistId)) {
  const duration = formatDuration(video.contentDetails.duration);
  console.log(video.snippet.title, duration, video.statistics.viewCount);
}
```

Deleted and private videos are skipped. A video that is in the playlist twice is yielded twice. `part` chooses the video parts, `snippet`, `contentDetails` and `statistics` by default. `limit` stops early:

```ts
const firstTen = [];

for await (const video of yt.playlists.videos(playlistId, {
  part: "snippet",
  limit: 10,
})) {
  firstTen.push(video.snippet.title);
}
```

`limit` counts the videos you get. A deleted or private video does not use it up: the walk goes on until the limit is reached or the playlist ends.

Unlike `items`, this is a plain async generator: it has no `take` or `all`. Use `for await` and `limit`.

## Computing the length of a playlist

The total duration of a playlist needs the duration of every video, which only the video resource has. Ask for `contentDetails` alone to keep the responses small:

```ts
const walk = yt.playlists.videos(playlistId, { part: "contentDetails" });
let seconds = 0;
let count = 0;

for await (const video of walk) {
  seconds += parseDuration(video.contentDetails.duration);
  count++;
}

console.log(count, "videos,", formatDuration(seconds, "short"));
// for example: 212 videos, 31h 4m 12s
```

A playlist of 500 videos costs 20 units this way: 10 pages of items and 10 calls for the videos. [Playlist length](/recipes/playlist-length/) turns it into a complete script.

## Creating a playlist

`yt.playlists.create` creates a playlist on the authenticated user's channel. It needs OAuth and costs 50 units.

```ts
const playlist = await yt.playlists.create({
  title: "Favourites",
  description: "Things worth watching twice",
  privacy: "unlisted",
});

console.log(playlist.id, playlist.status.privacyStatus);
```

| Field | Default | Meaning |
| --- | --- | --- |
| `title` | Required | Title of the playlist |
| `description` | None | Description |
| `privacy` | `"private"` | `"public"`, `"unlisted"` or `"private"` |
| `defaultLanguage` | None | Language of the title and description, for example `"en"` |

## Adding and removing videos

`yt.playlists.add` adds a video at the end of a playlist, or at `position`. It needs OAuth and costs 50 units. Both arguments accept an id or a URL.

```ts
await yt.playlists.add(playlistId, "https://youtu.be/dQw4w9WgXcQ");

const item = await yt.playlists.add(playlistId, videoId, {
  position: 0,
  note: "Start here",
});

console.log(item.id); // the playlist item id
```

`yt.playlists.removeVideo` removes every occurrence of a video from a playlist and resolves to the number of items removed. It needs OAuth. It costs 1 unit to find the items, then 50 per item removed.

```ts
const removed = await yt.playlists.removeVideo(playlistId, videoId);
console.log(removed); // 0 when the video was not in the playlist
```

## Working with playlist items directly

`removeVideo` exists because the raw methods do not take a video id. `playlistItems.update` and `playlistItems.delete` take the id of the playlist item, which is a different string. You get it from a listing, or from the result of an insert.

```ts
const item = await yt.playlistItems.insert({
  body: {
    snippet: { playlistId, resourceId: { kind: "youtube#video", videoId } },
  },
});

await yt.playlistItems.delete({ id: item.id }); // not videoId
```

To move an item, update its `snippet.position`. The snippet must carry `playlistId` and `resourceId` too, since a part you send replaces the whole part:

```ts
const item = await yt.playlistItems
  .list({ part: "snippet", playlistId, videoId })
  .first();

if (item) {
  await yt.playlistItems.update({
    body: {
      id: item.id,
      snippet: { playlistId, position: 0, resourceId: item.snippet.resourceId },
    },
  });
}
```

`playlistItems.list` takes `playlistId`, optionally narrowed by `videoId` as above, or a list of item ids in `id`. It costs 1 unit per page of 50. Awaited without `maxResults`, it returns the API's default page of 5, where `yt.playlists.items` asks for 50. The three writes cost 50 units each and need OAuth.

## Using the raw `playlists` methods

`yt.playlists.list` fetches playlists by `id`, the playlists of a channel with `channelId`, or your own with `mine: true`. It costs 1 unit per page of 50.

```ts
const playlists = await yt.playlists
  .list({ part: ["snippet", "contentDetails"], channelId })
  .all();

for (const playlist of playlists) {
  console.log(playlist.snippet.title, playlist.contentDetails.itemCount);
}
```

`insert`, `update` and `delete` need OAuth and cost 50 units each. An update replaces the parts it sends, and a `snippet` must carry `title`. Read the part, change it, send it back:

```ts
const playlist = await yt.playlists.get(playlistId, {
  part: ["snippet", "status"],
});

if (playlist) {
  await yt.playlists.update({
    body: {
      id: playlist.id,
      snippet: { ...playlist.snippet, description: "Updated every Friday" },
      status: { ...playlist.status, privacyStatus: "public" },
    },
  });
}
```

```ts
await yt.playlists.delete({ id: playlistId });
```

## Reading the special playlists of a channel

Every channel has playlists that YouTube builds for it: its uploads, its Shorts, its live streams and a few more. `channelPlaylistId` derives their ids from the channel id, without a call. Reading one costs 1 unit per 50 videos, like any playlist.

```ts
import { channelPlaylistId } from "@ix-xs/youtube.api";

channelPlaylistId("UC_x5XG1OV2P6uZZ5FSM9Ttw"); // "UU_x5XG1OV2P6uZZ5FSM9Ttw"

const popularId = channelPlaylistId(channelId, "popularVideos");
const popular = await yt.playlists.items(popularId).take(10);
```

[IDs and URLs](/basics/ids-and-urls/) lists the eight kinds and says which one YouTube documents.

The function wants a `UC...` id and throws a `YouTubeArgumentError` for anything else. With a handle or a URL, use [`yt.channels.uploads`](/resources/channels/), which resolves the channel first.

## Setting a playlist image

A playlist can have a custom thumbnail image, managed by `yt.playlistImages`. Listing costs 1 unit and works with an API key. `insert`, `update` and `delete` need OAuth and cost 50 units each. The image is a JPEG or a PNG of 50 MB at most.

```ts
const { items } = await yt.playlistImages.list({
  part: "snippet",
  parent: playlistId,
});

const created = await yt.playlistImages.insert({
  body: { snippet: { playlistId, type: "hero", width: 1080, height: 1080 } },
  media: image,
});

await yt.playlistImages.update({
  body: { id: created.id, snippet: { playlistId, type: "hero" } },
  media: image,
});

await yt.playlistImages.delete({ id: created.id });
```

`media` takes a `Blob`, bytes, a stream or a file from disk. [Uploads](/resources/uploads/) describes every form.

## Handling errors

A call the API refuses throws a `YouTubeApiError` whose `reason` says why. The ones typed for playlists:

| `error.reason` | When |
| --- | --- |
| `playlistNotFound` | The playlist was not found |
| `playlistItemNotFound` | No item has this playlist item id |
| `videoNotFound` | The video was not found |
| `videoAlreadyInPlaylist` | The video is already in the playlist |
| `playlistContainsMaximumNumberOfVideos` | The playlist is full |
| `playlistForbidden` | The request is not allowed on this playlist |

```ts
try {
  await yt.playlists.add(playlistId, videoId);
} catch (error) {
  if (
    error instanceof YouTubeApiError &&
    error.reason === "playlistContainsMaximumNumberOfVideos"
  ) {
    console.log("The playlist is full");
  } else {
    throw error;
  }
}
```

## Reference

Helpers:

| Helper | What it does | Quota |
| --- | --- | --- |
| `yt.playlists.get(playlist, { part })` | One playlist from an id or a URL. `null` when missing or private | 1 |
| `yt.playlists.items(playlist, { part })` | The items of a playlist: position, title, video id | 1 per page of 50 |
| `yt.playlists.videos(playlist, { part, limit })` | The videos of a playlist as full resources, unavailable ones skipped | 2 per 50 |
| `yt.playlists.create({ title, description, privacy, defaultLanguage })` | Creates a playlist. OAuth | 50 |
| `yt.playlists.add(playlist, video, { position, note })` | Adds a video. OAuth | 50 |
| `yt.playlists.removeVideo(playlist, video)` | Removes every occurrence of a video, returns the count. OAuth | 1, plus 50 per item removed |
| `channelPlaylistId(channelId, kind)` | The id of one of a channel's special playlists | 0 |

Raw methods:

| Method | Quota | Auth |
| --- | --- | --- |
| `yt.playlists.list` | 1 | Key. OAuth for `mine` |
| `yt.playlists.insert` | 50 | OAuth |
| `yt.playlists.update` | 50 | OAuth |
| `yt.playlists.delete` | 50 | OAuth |
| `yt.playlistItems.list` | 1 | Key, or OAuth to see private data |
| `yt.playlistItems.insert` | 50 | OAuth |
| `yt.playlistItems.update` | 50 | OAuth |
| `yt.playlistItems.delete` | 50 | OAuth |
| `yt.playlistImages.list` | 1 | Key, or OAuth to see private data |
| `yt.playlistImages.insert` | 50 | OAuth |
| `yt.playlistImages.update` | 50 | OAuth |
| `yt.playlistImages.delete` | 50 | OAuth |

Every write accepts the scopes `youtube`, `youtube.force-ssl` and `youtubepartner`. [Scopes](/auth/scopes/) lists what each one grants.

Parts of a playlist:

| Part | What it holds | Always returned when requested |
| --- | --- | --- |
| `snippet` | Title, description, channel, creation date, thumbnails | Yes |
| `contentDetails` | `itemCount`, the number of items | Yes |
| `status` | Privacy status, podcast status | Yes |
| `player` | The `<iframe>` HTML of an embedded player | Yes |
| `localizations` | Title and description per language | No |
| `id` | Nothing more: `kind`, `etag` and `id` are on every result | Yes |

Parts of a playlist item:

| Part | What it holds | Always returned when requested |
| --- | --- | --- |
| `snippet` | Position, title, description, thumbnails, `resourceId`, the channels involved | Yes |
| `contentDetails` | `videoId`, `videoPublishedAt`, `note` | Yes |
| `status` | Privacy status of the item | Yes |
| `id` | Nothing more: `kind`, `etag` and `id` are on every result | Yes |

## See also

- [Lists](/basics/lists/) for `take`, `all`, pages and iteration.
- [Channels](/resources/channels/) for `uploads` and `latestVideos`, which read a channel's uploads playlist.
- [Videos](/resources/videos/) for the video resources `yt.playlists.videos` yields.
- [Playlist length](/recipes/playlist-length/) for the worked example as a script.
