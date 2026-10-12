---
title: Videos
description: Read one video or hundreds from ids and URLs, list the popular chart, update metadata, rate, report and delete.
sidebar:
  order: 2
---

```ts
const video = await yt.videos.get("https://youtu.be/dQw4w9WgXcQ");

if (video) {
  const { duration } = video.contentDetails;
  const { viewCount } = video.statistics;

  console.log(video.snippet.title);
  console.log(formatDuration(duration), formatCount(viewCount));
}
```

## Getting a video

`yt.videos.get` takes a video id or any video URL: a watch page, a `youtu.be` link, a Shorts, live or embed URL. It costs 1 quota unit and resolves to `null` when the video does not exist or is private.

```ts
await yt.videos.get("dQw4w9WgXcQ");
await yt.videos.get("https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=42s");
await yt.videos.get("https://www.youtube.com/shorts/dQw4w9WgXcQ");
```

A string that is neither an id nor a video URL throws a `YouTubeArgumentError` before anything is sent, so it costs nothing.

The default parts are `snippet`, `contentDetails` and `statistics`. Pass `part` to change them, and the result type follows:

```ts
const video = await yt.videos.get(videoId, { part: ["snippet", "status"] });

if (video) console.log(video.snippet.title, video.status.privacyStatus);
```

## Getting many videos

`yt.videos.getMany` fetches a list of ids or URLs, 50 per call, at 1 unit per call.

```ts
const found = await yt.videos.getMany(ids);

const foundIds = new Set(found.map((video) => video.id));
const missing = ids.filter((id) => !foundIds.has(id));
```

The result keeps the order you gave. Videos that do not exist or are private are left out, so the array can be shorter than the input. Duplicates are fetched once and returned once.

## Listing popular videos

`yt.videos.popular` lists the most popular videos of a region, optionally within a category. It costs 1 unit per page of 50. Awaited, it returns a page of 50.

```ts
const top = await yt.videos.popular({ regionCode: "FR" }).take(10);

const gaming = await yt.videos
  .popular({ regionCode: "US", videoCategoryId: VideoCategories.Gaming })
  .take(25);
```

Since July 2025 the chart is built from the trending Music, Movies and Gaming charts.

