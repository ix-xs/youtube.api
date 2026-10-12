---
title: Total length of a playlist
description: A script that takes a playlist URL and prints how many videos it holds, how long they run in total and on average, and which one is the longest. An API key is enough.
sidebar:
  order: 3
---

## What you get

A command that answers "how long is this playlist?" for a playlist of any size. It also tells you how many of its entries could not be counted because the video is deleted or private.

## What it needs

An API key in `YOUTUBE_API_KEY`, see [Credentials](/start/credentials/). A private playlist is not visible to an API key.

Quota: 1 unit for the playlist itself, then 2 units per 50 entries of the playlist. A playlist of 200 videos costs 9 units.

## The program

```ts title="playlist-length.ts"
import {
  YouTube,
  formatDuration,
  parseDuration,
  playlistIdFrom,
  urls,
} from "@ix-xs/youtube.api";

const input = process.argv[2];
const playlistId = input ? playlistIdFrom(input) : null;
if (!playlistId) {
  console.error("Usage: playlist-length.ts <playlist URL or id>");
  process.exit(1);
}

const yt = new YouTube(); // reads YOUTUBE_API_KEY

const part = ["snippet", "contentDetails"] as const;

const playlist = await yt.playlists.get(playlistId, { part });
if (!playlist) {
  console.error("This playlist does not exist or is private.");
  process.exit(1);
}

let count = 0;
let total = 0;
let longest: { title: string; seconds: number; url: string } | undefined;

for await (const video of yt.playlists.videos(playlistId, { part })) {
  const seconds = parseDuration(video.contentDetails.duration);
  count++;
  total += seconds;
  if (!longest || seconds > longest.seconds) {
    const url = urls.video(video.id);
    longest = { title: video.snippet.title, seconds, url };
  }
}

const entries = playlist.contentDetails.itemCount;
const skipped = entries > count ? ` of ${entries} entries` : "";

console.log(playlist.snippet.title);
console.log(`Videos:   ${count}${skipped}`);
console.log(`Total:    ${formatDuration(total)}`);
if (count) console.log(`Average:  ${formatDuration(total / count)}`);
if (longest) {
  const length = formatDuration(longest.seconds);
  console.log(`Longest:  ${length}  ${longest.title}  ${longest.url}`);
}
console.log(`Quota:    ${yt.quota.used} units`);
```

## Run it

```bash
npm install @ix-xs/youtube.api

export YOUTUBE_API_KEY=...
node playlist-length.ts "https://www.youtube.com/playlist?list=PLBCF2DAC6FFB574DE"
```

Node.js 22.18 and newer run a `.ts` file as it is. On an older version, use `npx tsx playlist-length.ts` with the same argument. Quote the URL: a watch URL with `&list=` would otherwise be cut by the shell.

The output looks like this:

```txt
My playlist
Videos:   42 of 45 entries
Total:    12:34:56
Average:  17:58
Longest:  1:02:03  The longest one  https://www.youtube.com/watch?v=...
Quota:    3 units
```

## How it works

**`playlistIdFrom(input)`** accepts a playlist id, a playlist URL, or a watch URL that carries a `list` parameter. It returns `null` for anything else, so the script can print its usage before spending quota.

**`yt.playlists.videos`** does the two steps the API requires. A playlist item holds a title and a video id, not a duration. The helper reads the items 50 at a time (1 unit), then fetches those videos in one call (1 unit), and yields them in playlist order. Pages are fetched as the loop advances, so memory stays flat on a playlist of thousands of videos.

**`part`** asks for what the script reads: the title is in `snippet`, the duration in `contentDetails`. It is declared `as const` so that both calls keep the part names in their result types. Leaving `statistics` out makes the responses smaller. It does not change the cost.

**Deleted and private videos are skipped** by the helper, because the API does not return them. `contentDetails.itemCount` is the number of entries the playlist reports. When it is higher than the number of videos counted, the difference is what the helper left out. A video listed twice in the playlist is counted twice, as it would play twice.

**The cost follows the entries, not the videos.** A page of 50 entries costs 2 units even when some of them are skipped.

**`parseDuration`** turns the ISO 8601 duration of the API (`PT4M13S`) into seconds. A live stream that has not ended reports `P0D`, which gives 0.

**`formatDuration`** takes seconds or an ISO 8601 string and prints `4:13` or `1:02:03`. Hours are not folded into days: a 30 hour playlist prints `30:00:00`.

## Going further

### Watch time at 1.5x

Divide before formatting:

```ts
import { formatDuration } from "@ix-xs/youtube.api";

const total = 45_296; // seconds, from the loop above

for (const speed of [1.25, 1.5, 2]) {
  console.log(`At ${speed}x: ${formatDuration(total / speed)}`);
}
```

### Only the first videos

`limit` stops the walk early. It counts the videos you get, not the playlist entries read: deleted and private videos do not use it up.

```ts
let total = 0;

const first = yt.playlists.videos(playlistId, {
  part: "contentDetails",
  limit: 100,
});
for await (const video of first) {
  total += parseDuration(video.contentDetails.duration);
}
```

That is 4 units when the first 100 entries are all available: two pages of items and two calls for the videos.

### Skip short videos

The video resource does not say whether a video is a Short. A minimum duration is a rough stand-in: it also drops regular videos under the threshold, so choose it for the playlist at hand.

```ts
const MIN_SECONDS = 90; // your own threshold
let total = 0;

const walk = yt.playlists.videos(playlistId, { part: "contentDetails" });
for await (const video of walk) {
  const seconds = parseDuration(video.contentDetails.duration);
  if (seconds < MIN_SECONDS) continue;
  total += seconds;
}
```

### Export to CSV

Write one line per video and open the file in a spreadsheet:

```ts
import { createWriteStream } from "node:fs";
import { parseDuration, urls } from "@ix-xs/youtube.api";

const out = createWriteStream("playlist.csv");
const quote = (value: string | number) =>
  `"${String(value).replaceAll('"', '""')}"`;

out.write("position,title,seconds,url\n");
let position = 0;
const part = ["snippet", "contentDetails"] as const;
for await (const video of yt.playlists.videos(playlistId, { part })) {
  const seconds = parseDuration(video.contentDetails.duration);
  const url = urls.video(video.id);
  const cells = [++position, video.snippet.title, seconds, url];
  out.write(`${cells.map(quote).join(",")}\n`);
}
out.end();
```

### More

- [Playlists](/resources/playlists/) for the other playlist helpers.
- [IDs and URLs](/basics/ids-and-urls/#formatting) for `formatDuration`, `formatCount` and the URL builders.
- [Quota](/basics/quota/) to follow what a long walk spends.
