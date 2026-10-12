---
title: Quota
description: YouTube gives each project a daily allowance, split into buckets. The client knows what every method costs, counts what you spend, and can refuse a call that would go over.
sidebar:
  order: 3
---

```ts
import { quotaCost } from "@ix-xs/youtube.api";

quotaCost("playlistItems.insert"); // { cost: 50, bucket: "default" }
quotaCost("search.list"); // { cost: 1, bucket: "search.list" }

yt.quota.used; // units spent today in the shared bucket
yt.quota.remaining("search.list"); // searches left today
yt.quota.resetsAt; // Date: the next midnight Pacific Time
```

## Buckets

Since June 2026 YouTube counts quota in buckets. Three methods have a bucket of their own, and every other method of the Data API shares one.

| Bucket | Charged by | Default daily allowance |
| --- | --- | --- |
| `default` | Every Data API method not listed below | 10,000 units |
| `search.list` | `yt.search.list` and the `yt.search` helpers | 100 calls |
| `videos.insert` | `yt.videos.insert`, a video upload | 100 calls |
| `videos.batchGetStats` | `yt.videos.batchGetStats` | 10,000 calls |

A call to one of the three methods costs 1 from its own bucket and nothing from `default`. A search does not draw on the units of your reads and writes, but you only get 100 of them a day.

The buckets reset at midnight Pacific Time. `yt.quota.resetsAt` is that moment as a `Date`.

The Analytics and Reporting APIs are not billed in units. The tracker counts their calls under `analytics` and `reporting` for information, with no limit.

The allowance belongs to your Google Cloud project. Every key and every OAuth client of the project draws from it, and so does every process that uses them.

## What a call costs

In the `default` bucket, the cost depends on the method, not on what it returns:

| Kind of call | Cost | Examples |
| --- | --- | --- |
| Most reads | 1 unit | `videos.list`, `channels.list`, `playlistItems.list`, `commentThreads.list` |
| Live broadcasts and streams, reads and writes | 1 unit | `liveBroadcasts.insert`, `liveBroadcasts.transition`, `liveStreams.update` |
| A page of live chat | 5 units | `liveChatMessages.list` |
| A live chat message, sent or deleted | 20 units | `liveChatMessages.insert`, `liveChatMessages.delete` |
| Most writes | 50 units | `playlists.insert`, `playlistItems.insert`, `videos.update`, `videos.rate`, `commentThreads.insert`, `thumbnails.set` |
| Live chat bans and moderators | 50 to 200 units | `liveChatModerators.list` 50, `liveChatModerators.insert` 200, `liveChatBans.insert` 200 |
| Captions | 50 to 450 units | `captions.list` 50, `captions.download` 200, `captions.insert` 400, `captions.update` 450 |

Three rules follow from that:

- Parts are free. `videos.list` costs 1 unit with one part or with ten.
- Items are free. A page of 50 costs the same as a page of 1.
- Pages are not. Each page of a list is a call and costs the method again.

[Quota costs](/reference/quota-costs/) has the cost of every method. `quotaCost()` gives the same numbers in code, and every method shows its cost in your editor.

```ts
const { cost, bucket } = quotaCost("captions.insert");
// { cost: 400, bucket: "default" }
```

## Reading the count

`yt.quota` counts what the client spends, per bucket and per method.

```ts
await yt.videos.get(videoId); // 1 unit
await yt.search.videos("lofi hip hop"); // 1 search

yt.quota.used; // 1: units spent in the default bucket
yt.quota.usage; // { default: 1, "search.list": 1 }
yt.quota.byMethod; // { "videos.list": 1, "search.list": 1 }

yt.quota.remaining(); // 9999
yt.quota.remaining("search.list"); // 99
yt.quota.canAfford(50); // true: a write still fits
yt.quota.canAfford(1, "search.list"); // true
```

The counters go back to zero on their own when the Pacific day changes.

If your project has a different allowance, tell the tracker, so that `remaining()` and `canAfford()` are right:

```ts
const yt = new YouTube({
  apiKey,
  quota: { limits: { default: 50_000, "search.list": 500 } },
});
```

## Refusing a call before it is sent

By default the tracker only counts. With `enforce: true` it refuses a call that does not fit in what is left of its bucket. The call throws a `YouTubeQuotaBudgetError`, nothing is sent, and nothing is spent.

