---
title: Search
description: Search videos, channels, playlists and live broadcasts with typed results, and know when a cheaper method answers the question.
sidebar:
  order: 4
---

```ts
const results = await yt.search.videos("lofi hip hop", { order: "viewCount", videoDuration: "long" }).take(10);

for (const result of results) console.log(result.id.videoId, result.snippet.title);
```

## When not to search

Search has [a quota bucket of its own](/basics/quota/#buckets): 100 calls a day by default, where everything else shares 10,000 units. Each page of results is one call. A hundred pages and you are done for the day.

So before searching, check whether another method answers the question:

| You want | Use | Cost |
| --- | --- | --- |
| What a channel uploaded | [`yt.channels.uploads`](/resources/channels/) or `latestVideos` | 1 or 2 units per 50 videos |
| The videos of a playlist | [`yt.playlists.items`](/resources/playlists/) or `videos` | 1 or 2 units per 50 videos |
| A video from its id or URL | [`yt.videos.get`](/resources/videos/) | 1 unit |
| A channel from its handle or URL | [`yt.channels.get`](/resources/channels/) | 1 unit |
| To know when a channel uploads | [`yt.watch`](/notifications/watching-uploads/) | No quota |

Search is for what only search can do: finding things from words.

## Searching videos, channels and playlists

There is one helper per result type. Each takes the query, then the filters, and returns a list you can await, iterate or bound with `take`.

```ts
const videos = await yt.search.videos("typescript tutorial").take(10);
for (const result of videos) console.log(result.id.videoId, result.snippet.title);

const [channel] = await yt.search.channels("Google for Developers").take(1);
if (channel) console.log(channel.id.channelId, channel.snippet.title);

const playlists = await yt.search.playlists("typescript course").take(5);
for (const result of playlists) console.log(result.id.playlistId, result.snippet.title);
```

The results are typed by the helper. `result.id.videoId` is a `string` on the results of `videos`, `result.id.channelId` on those of `channels`, `result.id.playlistId` on those of `playlists`. No check is needed before using them.

Each page fetched costs 1 call of the `search.list` bucket. `take(10)` asks for a page of 10, so it is one call. `take(120)` is three calls of 50.

## Finding live broadcasts

`yt.search.live` searches the broadcasts that are live right now, for a query, optionally within a channel. Its results are video results.

```ts
const live = await yt.search.live("speedrun").take(5);

for (const result of live) console.log(result.id.videoId, result.snippet.title, result.snippet.channelTitle);

const onOneChannel = await yt.search.live("speedrun", { channelId }).take(5);
```

For upcoming or finished broadcasts, use `yt.search.videos` with `eventType: "upcoming"` or `"completed"`.

## Filtering results

The second argument takes every filter of the API. The values are checked by the types.

```ts
const lastWeek = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

const recent = await yt.search
  .videos("typescript", {
    order: "date",
    publishedAfter: lastWeek,
    regionCode: "FR",
    relevanceLanguage: "fr",
    videoDefinition: "high",
    safeSearch: "strict",
  })
  .take(25);
```

`publishedAfter` and `publishedBefore` accept a `Date` or an ISO 8601 string.

| Filter | Values | What it does |
| --- | --- | --- |
| `order` | `"relevance"` (default), `"date"`, `"viewCount"`, `"rating"`, `"title"`, `"videoCount"` | Sort order. `"date"` is newest first. `"videoCount"` sorts channels by number of uploads |
| `publishedAfter`, `publishedBefore` | `Date` or string | Only resources published after or before this date |
| `channelId` | Channel id | Only resources of this channel |
| `regionCode` | Country code | Results as seen by viewers in this country |
| `relevanceLanguage` | Language code | Results relevant to this language |
| `safeSearch` | `"moderate"` (default), `"none"`, `"strict"` | How much restricted content is filtered out |
| `eventType` | `"live"`, `"upcoming"`, `"completed"`, `"none"` | Live status of the videos |
| `videoDuration` | `"any"` (default), `"short"`, `"medium"`, `"long"` | Under 4 minutes, 4 to 20 minutes, over 20 minutes |
| `videoDefinition` | `"any"`, `"standard"`, `"high"` | SD only or HD only |
| `videoDimension` | `"any"` (default), `"2d"`, `"3d"` | Without or only 3D videos |
| `videoCaption` | `"any"`, `"closedCaption"`, `"none"` | With or without captions |
| `videoLicense` | `"any"`, `"youtube"`, `"creativeCommon"` | Standard or Creative Commons license |
| `videoEmbeddable` | `"any"`, `"true"` | Only videos that can be embedded |
| `videoSyndicated` | `"any"`, `"true"` | Only syndicated videos |
| `videoPaidProductPlacement` | `"any"`, `"true"` | Only videos with paid product placement |
| `videoType` | `"any"`, `"movie"`, `"episode"` | Only movies or episodes of shows |
| `videoCategoryId` | Category id | Only videos of this category. `VideoCategories` has the ids |
| `channelType` | `"any"`, `"show"` | Only shows, in a channel search |
| `topicId` | Topic id | Only results about this topic |
| `location`, `locationRadius` | Strings | Only videos located within a distance of a point |
| `forMine`, `forDeveloper`, `forContentOwner` | `true` | Restrict to the authenticated user's own videos, to those uploaded through your project, or to a content owner's. OAuth |
| `maxResults` | 0-50, default 5 | Size of a page |

`location` and `locationRadius` go together:

```ts
const nearby = await yt.search.videos("street food", { location: "48.8566,2.3522", locationRadius: "10km" }).take(10);
```

`yt.search.live` accepts the same filters except `eventType`, which it sets.

## Getting durations and statistics

A search result is not a video. It carries an id and a snippet: `title`, `description`, `channelId`, `channelTitle`, `publishedAt`, `thumbnails` and `liveBroadcastContent`. There is no duration, no view count and no tag.

Pass the ids to `yt.videos.getMany` for the rest. That is 1 unit of the shared budget per 50 videos:

```ts
const results = await yt.search.videos("lofi hip hop", { order: "viewCount" }).take(25);
const found = await yt.videos.getMany(results.map((result) => result.id.videoId));

for (const video of found) {
  console.log(video.snippet.title, formatDuration(video.contentDetails.duration), formatCount(video.statistics.viewCount));
}
```

`getMany` keeps the order of the search. For channel results, pass the ids to `yt.channels.list` in the same way.

## Counting results

Awaiting a search gives one page, with the size of the whole result set as the API reports it:

```ts
const page = await yt.search.videos("lofi hip hop", { maxResults: 50 });

console.log(page.items.length); // up to 50
console.log(page.totalResults); // an estimate
console.log(page.nextPageToken);
```

Two things to know about these numbers:

- `totalResults` is an estimate, capped at 1,000,000. Do not show it as an exact count.
- A query never returns more than about 500 results, whatever `totalResults` says. Walking a search to the end therefore costs about 10 calls, a tenth of the daily allowance.

Without `maxResults`, an awaited page has the API's default size, which is 5. Iterating or using `take` picks the page size for you.

Always bound a search:

```ts
// One call.
const top = await yt.search.videos("lofi hip hop").take(50);

// Up to ten calls. Only when you need everything.
const everything = await yt.search.videos("lofi hip hop").all();
```

## Using the raw `search.list`

The helpers call `yt.search.list` with `part: "snippet"` and one `type`. Call it yourself to mix types, or to search without a query:

```ts
const { items } = await yt.search.list({ part: "snippet", q: "typescript", type: ["video", "playlist"], maxResults: 25 });

for (const result of items) {
  if (result.id.videoId) console.log("video", result.id.videoId, result.snippet.title);
  else if (result.id.playlistId) console.log("playlist", result.id.playlistId, result.snippet.title);
}
```

Here the three ids are optional in the type, since a result can be any of the requested types. `result.id.kind` tells which: `"youtube#video"`, `"youtube#channel"` or `"youtube#playlist"`. Leave `type` out to get all three.

`q` is optional. This lists the newest videos of a channel, at the price of a search call. `yt.channels.uploads` does the same for 1 unit:

```ts
const newest = await yt.search.list({ part: "snippet", channelId, type: "video", order: "date" }).take(10);
```

## Reference

Helpers:

| Helper | What it does | Quota |
| --- | --- | --- |
| `yt.search.videos(query, filters)` | Searches videos. `result.id.videoId` is set | 1 search call per page of 50 |
| `yt.search.channels(query, filters)` | Searches channels. `result.id.channelId` is set | 1 search call per page of 50 |
| `yt.search.playlists(query, filters)` | Searches playlists. `result.id.playlistId` is set | 1 search call per page of 50 |
| `yt.search.live(query, filters)` | Searches the broadcasts that are live now. `result.id.videoId` is set | 1 search call per page of 50 |

Each helper takes the usual request options as a third argument.

Raw methods:

| Method | Quota | Auth |
| --- | --- | --- |
| `yt.search.list` | 1 call of the `search.list` bucket, 100 a day by default | Key. OAuth for `forMine`, `forDeveloper` and `forContentOwner` |

Parts of a search result:

| Part | What it holds | Always returned when requested |
| --- | --- | --- |
| `snippet` | Title, description, channel, publication date, thumbnails, `liveBroadcastContent` | Yes |
| `id` | Nothing more: `id` is on every result. It is an object with `kind` and `videoId`, `channelId` or `playlistId` | Yes |

Types, for your own functions:

| Type | What it is |
| --- | --- |
| `VideoSearchResult` | A result of `yt.search.videos` or `live` |
| `ChannelSearchResult` | A result of `yt.search.channels` |
| `PlaylistSearchResult` | A result of `yt.search.playlists` |
| `SearchFilters` | The second argument of the helpers |

## See also

- [Quota](/basics/quota/) for the buckets and how to track what is left.
- [Lists](/basics/lists/) for `take`, `all` and pages.
- [Videos](/resources/videos/) for `getMany` and the parts of a video.
- [Caching](/basics/caching/) to avoid paying twice for the same query.
