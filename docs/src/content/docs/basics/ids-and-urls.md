---
title: Ids, URLs and formatting
description: Functions that read YouTube URLs, check and derive ids, build links, and format durations and counts. None of them calls the API, so none of them costs quota.
sidebar:
  order: 7
---

```ts
import {
  formatDuration,
  parseUrl,
  urls,
  videoIdFrom,
} from "@ix-xs/youtube.api";

parseUrl("https://youtu.be/dQw4w9WgXcQ?t=42");
// { type: "video", videoId: "dQw4w9WgXcQ", format: "watch", start: 42 }

videoIdFrom("https://www.youtube.com/shorts/dQw4w9WgXcQ"); // "dQw4w9WgXcQ"

urls.video("dQw4w9WgXcQ", { start: 42 });
// "https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=42s"

formatDuration("PT1H2M3S"); // "1:02:03"
```

## When you need them

Often you do not. The helpers of the client take an id or a URL and sort it out themselves. Each of these calls costs 1 unit:

```ts
await yt.videos.get("https://youtu.be/dQw4w9WgXcQ");
await yt.playlists.items(
  "https://www.youtube.com/playlist?list=PLBCF2DAC6FFB574DE",
);
await yt.channels.get("https://www.youtube.com/@GoogleDevelopers");
```

The functions on this page are for your own code: validating what a user pasted, routing a link to the right handler, storing a clean id, or building a link to show. They are plain functions. They work without a client and without credentials.

## Reading a URL

`parseUrl` tells what a YouTube URL points to. The result has a `type`, and the fields that go with it. It returns `null` for anything that is not a YouTube link.

```ts
function describe(input: string): string {
  const link = parseUrl(input);
  if (!link) return "Not a YouTube link";

  switch (link.type) {
    case "video": {
      const from = link.start ? `, from ${link.start} s` : "";
      return `Video ${link.videoId}${from}`;
    }
    case "playlist":
      return `Playlist ${link.playlistId}`;
    case "channel": {
      const { channelId, handle, username, customUrl } = link;
      return `Channel ${channelId ?? handle ?? username ?? customUrl}`;
    }
  }
}
```

The forms it understands:

| URL | Result |
| --- | --- |
| `youtube.com/watch?v=ID` | `{ type: "video", videoId, format: "watch" }` |
| `youtu.be/ID` | `{ type: "video", videoId, format: "watch" }` |
| `youtube.com/shorts/ID` | `{ type: "video", videoId, format: "short" }` |
| `youtube.com/live/ID` | `{ type: "video", videoId, format: "live" }` |
| `youtube.com/embed/ID`, `/v/ID`, `/e/ID` | `{ type: "video", videoId, format: "embed" }` |
| `youtube.com/playlist?list=ID` | `{ type: "playlist", playlistId }` |
| `youtube.com/embed/videoseries?list=ID` | `{ type: "playlist", playlistId }` |
| `youtube.com/channel/UC...` | `{ type: "channel", channelId }` |
| `youtube.com/@handle`, with or without a tab such as `/videos` | `{ type: "channel", handle }`, with the leading `@` |
| `youtube.com/user/name` | `{ type: "channel", username }` |
| `youtube.com/c/name` | `{ type: "channel", customUrl }` |
| `youtube.com/name` | `{ type: "channel", customUrl }` |

On a video link, two query parameters add a field:

- `list` gives `playlistId`, the playlist the link plays the video in.
- `t` or `start` gives `start`, in seconds. `42`, `42s`, `1m30s` and `1h2m3s` are all read.

```ts
parseUrl(
  "https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=PLBCF2DAC6FFB574DE&t=1m30s",
);
// {
//   type: "video",
//   videoId: "dQw4w9WgXcQ",
//   format: "watch",
//   playlistId: "PLBCF2DAC6FFB574DE",
//   start: 90,
// }
```

