---
title: Watching for uploads
description: Get told when a channel publishes a video, by polling. Nothing to host, and no quota as long as YouTube's public feed answers.
sidebar:
  order: 1
---

```ts
const watcher = yt.watch(["@GoogleDevelopers", "@YouTube"], { interval: "5m" });

watcher.on("video", (video) => {
  console.log(`${video.channelTitle} uploaded ${video.title}: ${video.url}`);
});
watcher.on("error", ({ channel, error }) => console.warn(channel, error));

watcher.start();
```

## How it works

`yt.watch(channels, options)` returns a `Watcher`. Channels are given as ids, handles or URLs, one or a list.

A round checks every channel, four at a time. `start()` runs one round now, then one per `interval`. For each channel, the watcher reads its 15 most recent videos and reports the ones that are new.

A video is new when both are true:

- it was published after `since`;
- this watcher has not seen it before.

`since` defaults to the moment the watcher is created, so a fresh watcher only reports uploads from now on. It never floods you with the back catalogue.

## Reacting to events

```ts
const watcher = yt.watch("@GoogleDevelopers");

const off = watcher.on("video", async (video) => {
  try {
    await notify(`${video.title} ${video.url}`);
  } catch (error) {
    console.error("Could not notify:", error);
  }
});

watcher.on("error", ({ channel, error }) => console.warn(`Could not check ${channel}:`, error));
watcher.on("poll", ({ channel, source, found }) => console.log(channel, source, found));

watcher.start();

// Later.
off(); // removes that listener
watcher.stop(); // stops polling
```

| Event | Payload | When |
| --- | --- | --- |
| `video` | A `WatchedVideo` | A new video was found. Within a round, oldest first |
| `error` | `{ channel, error }` | Checking one channel failed. The watcher keeps going |
| `poll` | `{ channel, channelId, source, found }` | A channel was checked, with the number of new videos |

`on` returns a function that removes the listener. `once` and `off` exist too.

Catch errors inside an async listener, as above. The watcher does not await listeners, so a rejected promise is an unhandled rejection in your process.

Listen to `error`. Without a listener, a channel that cannot be checked fails silently: a mistyped handle, a feed outage in `feed` mode, a quota problem.

## As a stream

A watcher is also an async iterable. The loop starts the watcher and stops it when you leave.

```ts
for await (const video of yt.watch(["@GoogleDevelopers"], { interval: "10m" })) {
  console.log(video.title, video.url);
  if (video.title.includes("Keynote")) break; // also stops the watcher
}
```

## Adding and removing channels

```ts
const watcher = yt.watch([]).start();

watcher.add("@GoogleDevelopers").add("https://www.youtube.com/@YouTube");
watcher.remove("@GoogleDevelopers");

watcher.channels; // ["https://www.youtube.com/@YouTube"]
watcher.running; // true
```

`remove` takes the channel the way you gave it to `add`. A channel added by handle is not removed by its id.

A channel added later with `add()` starts from the moment it is added: what it published before is not reported, whatever `since` says.

## From a cron job

When there is no long-lived process, run one round per invocation with `check()`. It resolves to the new videos, oldest first. They are also emitted as `video` events.

Give `since` the time of your previous run, so nothing published between two runs is missed:

```ts
const startedAt = new Date();
const lastRun: string | undefined = await db.get("lastRun");

const watcher = yt.watch(["@GoogleDevelopers", "@YouTube"], { since: lastRun ?? startedAt });

let failed = false;
watcher.on("error", ({ channel, error }) => {
  failed = true;
  console.warn(channel, error);
});

for (const video of await watcher.check()) {
  await notify(`${video.channelTitle}: ${video.title} ${video.url}`);
}

// Only move the mark forward when every channel was read.
if (!failed) await db.set("lastRun", startedAt.toISOString());
```

Two details make this safe:

- The mark is the time the run started, not the time it ended. A video published during the run is picked up by the next one.
- `check()` does not reject when a channel fails. It emits `error` and returns what the other channels had. If you moved the mark anyway, the uploads of the failed channel would be skipped for good.

The same option catches up after a restart of a long-lived watcher. The catch-up reaches back 15 videos per channel at most, because that is what a round reads.

`since` takes a `Date`, an ISO string or a timestamp in milliseconds. An invalid date throws a `YouTubeArgumentError`.

## Where the watcher looks

The `source` option decides.

| `source` | Reads | Cost |
| --- | --- | --- |
| `"auto"` (default) | The public feed. When the feed of a channel fails, the API for that channel | Nothing while the feed works |
| `"feed"` | The public feed only | Nothing |
| `"api"` | The uploads playlist, through the Data API | 1 unit per channel per round |

On top of that, a handle or a URL costs 1 unit to resolve to an id, once. Channel ids cost nothing.

### The feed, honestly

The public feed is an Atom document YouTube serves for every channel. It needs no key and no quota. YouTube does not guarantee it:

- It lags a few minutes behind uploads.
- It has outages where every feed answers 404, for hours.

That is why `auto` is the default. When the feed of a channel fails, the watcher reads that channel through the API in the same round, and keeps doing so for 30 minutes before it tries the feed again. During an outage a round costs 1 unit per channel.

What an outage costs depends on the pace. With 10 channels every 5 minutes, there are 12 rounds an hour: 120 units per hour of outage, and 2,880 units if it lasted the whole day. `source: "api"` costs that every day.

With `source: "feed"`, a failure is an `error` event and the round reports nothing for that channel. The error is a `YouTubeRequestError` with the code `FEED_UNAVAILABLE`. Videos published during the outage are reported once the feed is back, as long as they are still among the 15 most recent.

[Feeds and oEmbed](/notifications/feeds-and-oembed/) describes the feed itself.

## What a video looks like

```ts
const watcher = yt.watch("@GoogleDevelopers");

watcher.on("video", (video) => {
  video.videoId; // "dQw4w9WgXcQ"
  video.channelId; // "UC..."
  video.channelTitle;
  video.title;
  video.url;
  video.publishedAt; // ISO 8601
  video.thumbnail; // string | undefined
  video.isShort; // boolean | undefined
  video.source; // "feed" | "api"
});
```

`isShort` is only known when the video came from the feed. Through the API it is `undefined`: check `video.source`, or handle the three cases.

For more than this, fetch the video. One `videos.list` call costs 1 unit:

```ts
const watcher = yt.watch("@GoogleDevelopers");

watcher.on("video", async ({ videoId }) => {
  const video = await yt.videos.get(videoId).catch(() => null);
  if (video) console.log(formatDuration(video.contentDetails.duration), video.statistics.viewCount);
});
```

## Without an API key

`Watcher` can be used on its own, from the feed alone. It then takes channel ids only: a handle needs the API to be resolved.

```ts
import { Watcher } from "@ix-xs/youtube.api";

const watcher = new Watcher(["UC_x5XG1OV2P6uZZ5FSM9Ttw"], { interval: "10m" });

watcher.on("video", (video) => console.log(video.title, video.url));
watcher.on("error", ({ channel, error }) => console.warn(channel, error));
watcher.start();
```

There is no API to fall back on here, so `auto` means the feed only, and an outage means `error` events until it ends. A handle, a URL or `source: "api"` throws a `YouTubeArgumentError`.

## Polling or push

Polling needs nothing but a running process, and tells you about an upload after the feed's lag plus up to one `interval`.

[Push notifications](/notifications/push-notifications/) reach you within seconds, with no polling and no quota at all. They need a public HTTPS endpoint, and subscriptions that you renew.

Use the watcher for a bot, a script or a cron job. Use push when you already run a web server and delay matters.

## Reference

### `WatcherOptions`

| Option | Default | Meaning |
| --- | --- | --- |
| `interval` | `"5m"` | Time between two rounds: milliseconds, or a string such as `"30s"`, `"5m"`, `"2h"` |
| `source` | `"auto"` | `"auto"`, `"feed"` or `"api"` |
| `since` | Creation time | Report videos published after this moment |
| `fetch` | The client's | Custom `fetch` for the feed requests |

### `Watcher`

| Member | What it does |
| --- | --- |
| `on(event, listener)` | Subscribes. Returns a function that unsubscribes |
| `once(event, listener)`, `off(event, listener)` | One occurrence only, and removal |
| `start()` | One round now, then one per interval. Returns the watcher |
| `stop()` | Stops polling |
| `check()` | Runs one round and resolves to the new videos, oldest first |
| `add(channel)`, `remove(channel)` | Changes the list. Both return the watcher |
| `channels` | The channels watched, as they were given |
| `running` | Whether the watcher is polling |
| `for await (const video of watcher)` | Starts, yields new videos, stops when the loop is left |

Calling `check()` while a round is running returns that round instead of starting a second one.

### `WatchedVideo`

| Field | Type | Notes |
| --- | --- | --- |
| `videoId` | `string` | |
| `channelId` | `string` | |
| `channelTitle` | `string` | |
| `title` | `string` | |
| `url` | `string` | From the feed, a Short links to the Shorts player |
| `publishedAt` | `string` | ISO 8601 date the video went public |
| `thumbnail` | `string \| undefined` | Largest thumbnail available |
| `isShort` | `boolean \| undefined` | Only known from the feed |
| `source` | `"feed" \| "api"` | Where the watcher learnt about it |

## See also

- [Push notifications](/notifications/push-notifications/) for delivery within seconds.
- [Feeds and oEmbed](/notifications/feeds-and-oembed/) for the feed the watcher reads.
- [A Discord upload notifier](/recipes/discord-upload-notifier/) for a complete program.
- [Quota](/basics/quota/) to see what the API fallback spends.
