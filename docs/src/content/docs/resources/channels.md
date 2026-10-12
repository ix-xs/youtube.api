---
title: Channels
description: Read a channel from a handle, a URL or an id, list what it uploaded, and edit its branding and its home tab.
sidebar:
  order: 1
---

```ts
const channel = await yt.channels.get("@GoogleDevelopers");

if (channel) {
  console.log(channel.id, channel.snippet.title);
  console.log(channel.statistics.videoCount, "videos");
}
```

## Getting a channel

`yt.channels.get` takes whatever you have and resolves to the channel, or to `null` when nothing matches. It costs 1 quota unit, or 2 when a name has to be tried twice.

```ts
await yt.channels.get("UC_x5XG1OV2P6uZZ5FSM9Ttw"); // an id
await yt.channels.get("@GoogleDevelopers"); // a handle
await yt.channels.get("GoogleDevelopers"); // a bare name

// URLs: a handle on any tab, a channel id, a legacy username.
await yt.channels.get("https://www.youtube.com/@GoogleDevelopers/videos");
await yt.channels.get("youtube.com/channel/UC_x5XG1OV2P6uZZ5FSM9Ttw");
await yt.channels.get("https://www.youtube.com/user/GoogleDevelopers");
```

What is sent depends on what you pass:

| You pass | Looked up by | Cost |
| --- | --- | --- |
| An id, or a `/channel/UC...` URL | `id` | 1 |
| `@handle`, or a `/@handle` URL | `forHandle` | 1 |
| A `/user/name` URL | `forUsername` | 1 |
| A bare name | `forHandle`, then `forUsername` when no handle matches | 1 or 2 |
| A `/c/name` URL, or `youtube.com/name` | `forHandle`, then `forUsername` when no handle matches | 1 or 2 |

A bare name is tried as a handle first, because handles are by far the most common today. Old accounts still answer to a username, hence the second attempt. A dot does not turn a bare name into a URL: `"some.name"` is read as a handle.

The API has no lookup for legacy `/c/name` URLs. The helper tries the name as a handle, then as a username, because the name usually survives as the handle. That is a guess: it can resolve to `null` for a channel that exists, so keep the `/channel/UC...` URL or the handle when you have the choice.

An empty string, or a URL that is not a channel URL, throws a `YouTubeArgumentError` before anything is sent.

The default parts are `snippet`, `contentDetails` and `statistics`. Pass `part` to change them:

```ts
const slim = await yt.channels.get("@GoogleDevelopers", { part: "snippet" });
// Channel<"snippet"> | null
```

## Getting your own channel

`yt.channels.mine` fetches the channel of the authenticated user. It needs OAuth and costs 1 unit. It resolves to `null` for a Google account that has no YouTube channel.

```ts
const me = await yt.channels.mine({ part: ["snippet", "status"] });

if (me) console.log(me.snippet.title, me.status.privacyStatus);
```

## Getting only the id

Most of the API wants a `UC...` id. `yt.channels.resolveId` turns any reference into one, and resolves to `null` when no channel matches.

```ts
// No call: the id is read from the string.
await yt.channels.resolveId("UC_x5XG1OV2P6uZZ5FSM9Ttw");
await yt.channels.resolveId("youtube.com/channel/UC_x5XG1OV2P6uZZ5FSM9Ttw");

// 1 unit the first time.
await yt.channels.resolveId("@GoogleDevelopers");

// No call: the same handle, written another way.
await yt.channels.resolveId("https://www.youtube.com/@googledevelopers");
```

Ids and `/channel/` URLs cost nothing. A handle or a username costs 1 unit the first time, or 2 for a bare name that turns out to be a legacy username. The client then remembers the answer for as long as it lives, however the handle is written: with or without `@`, in another case, or as a URL. It also remembers every channel found by `get`.

The helpers that take a channel (`uploads`, `latestVideos`, `latestVideo` and those of `yt.subscriptions`) resolve it this way. That is the "plus 1 the first time" in their costs.

## Listing what a channel uploaded

`yt.channels.uploads` reads the channel's uploads playlist, newest first. It costs 1 unit per page of 50 videos, where a search would spend one of your 100 daily search calls. Awaited, it returns a page of 50.

```ts
for await (const item of yt.channels.uploads("@GoogleDevelopers")) {
  console.log(item.contentDetails.videoId, item.snippet.title);
}

const lastTenShorts = await yt.channels
  .uploads(channelId, { kind: "shorts" })
  .take(10);
```

The items are playlist items, with the parts `snippet` and `contentDetails` by default: a title and the video id, but no duration and no statistics. [Playlists](/resources/playlists/) describes them.

`kind` narrows the list:

| `kind` | What is listed |
| --- | --- |
| `"uploads"` (default) | Everything the channel uploaded |
| `"videos"` | Regular videos, without Shorts and live streams |
| `"shorts"` | Shorts only |
| `"live"` | Live streams only |