Accepted hosts are `youtube.com` and `youtube-nocookie.com`, bare or with `www.`, `m.`, `music.` or `gaming.` in front, and `youtu.be`. The scheme can be left out: `"youtube.com/@GoogleDevelopers"` works.

`null` comes back for another site, for a YouTube page that is not a video, a playlist or a channel (`/feed/subscriptions`, `/results`), and for a video link whose id is not 11 characters long. A bare id is not a URL: `parseUrl("dQw4w9WgXcQ")` is `null`. Use `videoIdFrom` for input that can be either.

A `customUrl` is a legacy `/c/name` or `/name` address. The API has no lookup for those. `yt.channels.get` tries the name as a handle, then as a username, which is usually right.

## Getting an id out of anything

`videoIdFrom` and `playlistIdFrom` take an id or a URL and return the id, or `null` when there is none. They are what the helpers use on their arguments.

```ts
videoIdFrom("dQw4w9WgXcQ"); // "dQw4w9WgXcQ"
videoIdFrom("https://www.youtube.com/shorts/abcdefghijk"); // "abcdefghijk"
videoIdFrom("https://www.youtube.com/@GoogleDevelopers"); // null

const watch = "https://www.youtube.com/watch?v=dQw4w9WgXcQ";

playlistIdFrom("PLBCF2DAC6FFB574DE"); // "PLBCF2DAC6FFB574DE"
playlistIdFrom(`${watch}&list=PLBCF2DAC6FFB574DE`); // "PLBCF2DAC6FFB574DE"
playlistIdFrom(watch); // null
```

A typical use is cleaning a form field before storing it:

```ts
function videoIdOrThrow(input: string): string {
  const id = videoIdFrom(input);
  if (!id) throw new Error("Paste a YouTube video link or a video id");
  return id;
}
```

## Channel references

A channel can be designated in four ways. `parseChannelRef` works out which one a string is.

```ts
parseChannelRef("UC_x5XG1OV2P6uZZ5FSM9Ttw");
// { by: "id", value: "UC_x5XG1OV2P6uZZ5FSM9Ttw" }

parseChannelRef("@GoogleDevelopers");
// { by: "handle", value: "@GoogleDevelopers" }

parseChannelRef("GoogleDevelopers");
// { by: "handle", value: "@GoogleDevelopers" }

parseChannelRef("https://www.youtube.com/user/GoogleDevelopers");
// { by: "username", value: "GoogleDevelopers" }

parseChannelRef("youtube.com/c/GoogleDevelopers");
// { by: "custom", value: "GoogleDevelopers" }
```

| `by` | Comes from | Looking it up |
| --- | --- | --- |
| `"id"` | A `UC...` id, or a `/channel/UC...` URL | Nothing to resolve |
| `"handle"` | An `@handle`, a `/@handle` URL, or a bare name | `channels.list` with `forHandle`, 1 unit. A bare name is then tried as a username, 1 more unit |
| `"username"` | A `/user/name` URL | `channels.list` with `forUsername`, 1 unit |
| `"custom"` | A `/c/name` or `/name` URL | No direct lookup. Tried as a handle, then as a username |

A bare name is read as a handle, because handles are by far the most common today. `parseChannelRef` throws a `YouTubeArgumentError` for an empty string and for a URL that is not a channel URL.

It does not call the API. To get the `UC...` id of any reference, use the client:

```ts
const id = await yt.channels.resolveId("@GoogleDevelopers");
// "UC_x5XG1OV2P6uZZ5FSM9Ttw"
```

An id or a `/channel/` URL costs nothing. A handle or a username costs 1 unit the first time, 2 for a bare name that turns out to be a legacy username, and the client remembers the answer.

## Checking an id

`isVideoId`, `isChannelId` and `isPlaylistId` check the shape of a string. They do not tell whether the resource exists.

