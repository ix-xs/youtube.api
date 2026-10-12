---
title: Broadcasts and streams
description: Schedule a live broadcast, connect an encoder to it, take it live and end it. Every broadcast and stream method needs OAuth and costs 1 unit.
sidebar:
  order: 1
---

```ts
const stream = await yt.liveStreams.insert({
  part: ["snippet", "cdn"],
  body: {
    snippet: { title: "Main encoder" },
    cdn: {
      ingestionType: "rtmp",
      resolution: "variable",
      frameRate: "variable",
    },
  },
});

const broadcast = await yt.liveBroadcasts.insert({
  part: ["snippet", "status", "contentDetails"],
  body: {
    snippet: {
      title: "Friday stream",
      scheduledStartTime: "2027-01-01T18:00:00Z",
    },
    status: { privacyStatus: "unlisted", selfDeclaredMadeForKids: false },
    contentDetails: { enableAutoStart: true, enableAutoStop: true },
  },
});

await yt.liveBroadcasts.bind({
  id: broadcast.id,
  streamId: stream.id,
  part: ["id", "contentDetails"],
});

const info = stream.cdn.ingestionInfo;
console.log(info?.ingestionAddress, info?.streamName);
```

## Two objects

Going live involves two resources, and the API keeps them apart.

| Resource | What it is | Client |
| --- | --- | --- |
| Broadcast | The event viewers watch: title, schedule, privacy, state | `yt.liveBroadcasts` |
| Stream | The ingestion endpoint an encoder sends video to | `yt.liveStreams` |

A broadcast has one stream. A stream can feed several broadcasts, so one encoder setup can serve the shows you schedule at different times.

