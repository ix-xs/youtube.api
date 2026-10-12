---
title: FAQ
description: Short answers to the questions that come up before and after installing the library, each with a link to the page that covers the subject.
---

## Is it official?

No. `@ix-xs/youtube.api` is an independent open-source project under the MIT license. It is not affiliated with YouTube or Google.

It calls the official APIs and nothing else, so the rules of those APIs apply to you: using them means accepting the [YouTube API Services Terms of Service](https://developers.google.com/youtube/terms/api-services-terms-of-service).

## Does it work without an API key?

Only the parts that do not call the API:

| What | Functions |
| --- | --- |
| Public feeds of a channel or a playlist | `fetchFeed`, `parseFeed`, `feedUrl`, and a `Watcher` built from channel ids |
| oEmbed | `oEmbed` |
| Push notifications | `websub` |
| URLs and ids | `parseUrl`, `videoIdFrom`, `playlistIdFrom`, `parseChannelRef`, `channelPlaylistId`, `urls` |
| Formatting | `parseDuration`, `formatDuration`, `formatCount`, `bestThumbnail` |

```ts
const info = await oEmbed("https://youtu.be/dQw4w9WgXcQ"); // no key, no quota
console.log(info?.title, info?.authorName);
```

Everything on the client, `yt.videos`, `yt.channels` and the rest, needs an API key or OAuth. [Quick start](/start/quick-start/) shows how to create a key. [Feeds and oEmbed](/notifications/feeds-and-oembed/) covers what works without one.

## Do I still need an API key when I use OAuth?

No, and it helps to have one. A token is enough for every call. With a key next to it, public reads keep working in two cases where the token cannot serve: before the user has signed in, and when the token lacks a scope the method accepts. Reads that concern the user, and every write, always use the token.

```ts
const yt = new YouTube({ apiKey, oauth });
```

When `apiKey` is left out, the client reads the `YOUTUBE_API_KEY` environment variable. It does so next to `oauth` and `accessToken` as well, so setting the variable has the same effect as the line above.

## Can it download videos or read other people's captions?

No. The YouTube API offers no way to download videos or to read the captions of other people's videos, and this library only wraps the official API.

`yt.captions.download` exists, with OAuth, for 200 units. It is for the caption tracks of your own videos. See [Captions](/resources/captions/).

## How is it different from `googleapis`?

`googleapis` is Google's own Node.js client. It covers many Google APIs, YouTube among them. If your application already uses it for other Google services, one client for everything is a good reason to stay with it.

This library covers the YouTube APIs only. What it offers:

- **No dependency, and no Node.js module in the main entry.** It runs wherever `fetch` exists. See [Runtimes](/reference/runtimes/).
- **Results narrowed by `part`.** The type of a result has the parts you asked for and no others. See [Parts and types](/basics/parts-and-types/).
- **Lists you can iterate.** Every `list` can be awaited for a page or walked with `for await`. The helpers that return a list ask for full pages, 50 items or 100 for comments. A raw `list` method awaited without `maxResults` gets the API default, 5 for most methods. See [Lists](/basics/lists/).
- **Quota tracking.** The client knows the cost of each method and counts what it spends. See [Quota](/basics/quota/).
- **Handles and URLs as input.** The helpers take `"@handle"`, a URL or an id. See [IDs and URLs](/basics/ids-and-urls/).

## Is the method list complete?

It follows Google's discovery documents: 82 methods of the Data API v3, live streaming included, 8 of the Analytics API and 8 of the Reporting API.

The methods, their parameters and the resource types are generated from those documents, which are pinned in the repository. The generator stops with an error while a method of the documents has no entry. Once a week, a CI job compares the pinned documents with what Google serves and fails when they differ, which is the cue to update.

[Every method](/reference/methods/) lists them all.

## How do I get more quota?

Ask Google. The library counts a new project at 10,000 units a day, plus 100 searches and 100 uploads in buckets of their own. Quota extensions go through the [YouTube API Services audit and quota extension form](https://support.google.com/youtube/contact/yt_api_form). The same form is how you request the audit that lifts the private lock on videos uploaded through an unverified project.

Once your allocation changes, tell the client, so that `yt.quota.remaining()` and `quota.enforce` use the right numbers:

```ts
const yt = new YouTube({ apiKey, quota: { limits: { default: 50_000 } } });
```

Before asking, check that you need it: [Quota](/basics/quota/) has the ways to spend less.

## Why are counts strings?

Because the API sends them as strings. View counts, like counts and subscriber counts are 64-bit integers, and a JSON number cannot carry every 64-bit value exactly. The library keeps what the API sent instead of rounding it silently.

```ts
const video = await yt.videos.get(videoId);

if (video) {
  Number(video.statistics.viewCount); // for arithmetic
  formatCount(video.statistics.viewCount); // "1.2M", for display
}
```

Fields that are not 64-bit integers are numbers: `likeCount` on a comment, `itemCount` on a playlist. So are the metrics of [Analytics](/analytics/analytics/) reports.

## Why is a field optional?

Because YouTube does not return it for every resource. `tags`, `likeCount` on a video and `subscriberCount` on a channel are examples, and so are the thumbnails of a deleted video inside a playlist.

Google's own API description marks nothing as required, so every field would be optional if the types followed it blindly. The library keeps a list of the fields the API returns on every resource, private or deleted ones included, and only those are required in the types. A test that calls the real API checks the list against what YouTube returns. A field left optional is one you have to handle.

The same goes for whole parts: `liveStreamingDetails` stays optional even when you request it, because a video that was never live has none. [Parts and types](/basics/parts-and-types/) has the rules.

## Can I use it in the browser?

Yes. The main entry uses standard web APIs only. Two things change: an API key in a page is visible to every visitor, so restrict it by HTTP referrer, and a client secret must never be shipped. Uploads take a `File`.

[Runtimes](/reference/runtimes/#browsers) covers browsers, Bun, Deno and edge runtimes.

## CommonJS or ESM?

Both. The package ships a build and type declarations for each, and Node.js picks the right one from how you load it.

```ts
import { YouTube } from "@ix-xs/youtube.api";
```

```js
const { YouTube } = require("@ix-xs/youtube.api");
```

## Does it retry?

Yes, when a retry can help and cannot do harm. Rate limits are retried for any call. Server errors, timeouts and network failures are retried for reads only, because a write may have gone through. There are 3 retries by default, with a delay that doubles from 500 ms up to 30 seconds. A `Retry-After` from the API is used as the delay. When it is longer than `retry.maxDelay`, 30 seconds by default, the call is not retried: the error is thrown with its `retryAfter`.

`retry` and `timeout` are options of the client and of each call. See [Errors](/basics/errors/).

## How do I log requests?

Subscribe to the client's events. URLs in the payloads have credentials removed, so they are safe to print.

```ts
yt.on("request", ({ method, verb, url, attempt }) => {
  console.log(verb, method, url, `attempt ${attempt}`);
});
yt.on("response", ({ method, status, duration, cached, cost }) => {
  const spent = cached ? "from cache" : `${cost} units`;
  console.log(method, status, `${duration} ms`, spent);
});
yt.on("retry", ({ method, attempt, delay }) => {
  console.warn(`${method}: retry ${attempt} in ${delay} ms`);
});
```

There is also a `quota` event, an `error` event for a listener or a cache store that failed, and a `fetch` option when you want to see or change the raw requests. See [Configuration](/basics/configuration/).

## Where do I report a bug?

On [GitHub issues](https://github.com/ix-xs/youtube.api/issues). Include the version of the package, the runtime, the call, and the `code`, `reason` and `message` of the error. Remove keys and tokens first: `error.url` is already cleaned, your own logs may not be.

For a security problem, do not open a public issue. Use the repository's [private advisory form](https://github.com/ix-xs/youtube.api/security/advisories/new).

[Troubleshooting](/help/troubleshooting/) may have the answer before you need to ask.

## See also

- [Troubleshooting](/help/troubleshooting/) for failures, by symptom.
- [Quick start](/start/quick-start/) to install the package and make a first call.
- [Every method](/reference/methods/) for the whole API on one page.
- [Migrating from v1](/start/migrating-from-v1/) if you come from version 1.