`VideoCategories` holds the category ids by name. They are the same in every region. Which ones a region offers is what [`videoCategories.list`](#listing-video-categories) tells. `hl` selects the language of `snippet.localized`.

## Using the raw `videos.list`

The three helpers above call `yt.videos.list`. It costs 1 unit and takes exactly one of three filters:

| Filter | Returns | Auth |
| --- | --- | --- |
| `id` | The videos with these ids. One id or a list of any length | Key |
| `chart: "mostPopular"` | The popular chart, narrowed by `regionCode` and `videoCategoryId` | Key |
| `myRating` | The videos the authenticated user liked (`"like"`) or disliked (`"dislike"`) | OAuth |

```ts
const liked = await yt.videos
  .list({ part: "snippet", myRating: "like" })
  .take(100);

for (const video of liked) console.log(video.snippet.title);
```

`maxResults` and `pageToken` apply to `chart` and `myRating`. Awaited without `maxResults`, the raw method returns the API's default page of 5, where `popular` asks for 50. A lookup by `id` returns exactly those ids: lists longer than 50 are split into calls of 50 and merged.

## Reading the parts

The duration is an ISO 8601 string such as `PT15M51S`. `parseDuration` turns it into seconds and `formatDuration` into text:

```ts
const video = await yt.videos.get(videoId, { part: "contentDetails" });

if (video) {
  parseDuration(video.contentDetails.duration); // 951
  formatDuration(video.contentDetails.duration); // "15:51"
  formatDuration(video.contentDetails.duration, "short"); // "15m 51s"
}
```

A live stream that has not ended reports `P0D`, which gives 0.

Statistics are strings, because they are 64-bit integers. Only the view count is always there:

| Field | Type | Notes |
| --- | --- | --- |
| `viewCount` | `string` | Always there |
| `likeCount` | `string \| undefined` | Absent when the owner hides it |
| `commentCount` | `string \| undefined` | Absent when comments are off |
| `dislikeCount` | `string \| undefined` | Optional in the type |

In the snippet, `tags`, `defaultLanguage` and `defaultAudioLanguage` are optional. Thumbnails are all optional too: [`bestThumbnail`](/basics/ids-and-urls/#formatting) picks the largest one there is.

Some parts stay optional even when you request them, because they only exist in some situations. `liveStreamingDetails` is the common one. [Parts and types](/basics/parts-and-types/) explains the rule.

## Telling a live video from a regular one

`snippet.liveBroadcastContent` is `"live"` while a video is live and `"upcoming"` while it is scheduled. `liveStreamingDetails` is only present for an upcoming, live or completed broadcast, so it tells a past stream from a regular upload.

```ts
const video = await yt.videos.get(videoId, {
  part: ["snippet", "liveStreamingDetails"],
});

if (video) {
  const live = video.liveStreamingDetails;

  switch (video.snippet.liveBroadcastContent) {
    case "live":
      console.log("Live now,", live?.concurrentViewers ?? "?", "watching");
      break;
    case "upcoming":
      console.log("Starts at", live?.scheduledStartTime);
      break;
    default:
      if (live) console.log("A past broadcast, ended at", live.actualEndTime);
      else console.log("A regular upload");
  }
}
```

`liveStreamingDetails.activeLiveChatId` is the id of the chat while the broadcast is live: see [Live chat](/live/live-chat/). Scheduling and running a broadcast is the subject of [Broadcasts](/live/broadcasts/).

## Updating a video

`yt.videos.update` changes the metadata of one of your videos. It needs OAuth and costs 50 units.

A part you send replaces the whole part. Sending a `snippet` with only a new title erases the description and the tags. So read the part, change it, and send it back:

```ts
const video = await yt.videos.get(videoId, { part: "snippet" });

if (video) {
  await yt.videos.update({
    body: {
      id: video.id,
      snippet: {
        ...video.snippet,
        title: "A better title",
        tags: [...(video.snippet.tags ?? []), "typescript"],
      },
    },
  });
}
```

That is 51 units: 1 for the read, 50 for the write. A `snippet` must carry `title` and `categoryId`, which the read gives you.

The same goes for the other parts. To publish a private video, read `status` and send it back with the new value:

```ts
const video = await yt.videos.get(videoId, { part: "status" });

if (video) {
  await yt.videos.update({
    body: {
      id: video.id,
      status: { ...video.status, privacyStatus: "public" },
    },
  });
}
```

`part` is optional on a write: left out, it is the list of parts present in `body`. Pass it to get a narrowed result back:

```ts
const video = await yt.videos.get(videoId, { part: "snippet" });

if (video) {
  const updated = await yt.videos.update({
    part: "snippet",
    body: {
      id: video.id,
      snippet: { ...video.snippet, categoryId: VideoCategories.Education },
    },
  });

  updated.snippet.categoryId; // "27"
}
```

## Rating a video

Rating needs OAuth. Each change costs 50 units, reading the current rating costs 1.

```ts
if ((await yt.videos.ratingOf(videoId)) !== "like") {
  await yt.videos.like(videoId);
}

await yt.videos.dislike(videoId);
await yt.videos.unrate(videoId); // removes the like or the dislike
```

`ratingOf` resolves to `"like"`, `"dislike"` or `"none"`. All four helpers accept an id or a URL.

The raw methods are `rate` and `getRating`. They take ids only. `getRating` takes one id or a list and answers for each:

```ts
await yt.videos.rate({ id: videoId, rating: "like" });

const { items } = await yt.videos.getRating({ id: ids });
for (const item of items) console.log(item.videoId, item.rating);
```

When ratings are disabled on a video, `rate` fails with the reason `videoRatingDisabled`:

```ts
try {
  await yt.videos.like(videoId);
} catch (error) {
  if (
    error instanceof YouTubeApiError &&
    error.reason === "videoRatingDisabled"
  ) {
    console.log("Ratings are off on this video");
  } else {
    throw error;
  }
}
```

## Deleting a video

`yt.videos.delete` deletes one of your videos. It needs OAuth and costs 50 units. There is no undo.

```ts
await yt.videos.delete({ id: videoId });
```

## Reporting a video

`yt.videos.reportAbuse` reports a video for abusive content, with OAuth, for 50 units. The reason is an id from `yt.videoAbuseReportReasons.list`, which costs 1 unit:

```ts
const { items } = await yt.videoAbuseReportReasons.list({
  part: "snippet",
  hl: "en",
});

for (const reason of items) {
  console.log(reason.id, reason.snippet.label);

  for (const secondary of reason.snippet.secondaryReasons ?? []) {
    console.log("  ", secondary.id, secondary.label);
  }
}
```

```ts
await yt.videos.reportAbuse({
  body: {
    videoId,
    reasonId: "S",
    comments: "Repeated links to a scam site",
    language: "en",
  },
});
```

`secondaryReasonId` narrows the report when the reason has secondary reasons.

## Listing video categories

`yt.videoCategories.list` lists the categories available in a region, or fetches categories by id. It costs 1 unit.

```ts
const { items } = await yt.videoCategories.list({
  part: "snippet",
  regionCode: "FR",
  hl: "fr",
});

const assignable = items.filter((category) => category.snippet.assignable);
for (const category of assignable) {
  console.log(category.id, category.snippet.title);
}
```

A video's category is `snippet.categoryId`. The ids do not change from one region to another, so the `VideoCategories` constant covers the common case without a call:

```ts
VideoCategories.Music; // "10"
VideoCategories.Gaming; // "20"
VideoCategories.Education; // "27"
```

When you do list them, give the method a long [cache](/basics/caching/) lifetime.

## Polling statistics

`yt.videos.batchGetStats` fetches fresh statistics for many videos. It draws from [its own bucket](/basics/quota/#buckets), 10,000 calls a day by default, so polling view counts does not eat into the shared budget. `id` is required. One call covers 50 ids. Longer lists are split, at one call per 50.

```ts
const { items } = await yt.videos.batchGetStats({
  part: "statistics",
  id: ids,
});

for (const stat of items) {
  console.log(stat.id, stat.statistics.viewCount, stat.statistics.likeCount);
}
```

The result is not a video but a lighter resource with three parts: `statistics` (`viewCount`, `likeCount`, `commentCount`), `snippet` (`publishTime`) and `contentDetails` (`duration`). Use `videos.list` for anything else.

Here the duration is not ISO 8601. It is a number of seconds followed by `s`, which `parseDuration` and `formatDuration` read too:

```ts
const { items } = await yt.videos.batchGetStats({
  part: "contentDetails",
  id: ids,
});

for (const stat of items) {
  const { duration } = stat.contentDetails; // "212s", or undefined
  if (duration) console.log(stat.id, parseDuration(duration)); // 212
}
```

## Checking the AI training permission

`yt.videoTrainability.get` tells which third parties, if any, the owner allows to train AI models on a video. It costs 1 unit and works with an API key.

```ts
const { permitted } = await yt.videoTrainability.get({ id: videoId });
// ["all"], ["none"], or a list of allowed parties
```

## Uploading a video

`yt.videos.insert` uploads a file, with chunking, progress and resume. It has a bucket of its own: 100 uploads a day by default. [Uploads](/resources/uploads/) covers it, along with thumbnails.

## Reference

Helpers:

| Helper | What it does | Quota |
| --- | --- | --- |
| `yt.videos.get(video, { part })` | One video from an id or a URL. `null` when missing or private | 1 |
| `yt.videos.getMany(videos, { part })` | Many videos, in the order given, missing ones left out | 1 per 50 |
| `yt.videos.popular({ regionCode, videoCategoryId, hl, maxResults, part })` | The popular chart of a region | 1 per page of 50 |
| `yt.videos.like(video)` | Likes a video. OAuth | 50 |
| `yt.videos.dislike(video)` | Dislikes a video. OAuth | 50 |
| `yt.videos.unrate(video)` | Removes the like or the dislike. OAuth | 50 |
| `yt.videos.ratingOf(video)` | `"like"`, `"dislike"` or `"none"`. OAuth | 1 |

Raw methods:

| Method | Quota | Auth |
| --- | --- | --- |
| `yt.videos.list` | 1 | Key. OAuth for `myRating` |
| `yt.videos.insert` | 1 call of the `videos.insert` bucket | OAuth |
| `yt.videos.update` | 50 | OAuth |
| `yt.videos.delete` | 50 | OAuth |
| `yt.videos.rate` | 50 | OAuth |
| `yt.videos.getRating` | 1 | OAuth |
| `yt.videos.reportAbuse` | 50 | OAuth |
| `yt.videos.batchGetStats` | 1 call of the `videos.batchGetStats` bucket | Key |
| `yt.videoCategories.list` | 1 | Key |
| `yt.videoAbuseReportReasons.list` | 1 | Key |
| `yt.videoTrainability.get` | 1 | Key |

`update`, `delete`, `rate` and `reportAbuse` accept the scopes `youtube`, `youtube.force-ssl` and `youtubepartner`. `getRating` also accepts `youtube.readonly`. [Scopes](/auth/scopes/) lists what each one grants.

Parts of a video:

| Part | What it holds | Always returned when requested |
| --- | --- | --- |
| `snippet` | Title, description, tags, category, channel, publication date, thumbnails, `liveBroadcastContent` | Yes |
| `contentDetails` | Duration, definition, dimension, captions flag, projection, content rating | Yes |
| `statistics` | View, like and comment counts | Yes |
| `status` | Privacy and upload status, license, embeddable, made-for-kids flags, scheduled `publishAt` | Yes |
| `player` | The `<iframe>` HTML of an embedded player | Yes |
| `liveStreamingDetails` | Scheduled and actual times, concurrent viewers, active chat id. Broadcasts only | No |
| `localizations` | Title and description per language | No |
| `topicDetails` | Wikipedia URLs that describe the content | No |
| `recordingDetails` | Where and when the video was recorded | No |
| `paidProductPlacementDetails` | Whether the video contains paid promotion. Owner only | No |
| `fileDetails` | The uploaded file: container, streams, bitrate. Owner only | No |
| `processingDetails` | Processing status and progress. Owner only | No |
| `suggestions` | Processing hints, warnings and tag suggestions. Owner only | No |
| `ageGating` | Age restriction details. Owner only | No |
| `monetizationDetails` | Whether the video can be monetized | No |
| `brandPartner` | The brand partner linked to the video | No |
| `projectDetails` | Deprecated | No |
| `id` | Nothing more: `kind`, `etag` and `id` are on every result | Yes |

## See also

- [Uploads](/resources/uploads/) for `videos.insert` and thumbnails.
- [Parts and types](/basics/parts-and-types/) for how the result type follows `part`.
- [Captions](/resources/captions/) for the caption tracks of a video.
- [Comments](/resources/comments/) for reading and posting comments.