Four more kinds exist: `"popularVideos"`, `"popularShorts"`, `"popularLive"` and `"membersOnlyVideos"`. Only the uploads playlist is documented by YouTube. [IDs and URLs](/basics/ids-and-urls/) has the details.

A channel that never uploaded has no uploads playlist, so the request fails with a `NOT_FOUND` error. A reference that matches no channel throws a `YouTubeArgumentError`.

```ts
try {
  const items = await yt.channels.uploads(channelId).take(50);
  console.log(items.length);
} catch (error) {
  if (isYouTubeError(error, "NOT_FOUND")) {
    console.log("This channel has no uploads");
  } else {
    throw error;
  }
}
```

## Getting the latest videos

`yt.channels.latestVideos` goes one step further: it reads the uploads playlist, then fetches the videos themselves, so you get durations and statistics.

```ts
const videos = await yt.channels.latestVideos("@GoogleDevelopers", {
  limit: 3,
});

for (const video of videos) {
  const duration = formatDuration(video.contentDetails.duration);
  console.log(video.snippet.title, duration, video.statistics.viewCount);
}
```

It costs 2 units for up to 50 videos, plus 1 to resolve a handle the first time. `limit` defaults to 5. `kind` works as in `uploads`, and `part` chooses the video parts (`snippet`, `contentDetails` and `statistics` by default).

A channel without uploads gives an empty array, not an error. A reference that matches no channel throws a `YouTubeArgumentError`.

`yt.channels.latestVideo` returns the newest one, or `null`:

```ts
const video = await yt.channels.latestVideo("@GoogleDevelopers", {
  kind: "videos",
});

if (video) console.log(`Latest video: ${video.snippet.title}`);
```

To be told when a channel uploads, do not poll this: use [Watching uploads](/notifications/watching-uploads/).

## Reading statistics