```ts
const yt = new YouTube({
  apiKey,
  quota: { enforce: true, limits: { default: 2000 } },
});

try {
  await yt.videos.get(videoId); // 1 unit
} catch (error) {
  if (error instanceof YouTubeQuotaBudgetError) {
    const { cost, remaining, bucket, resetsAt } = error;
    console.log(`${cost} needed, ${remaining} left in "${bucket}"`);
    console.log("Budget resets at", resetsAt.toISOString());
  } else {
    throw error;
  }
}
```

`limits` is your budget here, and it can be lower than the allowance of the project. Giving one service 2,000 of the 10,000 units leaves the rest to the others.

Calls in flight are held against the budget until they finish. Ten parallel writes of 50 units with 120 units left do not all go through: two do, and eight are refused.

## When the real quota runs out

The API answers with an error, which the client throws as a `YouTubeApiError` with the code `QUOTA_EXCEEDED`. It is not retried, because retrying before the reset cannot work.

```ts
try {
  await yt.search.videos("lofi hip hop"); // 1 search call
} catch (error) {
  if (isYouTubeError(error, "QUOTA_EXCEEDED")) {
    const wait = yt.quota.resetsAt.getTime() - Date.now();
    console.log(`Out of quota for ${Math.round(wait / 60_000)} more minutes`);
  } else {
    throw error;
  }
}
```

This can happen while `yt.quota.remaining()` is still positive. See the next section.

## What the count knows

The count is local to the client. It is what this client sent, not what your project spent.

- Another process, another server or another tool using the same project is invisible to it.
- A restart sets it back to zero, unless you restore it.
- Clients made with [`yt.as()`](/auth/many-users/) share the count of the client they come from.

What is counted:

| Outcome of a call | Counted |
| --- | --- |
| Success | The cost of the method |
| Answered from the [cache](/basics/caching/) | Nothing |
| Revalidated with an ETag (a `304` answer) | The cost of the method |
| Rejected by the API with a `4xx` status | 1 unit in the method's bucket. A rejected request still costs at least 1 unit |
| `401`, or the quota error itself | Nothing |
| Server error, timeout, network failure | Nothing |
| Refused locally: missing credentials, missing scope, budget, invalid argument | Nothing. It was never sent |

## Keeping the count across restarts

`yt.quota.snapshot()` returns the usage as plain data. Store it, and give it back through the `restore` option.

```ts
const yt = new YouTube({
  apiKey,
  quota: { enforce: true, restore: await db.loadQuota() },
});

yt.on("quota", () => db.saveQuota(yt.quota.snapshot()));
```

A snapshot carries the Pacific day it belongs to. One taken on another day is ignored, so a restart after midnight Pacific Time begins at zero.

## Watching the spend

The client emits a `quota` event every time it charges something.

```ts
yt.on("quota", ({ method, bucket, cost, used, remaining }) => {
  console.log(`${method}: ${cost} from "${bucket}", ${used} used`);
  if (bucket === "default" && remaining < 500) {
    void notify("Less than 500 quota units left today");
  }
});
```

The `response` event carries the cost of each call too. [Configuration](/basics/configuration/) lists every event.

## Spending less

### Read the uploads playlist instead of searching

"The videos of this channel" is not a search. Reading the channel's uploads playlist costs 1 unit of the shared bucket for 50 videos.

```ts
// 1 search call, out of 100 a day.
const found = await yt.search.list({
  part: "snippet",
  channelId,
  type: "video",
  order: "date",
});

// 1 unit, out of 10,000 a day.
const uploads = await yt.channels.uploads(channelId).take(50);

// 2 units: the same 50, as full videos with durations and statistics.
const latest = await yt.channels.latestVideos(channelId, { limit: 50 });
```

`yt.channels.uploads(channel, { kind: "shorts" })` narrows the list to Shorts, regular videos or live streams, at the same price. [Ids, URLs and formatting](/basics/ids-and-urls/) explains the playlists behind it.

### Fetch ids in batches

One call takes 50 ids. Fetching 50 videos one by one costs 50 units, and together 1 unit.

```ts
const videos = await yt.videos.getMany(ids); // 1 unit per 50 ids
```

A search result carries a snippet and no duration or statistics. Take the ids from it and fetch the videos in one call, for 1 search and 1 unit.

### Ask for every part you need at once

Parts are free, calls are not. One call with three parts costs 1 unit. Three calls with one part each cost 3.

### Store channel ids, not handles

A handle or a username has to be resolved to a channel id, which costs 1 unit. The client remembers the answer for its lifetime. Across restarts, keep the `UC...` id in your own storage: `yt.channels.resolveId("@handle")` gives it to you.

### Cache what does not change