The whole sequence is: create a stream, schedule a broadcast, bind them, start the encoder, go live, end. Each call costs 1 unit. An API key is refused before anything is sent: see [Limits and errors](#limits-and-errors).

## Creating a stream

`liveStreams.insert` creates the endpoint and returns what the encoder needs. Ask for the `cdn` part to get it back. Quota: 1 unit.

```ts
const stream = await yt.liveStreams.insert({
  part: ["snippet", "cdn", "contentDetails"],
  body: {
    snippet: { title: "Main encoder" },
    cdn: {
      ingestionType: "rtmp",
      resolution: "variable",
      frameRate: "variable",
    },
    contentDetails: { isReusable: true },
  },
});

const info = stream.cdn.ingestionInfo;
console.log(info?.ingestionAddress); // where the encoder connects
console.log(info?.streamName); // the stream key
console.log(info?.rtmpsIngestionAddress); // the same endpoint over RTMPS
console.log(info?.backupIngestionAddress); // optional second endpoint
```

Some encoders take the address and the key in two fields. Others want one URL of the form `ingestionAddress/streamName`.

`contentDetails.isReusable` decides whether the stream can be bound to more than one broadcast. A stream that is not reusable can be bound once, may be deleted by YouTube after its broadcast ends, and is left out of `liveStreams.list({ mine: true })`: read it by `id` instead.

## Scheduling a broadcast

`liveBroadcasts.insert` puts the event on the schedule. Quota: 1 unit.

```ts
const broadcast = await yt.liveBroadcasts.insert({
  part: ["snippet", "status", "contentDetails"],
  body: {
    snippet: {
      title: "Friday stream",
      description: "Questions welcome in the chat.",
      scheduledStartTime: "2027-01-01T18:00:00Z",
    },
    status: { privacyStatus: "unlisted", selfDeclaredMadeForKids: false },
    contentDetails: {
      enableAutoStart: true,
      enableAutoStop: true,
      enableDvr: true,
      latencyPreference: "low",
    },
  },
});

broadcast.status.lifeCycleStatus; // "ready" once the settings are complete
```

`enableAutoStart` and `enableAutoStop` ask YouTube to start and end the broadcast for you. Both are off by default. Leave them off when you want to decide the moment yourself with [`transition`](#going-live).

A broadcast is one YouTube video. Its title, description and privacy can be changed through the broadcast or through the video resource.

## Binding the two

`liveBroadcasts.bind` attaches the broadcast to the stream. Quota: 1 unit.

```ts
const bound = await yt.liveBroadcasts.bind({
  id: broadcastId,
  streamId,
  part: ["id", "contentDetails"],
});

bound.contentDetails.boundStreamId; // the stream that feeds this broadcast
```

Call it without `streamId` to detach the stream:

```ts
await yt.liveBroadcasts.bind({ id: broadcastId, part: "id" });
```

## Going live

Start the encoder, then wait for the stream to report `active`. A broadcast cannot move to `testing` or `live` before that.

```ts
async function waitUntilActive(id: string): Promise<void> {
  for (;;) {
    const stream = await yt.liveStreams
      .list({ part: "status", id }, { cache: false })
      .first();
    if (stream?.status.streamStatus === "active") return;
    await new Promise((resolve) => setTimeout(resolve, 5000));
  }
}

await waitUntilActive(streamId);
```

Each check is one `liveStreams.list` call, 1 unit. `cache: false` matters when the client has a [cache](/basics/caching/): a cached answer would stay the same until it expires.

Then move the broadcast with `liveBroadcasts.transition`. Quota: 1 unit per call.

```ts
// Optional: a rehearsal that only you can see.
await yt.liveBroadcasts.transition({
  id: broadcastId,
  broadcastStatus: "testing",
  part: "status",
});

// Visible to its audience.
const live = await yt.liveBroadcasts.transition({
  id: broadcastId,
  broadcastStatus: "live",
  part: "status",
});
live.status.lifeCycleStatus; // "liveStarting" while the move is under way

// Ends the broadcast.
await yt.liveBroadcasts.transition({
  id: broadcastId,
  broadcastStatus: "complete",
  part: "status",
});
```

## Listing your broadcasts

`liveBroadcasts.list` filters by state. Quota: 1 unit per page.

```ts
const upcoming = await yt.liveBroadcasts.list({
  part: ["snippet", "status"],
  broadcastStatus: "upcoming",
});

for (const { snippet, status } of upcoming.items) {
  console.log(snippet.title, snippet.scheduledStartTime);
  console.log(status.lifeCycleStatus);
}

// Everything, across pages.
const all = yt.liveBroadcasts.list({
  part: "snippet",
  broadcastStatus: "all",
});
for await (const broadcast of all) {
  console.log(broadcast.id, broadcast.snippet.title);
}
```

`broadcastStatus` is `"upcoming"`, `"active"`, `"completed"` or `"all"`. Pass `id` instead to read specific broadcasts. More than 50 ids are split across calls, 1 unit each.

While a broadcast is live, the `statistics` part carries the number of people watching:

```ts
const current = await yt.liveBroadcasts
  .list({ part: ["snippet", "statistics"], id: broadcastId }, { cache: false })
  .first();

// A string. Absent when the owner hides the count.
console.log(current?.statistics?.concurrentViewers);
```

## Changing a broadcast

`liveBroadcasts.update` changes the title, the schedule, the privacy or the settings. Quota: 1 unit.

```ts
const current = await yt.liveBroadcasts
  .list({ part: "snippet", id: broadcastId })
  .first();

if (current) {
  await yt.liveBroadcasts.update({
    body: {
      id: broadcastId,
      snippet: {
        title: "Friday stream, part 2",
        description: current.snippet.description,
        scheduledStartTime: current.snippet.scheduledStartTime,
      },
    },
  });
}
```

:::caution
Read the part, then send back what you want to keep, as the sample does. [Videos](/resources/videos/#updating-a-video) explains why.
:::

`liveStreams.update` does the same for a stream. Only the title, the description and a few CDN settings can change once a stream exists.

## Inserting an ad break

`liveBroadcasts.insertCuepoint` inserts an ad break into a broadcast that is live. Quota: 1 unit.

```ts
const cuepoint = await yt.liveBroadcasts.insertCuepoint({
  id: broadcastId,
  body: { cueType: "cueTypeAd", durationSecs: 30 },
});
```

To place the break at a given moment, add `insertionOffsetTimeMs` (an offset from the actual start of the broadcast) or `walltimeMs` (a clock time). Both are numbers of milliseconds written as strings. Set one or the other, not both. YouTube may move a cuepoint by up to 5 seconds.

## Reading the health of a stream

The `status` part of a stream says whether video arrives and how good it is. Quota: 1 unit.

```ts
const stream = await yt.liveStreams
  .list({ part: ["snippet", "status"], id: streamId }, { cache: false })
  .first();

if (stream) {
  // "created" | "ready" | "active" | "inactive" | "error"
  console.log(stream.status.streamStatus);
  // "good" | "ok" | "bad" | "noData" | "revoked"
  console.log(stream.status.healthStatus?.status);

  for (const issue of stream.status.healthStatus?.configurationIssues ?? []) {
    console.log(issue.severity, issue.reason, issue.description);
  }
}
```

`configurationIssues` is where YouTube tells you what is wrong with what the encoder sends: bitrate, keyframe interval, codec, resolution. Each issue has a `severity` of `info`, `warning` or `error`.

List every reusable stream of the account with `mine: true`:

```ts
const { items } = await yt.liveStreams.list({
  part: ["snippet", "cdn", "status"],
  mine: true,
});
```

## Opening the chat of a broadcast

The broadcast carries the id of its chat in `snippet.liveChatId`.

```ts
const broadcast = await yt.liveBroadcasts
  .list({ part: "snippet", id: broadcastId })
  .first(); // 1 unit

if (broadcast?.snippet.liveChatId) {
  const chat = yt.liveChat(broadcast.snippet.liveChatId);
  await chat.send("We are live."); // 20 units
}
```

[Live chat](/live/live-chat/) covers reading, writing and moderating.

## Deleting

Both deletes cost 1 unit.

```ts
await yt.liveBroadcasts.delete({ id: broadcastId });
await yt.liveStreams.delete({ id: streamId });
```

## Is a channel live right now?

Everything above is about your own broadcasts and needs OAuth. To find out whether any channel is live, an API key is enough.

A search restricted to live events answers for a channel you only know by id:

```ts
const [live] = await yt.search.live("", { channelId }).take(1);

if (live) console.log("Live now:", live.snippet.title, live.id.videoId);
```

This is one `search.list` call. It is charged to the search bucket, which holds 100 calls a day by default: see [Quota](/basics/quota/#buckets). Do not poll it every minute.

When you already have a video id, `videos.list` costs 1 unit of the shared bucket and says more:

```ts
const video = await yt.videos.get(videoId, {
  part: ["snippet", "liveStreamingDetails"],
});

if (video?.snippet.liveBroadcastContent === "live") {
  console.log(video.liveStreamingDetails?.actualStartTime);
  console.log(video.liveStreamingDetails?.concurrentViewers);
  console.log(video.liveStreamingDetails?.activeLiveChatId);
}
```

[Videos](/resources/videos/) describes `liveBroadcastContent` and `liveStreamingDetails`.

## Reference

### Methods

Every method costs 1 unit and needs OAuth.

| Method | What it does |
| --- | --- |
| `yt.liveStreams.insert` | Creates a stream and returns the ingestion address and stream key |
| `yt.liveStreams.list` | Lists your streams with `mine: true`, or reads some by `id` |
| `yt.liveStreams.update` | Changes the title, the description or a few CDN settings |
| `yt.liveStreams.delete` | Deletes a stream |
| `yt.liveBroadcasts.insert` | Schedules a broadcast |
| `yt.liveBroadcasts.bind` | Attaches a broadcast to a stream, or detaches it without `streamId` |
| `yt.liveBroadcasts.transition` | Moves a broadcast to `testing`, `live` or `complete` |
| `yt.liveBroadcasts.list` | Lists your broadcasts by `broadcastStatus`, or reads some by `id` |
| `yt.liveBroadcasts.update` | Changes the title, schedule, privacy or settings |
| `yt.liveBroadcasts.insertCuepoint` | Inserts an ad break |
| `yt.liveBroadcasts.delete` | Deletes a broadcast |

`part` is required on `list`, `bind` and `transition`. On `insert` and `update` it defaults to the parts present in `body`.

### `status.lifeCycleStatus` of a broadcast

| Value | Meaning |
| --- | --- |
| `created` | Valid, but its settings are incomplete |
| `ready` | Settings complete |
| `testStarting` | A move to `testing` was requested |
| `testing` | Visible to you only |
| `liveStarting` | A move to `live` was requested |
| `live` | On air |
| `complete` | Finished |
| `revoked` | Removed by an administrative action |

### `status.streamStatus` of a stream

`created`, `ready`, `active`, `inactive` or `error`. A broadcast can only go to `testing` or `live` while its stream is `active`.

### Settings in `contentDetails` of a broadcast

| Field | Meaning |
| --- | --- |
| `enableAutoStart` | Start the broadcast automatically. Default false |
| `enableAutoStop` | End the broadcast automatically. Default false |
| `enableDvr` | Viewers can pause, rewind and fast forward. Default true |
| `enableEmbed` | The broadcast can be played in an embedded player |
| `recordFromStart` | Record as soon as the broadcast goes live. Default true |
| `latencyPreference` | `"normal"`, `"low"` or `"ultraLow"`. `ultraLow` does not support closed captions, 1440p or 4K |
| `monitorStream.enableMonitorStream` | Enables a stream that only you see, to review the content. Cannot be changed once the broadcast is `testing` or `live` |
| `monitorStream.broadcastStreamDelayMs` | Delay of the broadcast when the monitor stream is on |
| `closedCaptionsType` | `"closedCaptionsDisabled"`, `"closedCaptionsHttpPost"` or `"closedCaptionsEmbedded"` |
| `projection` | `"rectangular"` (default), `"360"` or `"mesh"` |
| `boundStreamId` | The stream bound to the broadcast |

For the archive to be playable right after the broadcast ends, keep both `enableDvr` and `recordFromStart` true.

## Limits and errors

With an API key and no OAuth, every method of the reference above throws a `YouTubeAuthError` with the code `MISSING_CREDENTIALS` before anything is sent. No quota is spent, and the message lists the scopes that work.

| Calls | Scopes, any one of |
| --- | --- |
| `list` on broadcasts and streams | `youtube.readonly`, `youtube`, `youtube.force-ssl` |
| Every write | `youtube`, `youtube.force-ssl` |
| `insertCuepoint` | `youtube`, `youtube.force-ssl`, `youtubepartner` |

When the client knows the scopes of the token and none of them fits, the call fails the same way with `INSUFFICIENT_SCOPE`. [Scopes](/auth/scopes/) has the full list.

API errors arrive as a `YouTubeApiError`. The reasons worth branching on here:

| `error.reason` | When |
| --- | --- |
| `liveBroadcastNotFound` | No broadcast matches the id |
| `liveStreamNotFound` | No stream matches the id |

```ts
try {
  await yt.liveBroadcasts.transition({
    id: broadcastId,
    broadcastStatus: "live",
    part: "status",
  });
} catch (error) {
  if (!(error instanceof YouTubeApiError)) throw error;
  console.error(error.status, error.reason, error.message);
}
```

A transition the API refuses, for example going `live` while the stream is not `active`, also comes back as a `YouTubeApiError`. Log `error.reason` and `error.message`.

## See also

- [Live chat](/live/live-chat/) to read and moderate the chat of a broadcast.
- [OAuth](/auth/oauth/) and [Scopes](/auth/scopes/) for the credentials these calls need.
- [Search](/resources/search/) for the other filters of `yt.search.live`.
- [Every method](/reference/methods/) for the complete list with costs.