Counts are strings, because they are 64-bit integers. Convert them with `Number()` or display them with [`formatCount`](/basics/ids-and-urls/#formatting).

```ts
const channel = await yt.channels.get("@GoogleDevelopers", {
  part: "statistics",
});

if (channel) {
  const { viewCount, videoCount, subscriberCount, hiddenSubscriberCount } =
    channel.statistics;

  console.log(Number(videoCount), formatCount(viewCount));
  console.log(
    hiddenSubscriberCount ? "hidden" : formatCount(subscriberCount ?? "0"),
  );
}
```

| Field | Type | Notes |
| --- | --- | --- |
| `viewCount` | `string` | Always there |
| `videoCount` | `string` | Always there |
| `hiddenSubscriberCount` | `boolean` | `true` when the channel hides its subscriber count |
| `subscriberCount` | `string \| undefined` | Absent when the count is hidden |

YouTube rounds the public subscriber count down to three significant figures: a channel with 123,456 subscribers reports `"123000"`. The API does the rounding, not the library, so no option turns it off.

## Using the raw `channels.list`

The helpers call `yt.channels.list`, which you can use directly. It costs 1 unit and takes one filter:

| Filter | Returns | Auth |
| --- | --- | --- |
| `id` | The channels with these ids. One id or a list | Key |
| `forHandle` | The channel with this handle | Key |
| `forUsername` | The channel with this legacy username | Key |
| `mine: true` | The channel of the authenticated user | OAuth |
| `managedByMe: true` | The channels managed by the authenticated user | OAuth |
| `mySubscribers: true` | The channels subscribed to the authenticated user | OAuth |

```ts
const { items } = await yt.channels.list({
  part: ["snippet", "statistics"],
  id: ids,
});

for (const channel of items) {
  console.log(channel.snippet.title, channel.statistics.videoCount);
}
```

`id` takes any number of ids. Lists longer than 50 are split into calls of 50, at 1 unit each, and merged. `hl` selects the language of `snippet.localized`.

## Updating branding settings

`yt.channels.update` changes a channel's branding settings, its localizations or its made-for-kids status. It needs OAuth and costs 50 units.

A part you send replaces the whole part. Read it, change it, send it back:

```ts
const channel = await yt.channels.mine({ part: "brandingSettings" });

if (channel) {
  const branding = channel.brandingSettings;

  await yt.channels.update({
    body: {
      id: channel.id,
      brandingSettings: {
        ...branding,
        channel: { ...branding.channel, description: "New description" },
      },
    },
  });
}
```

The banner is set the same way, after uploading the image: see [Uploads](/resources/uploads/).

## Editing the home tab

Channel sections are the shelves of a channel's home tab. Reading them costs 1 unit and works with an API key. Writing them needs OAuth and costs 50 units per call.

```ts
const { items } = await yt.channelSections.list({
  part: ["snippet", "contentDetails"],
  channelId,
});

for (const section of items) {
  const { position, type, title } = section.snippet;
  console.log(position, type, title);
}
```

```ts
const section = await yt.channelSections.insert({
  body: {
    snippet: { type: "singlePlaylist", position: 0 },
    contentDetails: { playlists: [playlistId] },
  },
});

await yt.channelSections.update({
  body: {
    id: section.id,
    snippet: { type: "singlePlaylist", position: 2 },
    contentDetails: { playlists: [playlistId] },
  },
});

await yt.channelSections.delete({ id: section.id });
```

A channel can have at most 10 sections. `snippet.type` says what the shelf shows: `"singlePlaylist"`, `"multiplePlaylists"`, `"multipleChannels"`, `"recentUploads"`, `"popularUploads"` and others, all listed by the type. `contentDetails.playlists` carries the playlist ids of the two playlist types, `contentDetails.channels` the channel ids of `"multipleChannels"`. As with every update, a part you send replaces the whole part.

`list` takes `channelId`, `mine: true` or `id`.

## Reading recent activity

`yt.activities.list` lists what a channel did recently: uploads, likes made public, playlist additions and so on. It costs 1 unit per page of up to 50, and takes `channelId` with an API key or `mine: true` with OAuth.

```ts
const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

const activities = await yt.activities
  .list({
    part: ["snippet", "contentDetails"],
    channelId,
    publishedAfter: since,
  })
  .take(20);

for (const activity of activities) {
  console.log(activity.snippet.type, activity.snippet.title);

  if (activity.snippet.type === "upload") {
    console.log(activity.contentDetails.upload?.videoId);
  }
}
```

`publishedAfter` and `publishedBefore` accept a `Date` or an ISO 8601 string. In `contentDetails`, only the object named after `snippet.type` is filled.

## Reference

Helpers:

| Helper | What it does | Quota |
| --- | --- | --- |
| `yt.channels.get(channel, { part })` | One channel from an id, a handle, a name or a URL. `null` when not found | 1, or 2 for a bare name or a `/c/` URL that is not a handle |
| `yt.channels.mine({ part })` | The authenticated user's channel. `null` without a channel. OAuth | 1 |
| `yt.channels.resolveId(channel)` | The `UC...` id of any reference, or `null` | 0 for an id. Else 1 the first time, or 2 for a bare name that is a legacy username |
| `yt.channels.uploads(channel, { kind, part })` | The channel's uploads as playlist items, newest first | 1 per page of 50 |
| `yt.channels.latestVideos(channel, { limit, kind, part })` | The latest uploads as full videos. `[]` without uploads | 2 per 50 videos |
| `yt.channels.latestVideo(channel, { kind, part })` | The latest upload as a full video, or `null` | 2 |

`uploads`, `latestVideos` and `latestVideo` add the cost of `resolveId` the first time they see a handle or a name. All three throw a `YouTubeArgumentError` when no channel matches.

Raw methods:

| Method | Quota | Auth |
| --- | --- | --- |
| `yt.channels.list` | 1 | Key. OAuth for `mine`, `managedByMe` and `mySubscribers` |
| `yt.channels.update` | 50 | OAuth |
| `yt.channelSections.list` | 1 | Key. OAuth for `mine` |
| `yt.channelSections.insert` | 50 | OAuth |
| `yt.channelSections.update` | 50 | OAuth |
| `yt.channelSections.delete` | 50 | OAuth |
| `yt.activities.list` | 1 | Key. OAuth for `mine` |

The writes accept the scopes `youtube`, `youtube.force-ssl` and `youtubepartner`. [Scopes](/auth/scopes/) lists what each one grants.

Parts of a channel:

| Part | What it holds | Always returned when requested |
| --- | --- | --- |
| `snippet` | Title, description, custom URL, creation date, thumbnails, country | Yes |
| `contentDetails` | `relatedPlaylists`: the ids of the uploads and likes playlists | Yes |
| `statistics` | View, video and subscriber counts | Yes |
| `status` | Privacy status, made-for-kids flags, long uploads status | Yes |
| `brandingSettings` | Channel title, description, keywords, country, trailer, banner image | Yes |
| `localizations` | Title and description per language | No |
| `topicDetails` | Wikipedia URLs that describe the channel's content | No |
| `auditDetails` | Standing of the channel, for YouTube Partners during an audit | No |
| `contentOwnerDetails` | The content owner linked to the channel, for YouTube Partners | No |
| `conversionPings` | Deprecated | No |
| `id` | Nothing more: `kind`, `etag` and `id` are on every result | Yes |

## See also

- [IDs and URLs](/basics/ids-and-urls/) for parsing and building channel links yourself.
- [Playlists](/resources/playlists/) for the playlist items `uploads` returns.
- [Watching uploads](/notifications/watching-uploads/) to react to new videos without polling the API.
- [Subscriptions](/resources/subscriptions/) for who a channel follows and who follows it.