```ts
isVideoId("dQw4w9WgXcQ"); // true: 11 URL-safe characters
isChannelId("UC_x5XG1OV2P6uZZ5FSM9Ttw"); // true: "UC" followed by 22 characters
isPlaylistId("PLBCF2DAC6FFB574DE"); // true
isPlaylistId("UU_x5XG1OV2P6uZZ5FSM9Ttw"); // true: an uploads playlist

isChannelId("@GoogleDevelopers"); // false
isPlaylistId("dQw4w9WgXcQ"); // false
```

The checks are loose on purpose. Any 11 characters among letters, digits, `-` and `_` look like a video id, `"hello_world"` included. To know that a video exists, fetch it: `yt.videos.get` resolves to `null` when it does not.

## The playlists of a channel

A channel has playlists that YouTube generates. Their ids are the channel id with another prefix, so `channelPlaylistId` derives them without any call.

```ts
channelPlaylistId("UC_x5XG1OV2P6uZZ5FSM9Ttw");
// "UU_x5XG1OV2P6uZZ5FSM9Ttw"

channelPlaylistId("UC_x5XG1OV2P6uZZ5FSM9Ttw", "shorts");
// "UUSH_x5XG1OV2P6uZZ5FSM9Ttw"
```

| Kind | Prefix | Holds | Documented by YouTube |
| --- | --- | --- | --- |
| `"uploads"` (default) | `UU` | Everything the channel uploaded | Yes. It is `contentDetails.relatedPlaylists.uploads` on the channel |
| `"videos"` | `UULF` | Uploads without Shorts and live streams | No |
| `"shorts"` | `UUSH` | Shorts only | No |
| `"live"` | `UULV` | Live streams only | No |
| `"popularVideos"` | `UULP` | The regular videos, sorted by views | No |
| `"popularShorts"` | `UUPS` | The Shorts, sorted by views | No |
| `"popularLive"` | `UUPV` | The live streams, sorted by views | No |
| `"membersOnlyVideos"` | `UUMO` | The videos for members only | No |

:::caution
Only `uploads` is part of the documented API. The other prefixes are not documented by YouTube. They have been stable for years, but nothing guarantees them. If your code depends on one, handle the case where it stops working.
:::

Reading one of these playlists is a `playlistItems.list`: 1 unit for 50 videos. A search for the same list would take one of your 100 daily search calls.

```ts
const shortsId = channelPlaylistId(channelId, "shorts");
const shorts = await yt.playlists.items(shortsId).take(50); // 1 unit

// The same, from any channel reference:
const sameShorts = await yt.channels
  .uploads("@GoogleDevelopers", { kind: "shorts" })
  .take(50);
```

`channelPlaylistId` checks the shape of the channel id and throws a `YouTubeArgumentError` for anything else. A channel that never uploaded has no uploads playlist: reading it fails with a `NOT_FOUND` error.

## Building URLs

`urls` builds the links you show to people.

```ts
urls.video("dQw4w9WgXcQ");
// "https://www.youtube.com/watch?v=dQw4w9WgXcQ"

urls.video("dQw4w9WgXcQ", { start: 42 });
// "https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=42s"

urls.video("dQw4w9WgXcQ", { short: true, start: 42 });
// "https://youtu.be/dQw4w9WgXcQ?t=42s"

urls.video("dQw4w9WgXcQ", { playlistId: "PLBCF2DAC6FFB574DE" });
// "https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=PLBCF2DAC6FFB574DE"

urls.short("dQw4w9WgXcQ");
// "https://www.youtube.com/shorts/dQw4w9WgXcQ"

urls.channel("@GoogleDevelopers");
// "https://www.youtube.com/@GoogleDevelopers"

urls.channel("UC_x5XG1OV2P6uZZ5FSM9Ttw");
// "https://www.youtube.com/channel/UC_x5XG1OV2P6uZZ5FSM9Ttw"

urls.playlist("PLBCF2DAC6FFB574DE");
// "https://www.youtube.com/playlist?list=PLBCF2DAC6FFB574DE"
```

`urls.embed` gives the `src` of an `<iframe>` player:

```ts
urls.embed("dQw4w9WgXcQ"); // "https://www.youtube.com/embed/dQw4w9WgXcQ"

urls.embed("dQw4w9WgXcQ", {
  noCookie: true,
  start: 30,
  autoplay: true,
  mute: true,
});
// "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?start=30&autoplay=1&mute=1"
```

`noCookie` serves the player from `youtube-nocookie.com`, which sets no cookie until playback. `loop` also adds the video as its own playlist, because the player only loops a playlist.

`urls.thumbnail` gives the address of a video's thumbnail without any API call:

```ts
urls.thumbnail("dQw4w9WgXcQ");
// "https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg"

urls.thumbnail("dQw4w9WgXcQ", "maxres");
// "https://i.ytimg.com/vi/dQw4w9WgXcQ/maxresdefault.jpg"
```

The qualities are `"default"`, `"medium"`, `"high"` (the default), `"standard"` and `"maxres"`. `maxres` is missing on older or low-resolution uploads, and the URL is built without checking. When you already have the video, `bestThumbnail` below picks one that exists.

## Formatting

The API returns durations as ISO 8601 strings and counts as strings of digits. These functions turn them into numbers and into text to display.

```ts
const video = await yt.videos.get(videoId); // 1 unit

if (video) {
  parseDuration(video.contentDetails.duration); // 253
  formatDuration(video.contentDetails.duration); // "4:13"
  formatCount(video.statistics.viewCount); // "1.2M"
  bestThumbnail(video.snippet.thumbnails)?.url; // the largest one available
}
```

### Durations

`parseDuration` converts `contentDetails.duration` to seconds.

```ts
parseDuration("PT4M13S"); // 253
parseDuration("PT1H2M3S"); // 3723
parseDuration("P1DT2H"); // 93600
parseDuration("P0D"); // 0
parseDuration("253s"); // 253: the form videos.batchGetStats uses
```

A live stream that has not ended reports `P0D`, which gives 0. A string in neither form throws a `YouTubeArgumentError`.

`formatDuration` takes seconds or a string `parseDuration` reads, and a style:

| Call | Result |
| --- | --- |
| `formatDuration("PT1H2M3S")` | `"1:02:03"` |
| `formatDuration(253)` | `"4:13"` |
| `formatDuration("PT45S")` | `"0:45"` |
| `formatDuration("PT1H2M3S", "short")` | `"1h 2m 3s"` |
| `formatDuration("PT4M13S", "short")` | `"4m 13s"` |
| `formatDuration(3600, "short")` | `"1h"` |
| `formatDuration(0, "short")` | `"0s"` |

`"clock"` is the default style. Hours are not folded into days: `formatDuration(90_061)` is `"25:01:01"`.

### Counts

`formatCount` writes a number the way YouTube shows it. Statistics come back from the API as strings, so strings are accepted as they are.

```ts
formatCount("1234567"); // "1.2M"
formatCount(34_100); // "34.1K"
formatCount("999"); // "999"
formatCount("1234567", "de"); // "1,2 Mio."
```

The second argument is a locale, or a list of locales. The default is `"en"`. The text comes from `Intl.NumberFormat`, so it depends on the locale data of the runtime. Some locales put a no-break space before the unit: compare such strings with care in tests.

A value that is not a number throws a `YouTubeArgumentError`. Some counts are optional, `likeCount` for one, so check before you format:

```ts
const video = await yt.videos.get(videoId); // 1 unit
const likes = video?.statistics.likeCount;

console.log(likes === undefined ? "not available" : formatCount(likes));
```

### Thumbnails

`bestThumbnail` picks the largest image of a `snippet.thumbnails` object and returns it whole, with its `url`, `width` and `height`. It returns `undefined` when there is none, which happens for deleted or private videos in a playlist. It accepts `undefined` and `null`, so it chains.