With `cache: true`, a read repeated within five minutes costs nothing. Lists such as `videoCategories.list` can be kept for a day. See [Caching](/basics/caching/).

### Poll statistics from their own bucket

`videos.batchGetStats` returns fresh statistics for up to 50 videos per call, and draws from its own bucket: 10,000 calls a day. A dashboard that refreshes view counts every minute then leaves the shared bucket alone.

```ts
const { items } = await yt.videos.batchGetStats({
  part: "statistics",
  id: ids,
});

for (const stat of items) console.log(stat.id, stat.statistics.viewCount);
```

### Do not poll the API for new uploads

`yt.watch()` reads the public feed of each channel, which costs no quota. It only falls back on the API, at 1 unit per channel per round, while the feed is down. A handle costs 1 unit to resolve, once. Push notifications through `websub` cost nothing either.

```ts
const watcher = yt.watch(["@GoogleDevelopers", "@YouTube"], {
  interval: "5m",
});
watcher.on("video", (video) => console.log(video.title, video.url));
watcher.start();
```

See [Watching uploads](/notifications/watching-uploads/) and [Push notifications](/notifications/push-notifications/).

### Give every walk a limit

Each page of a list costs the method again. `.take(n)` and `.all({ limit })` stop at the page that reaches the limit. This matters most for searches, where each page is one of the 100 daily calls. See [Lists](/basics/lists/).

### Slow down a live chat

Reading a live chat costs 5 units per request, every few seconds. The `minInterval` option of `chat.messages()` sets a slower pace. See [Live chat](/live/live-chat/).

## Reference

### `yt.quota`

| Member | Type | What it is |
| --- | --- | --- |
| `used` | `number` | Units spent today in the `default` bucket |
| `usage` | `Partial<Record<QuotaBucket, number>>` | Units spent today, per bucket |
| `byMethod` | `Record<string, number>` | Units spent today, per method |
| `limits` | `Record<QuotaBucket, number>` | Daily limits in effect, per bucket |
| `resetsAt` | `Date` | The next midnight Pacific Time |
| `remaining(bucket?)` | `number` | Units left today in a bucket. Default bucket: `"default"` |
| `canAfford(cost, bucket?)` | `boolean` | Whether a call of `cost` units still fits. With `enforce`, the calls in flight are counted |
| `snapshot()` | `QuotaSnapshot` | Usage as plain data, to store |
| `restore(snapshot)` | `void` | Loads a snapshot. One from another Pacific day is ignored |
| `reset()` | `void` | Clears the counters |

### The `quota` option

| Field | Type | Default | What it does |
| --- | --- | --- | --- |
| `limits` | `Partial<Record<QuotaBucket, number>>` | The allowances of the table above | Daily limits of your project, or your own budget |
| `enforce` | `boolean` | `false` | Refuses a call that would go over a limit, before it is sent |
| `restore` | `QuotaSnapshot` | None | Usage saved earlier with `yt.quota.snapshot()` |

### `YouTubeQuotaBudgetError`

Thrown only with `enforce: true`. Its `code` is `QUOTA_BUDGET_EXCEEDED`.

| Field | Type | What it is |
| --- | --- | --- |
| `bucket` | `string` | Bucket the call is charged to |
| `cost` | `number` | Units the call would have cost |
| `remaining` | `number` | Units left in the bucket, calls in flight deducted |
| `resetsAt` | `Date` | When the bucket resets |

### The `quota` event

| Field | Type | What it is |
| --- | --- | --- |
| `method` | `string` | Method that was charged, for example `videos.list` |
| `bucket` | `QuotaBucket` | Bucket it was charged to |
| `cost` | `number` | Units charged |
| `used` | `number` | Units spent today in that bucket, this charge included |
| `remaining` | `number` | Units left today in that bucket |

### Functions and constants

| Export | What it is |
| --- | --- |
| `quotaCost(method)` | `{ cost, bucket }` of a method. For the Analytics and Reporting APIs the cost is a plain call count. Throws a `YouTubeArgumentError` for an unknown name |
| `nextQuotaReset(now?)` | The next midnight Pacific Time, as a `Date` |
| `DEFAULT_QUOTA_LIMITS` | The default daily allowance of each bucket |

## See also

- [Quota costs](/reference/quota-costs/): the cost of every method.
- [Caching](/basics/caching/): reads that cost nothing.
- [Lists](/basics/lists/): how pages are fetched, and how to bound them.
- [Errors](/basics/errors/): `QUOTA_EXCEEDED` and `QUOTA_BUDGET_EXCEEDED`.