```ts
// 1 unit per page of 50 items.
for await (const item of yt.playlists.items(playlistId)) {
  const image = bestThumbnail(item.snippet.thumbnails);
  console.log(item.snippet.title, image?.url ?? "(no thumbnail)");
}
```

### Categories

`VideoCategories` names the ids of the video categories, so you do not write `"20"` for Gaming.

```ts
const top = await yt.videos
  .popular({ regionCode: "FR", videoCategoryId: VideoCategories.Gaming })
  .take(10); // 1 unit
```

| Name | Id | Name | Id |
| --- | --- | --- | --- |
| `FilmAndAnimation` | `"1"` | `Comedy` | `"23"` |
| `AutosAndVehicles` | `"2"` | `Entertainment` | `"24"` |
| `Music` | `"10"` | `NewsAndPolitics` | `"25"` |
| `PetsAndAnimals` | `"15"` | `HowtoAndStyle` | `"26"` |
| `Sports` | `"17"` | `Education` | `"27"` |
| `TravelAndEvents` | `"19"` | `ScienceAndTechnology` | `"28"` |
| `Gaming` | `"20"` | `NonprofitsAndActivism` | `"29"` |
| `PeopleAndBlogs` | `"22"` | | |

The ids are the same in every region. Only their availability differs, which `yt.videoCategories.list({ part: "snippet", regionCode })` tells for 1 unit.

## Reference

| Function | Returns | What it does |
| --- | --- | --- |
| `parseUrl(input)` | `YouTubeLink \| null` | Reads a YouTube URL |
| `videoIdFrom(input)` | `string \| null` | The video id of an id or of any video URL |
| `playlistIdFrom(input)` | `string \| null` | The playlist id of an id or of a URL with a `list` parameter |
| `parseChannelRef(input)` | `ChannelRef` | Tells an id, a handle, a username or a custom URL apart. Throws on anything else |
| `isVideoId(value)` | `boolean` | 11 URL-safe characters |
| `isChannelId(value)` | `boolean` | `UC` followed by 22 characters |
| `isPlaylistId(value)` | `boolean` | A playlist prefix such as `PL` or `UU` and at least 10 more characters, or `WL` or `LL` alone. Never a string shaped like a video id |
| `channelPlaylistId(channelId, kind?)` | `string` | The id of one of a channel's generated playlists |
| `urls.video(videoId, options?)` | `string` | Watch page. Options: `start`, `playlistId`, `short` |
| `urls.short(videoId)` | `string` | Shorts player |
| `urls.channel(channel)` | `string` | Channel page, from an id or an `@handle` |
| `urls.playlist(playlistId)` | `string` | Playlist page |
| `urls.embed(videoId, options?)` | `string` | Player for an `<iframe>`. Options: `start`, `end`, `autoplay`, `mute`, `loop`, `controls`, `noCookie`, `hl` |
| `urls.thumbnail(videoId, quality?)` | `string` | Thumbnail image. Default quality: `"high"` |
| `parseDuration(iso)` | `number` | ISO 8601 duration to seconds |
| `formatDuration(duration, style?)` | `string` | Seconds or ISO 8601 to `"1:02:03"` or `"1h 2m 3s"` |
| `formatCount(count, locale?)` | `string` | Compact number: `"1.2M"` |
| `bestThumbnail(thumbnails)` | A thumbnail, or `undefined` | The largest image of a `snippet.thumbnails` object |
| `VideoCategories` | An object | Category ids by name |

The types are exported too: `YouTubeLink`, `ChannelRef`, `ChannelPlaylistKind`, `VideoUrlOptions`, `EmbedUrlOptions` and `ThumbnailQuality`.

## See also

- [Channels](/resources/channels/): `yt.channels.get`, `resolveId` and `uploads`, which use these functions.
- [Quota](/basics/quota/): why the uploads playlist beats a search.
- [Feeds and oEmbed](/notifications/feeds-and-oembed/): titles and thumbnails with no key and no quota.
- [All exports](/reference/exports/): everything the package exports.
