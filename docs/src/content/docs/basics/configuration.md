---
title: Configuration
description: The options of the client, the options every call accepts, and the events that tell you what the client is doing.
sidebar:
  order: 6
---

```ts
import { YouTube } from "@ix-xs/youtube.api";

const yt = new YouTube({
  apiKey: process.env.YOUTUBE_API_KEY,
  cache: { ttl: "10m" },
  quota: { enforce: true },
  retry: { attempts: 5 },
  timeout: "15s",
});

yt.on("response", ({ method, duration, cost, cached }) => {
  console.log(method, `${duration} ms`, cached ? "cached" : `${cost} units`);
});
```

## Options of the client

Every field is optional. `new YouTube()` with no argument reads the `YOUTUBE_API_KEY` environment variable, and `new YouTube("key")` is a shorthand for `{ apiKey: "key" }`.

| Option | Type | Default | What it does |
| --- | --- | --- | --- |
| `apiKey` | `string` | The `YOUTUBE_API_KEY` environment variable | API key, enough to read public data |
| `oauth` | `OAuth2 \| OAuth2Options` | None | OAuth 2.0 client that keeps tokens fresh, or the options to build one |
| `accessToken` | `string \| (() => string \| Promise<string>)` | None | A ready-made access token, or a function that returns one. No automatic refresh |
| `cache` | `boolean \| CacheOptions` | Off | Caches successful reads. `true` keeps them 5 minutes in memory |
| `quota` | `QuotaOptions` | Default limits, not enforced | Daily limits, optional enforcement and restored usage |
| `retry` | `RetryOptions \| false` | 3 retries, from `"500ms"`, doubling up to `"30s"` | Retries on rate limits, server errors and network failures. `false` turns them off |
| `timeout` | `Duration` | `"30s"` | Time allowed for one attempt. `0` turns it off. Uploads, report downloads and the live chat stream are not subject to it |
| `fetch` | `typeof fetch` | The global `fetch` | Custom `fetch`, for a proxy, an instrumented client or tests |
| `baseUrl` | `string` | `https://youtube.googleapis.com/` | Root of the Data API, to go through a proxy |
| `headers` | `Record<string, string>` | None | Headers added to every request |
| `quotaUser` | `string` | None | Per-user quota key sent with every request |
| `onBehalfOfContentOwner` | `string` | None | For content partners: the content owner requests are made for, on every method that takes the parameter |

Each group has its own page: [Credentials](/start/credentials/) for the first three, [Caching](/basics/caching/), [Quota](/basics/quota/), and [Errors](/basics/errors/) for `retry` and `timeout`.

## Options of one call

Every API call takes request options as its last argument. They apply to that call only and win over the client's.

```ts
const { signal } = new AbortController();

// Raw methods: after the parameters. 1 unit.
await yt.videos.list(
  { part: "snippet", id: videoId },
  { timeout: "5s", retry: false },
);

// Most helpers: in the same object as their own options. 1 unit, then 50.
await yt.videos.get(videoId, { part: "statistics", cache: false });
await yt.playlists.add(playlistId, videoId, { position: 0, signal });
```

| Option | Type | What it does |
| --- | --- | --- |
| `signal` | `AbortSignal` | Cancels the call. It then throws with the code `ABORTED` |
| `timeout` | `Duration` | Overrides the client's timeout |
| `retry` | `RetryOptions \| false` | Overrides the client's retry policy, field by field. `false` turns retries off |
| `fields` | `string` | Partial response selector: only the listed fields come back. Example: `"items(id,snippet/title),nextPageToken"` |
| `cache` | `Duration \| false` | `false` skips the cache, a duration overrides the freshness |
| `quotaUser` | `string` | Per-user quota key, at most 40 characters |
| `accessToken` | `string` | Uses this access token instead of the client's credentials |
| `headers` | `Record<string, string>` | Extra headers, merged over the client's |

On a list, the options apply to every page the request fetches.

## Durations

Wherever the library takes a length of time, it takes a `Duration`: a number of milliseconds, or a number followed by a unit.

| Unit | Meaning | Example |
| --- | --- | --- |
| `ms` | Milliseconds | `"500ms"` |
| `s` | Seconds | `"30s"` |
| `m` | Minutes | `"5m"` |
| `h` | Hours | `"2h"` |
| `d` | Days | `"1d"` |

```ts
const yt = new YouTube({
  apiKey,
  timeout: 10_000, // a number is milliseconds
  retry: { delay: "1s", maxDelay: "1m" },
  cache: { ttl: "1.5h" }, // decimals work
});

// @ts-expect-error "5 minutes" is not a Duration
new YouTube({ apiKey, timeout: "5 minutes" });
```

The type checks the format. A string built at runtime that does not match throws a `YouTubeArgumentError`, and so does a negative number.

## Events

The client emits an event at each step of a call. `yt.on(event, listener)` subscribes and returns a function that unsubscribes. `yt.once` listens for a single occurrence, and `yt.off(event, listener)` removes a listener.

| Event | Fires when | Payload |
| --- | --- | --- |
| `request` | A request is about to be sent. Once per attempt | `{ method, verb, url, attempt }` |
| `response` | A call finished successfully | `{ method, status, duration, cached, cost, bucket }` |
| `retry` | A failed attempt will be retried | `{ method, attempt, delay, error }` |
| `quota` | Quota was charged | `{ method, bucket, cost, used, remaining }` |
| `error` | A listener threw, or the cache store failed | The error |

What the fields hold:

- `method` is the method name, such as `videos.list`. `verb` is the HTTP verb.
- `url` has credentials removed, so it is safe to log.
- `attempt` starts at 0 in `request`. In `retry` it is the number of the retry, starting at 1.
- `duration` and `delay` are in milliseconds.
- A call answered from the cache fires `response` with `cached: true`, a `duration` of 0 and a `cost` of 0. It fires no `request` and no `quota`.

A logger for everything:

```ts
yt.on("request", ({ verb, method, url, attempt }) => {
  const again = attempt ? ` (attempt ${attempt + 1})` : "";
  console.debug(`-> ${verb} ${method}${again} ${url}`);
});

yt.on("response", ({ method, status, duration, cached, cost, bucket }) => {
  const spent = cached ? "cached" : `${cost} from ${bucket}`;
  console.info(`<- ${method} ${status} in ${duration} ms, ${spent}`);
});

yt.on("retry", ({ method, attempt, delay, error }) => {
  console.warn(`${method}: retry ${attempt} in ${delay} ms`, error.message);
});

const stop = yt.on("quota", ({ bucket, remaining }) => {
  if (remaining === 0) console.error(`The "${bucket}" bucket is empty`);
});

stop(); // unsubscribes the last one
```

A listener that throws, or whose promise rejects, does not break the call that triggered it. The failure goes to the `error` event if someone listens to it, and is dropped otherwise.

Failed calls have no event of their own. They throw, and you catch them where you made the call.

## Calling a method by name

The typed resources, `yt.videos.list(...)`, are the normal way to call the API. `yt.request()` is for the rare case where the method is chosen at runtime.

```ts
import type { MethodId, VideoListResponse } from "@ix-xs/youtube.api";

const response = await yt.request<VideoListResponse>("videos.list", {
  part: "id",
  chart: "mostPopular",
}); // 1 unit

function call(method: MethodId, params: Record<string, unknown>) {
  const { cost, bucket } = quotaCost(method);
  console.log(`${method}: ${cost} from "${bucket}"`);
  return yt.request(method, params);
}
```

The method name is checked against `MethodId`. The rest is up to you:

- Parameters are not type-checked, and the result is `unknown` unless you name its type.
- You get the response body as the API sent it. There is no `ListRequest`: no page walking, and a list of ids is not split.
- A write needs its `part`. The typed methods fill it in from the body, `yt.request()` does not.

Credentials, quota counting, cache, retries and events work as for any other call. Path parameters, query parameters, `body` and `media` all go in the one `params` object. `METHODS` is the table of every method, with its verb, path, cost and scopes.

## Acting for another user

`yt.as(credentials)` returns a client that sends its calls with another access token or `OAuth2` client. It shares the cache, the quota count, the events and the settings of the client it comes from, so a server creates one `YouTube` at startup and derives one per request. A second argument overrides `quotaUser`, `headers` or `onBehalfOfContentOwner` for that user. [Many users](/auth/many-users/) shows the whole pattern.

```ts
// In a request handler of your server:
const user = yt.as(session.accessToken);
const channel = await user.channels.mine(); // 1 unit
```

## A custom fetch

The `fetch` option replaces the function that sends every request. Use it to measure, to route through an agent, or to answer from fixtures in tests.

```ts
const yt = new YouTube({
  apiKey,
  fetch: async (input, init) => {
    const started = Date.now();
    const response = await fetch(input, init);
    console.log(response.status, `${Date.now() - started} ms`);
    return response;
  },
});
```

In a test, answer without any network:

```ts
const yt = new YouTube({
  apiKey: "test",
  retry: false,
  fetch: async () =>
    new Response(JSON.stringify({ items: [] }), {
      headers: { "content-type": "application/json" },
    }),
});

const video = await yt.videos.get("dQw4w9WgXcQ"); // null
```

The same function is used for API calls, for uploads, for the token requests of an `OAuth2` client built from the `oauth` options, and for the feed requests of `yt.watch()`. An `OAuth2` instance you create yourself has its own `fetch` option.

Without the option, the global `fetch` is used. If there is none, the constructor throws a `YouTubeArgumentError`.

## Going through a proxy

`baseUrl` replaces the root of the Data API. The path of each method, `youtube/v3/videos` for instance, is appended to it.

```ts
const yt = new YouTube({
  apiKey,
  baseUrl: "https://youtube-proxy.example.com/",
});
```

Three things to know:

- Only the Data API moves, uploads included. The Analytics and Reporting APIs keep their own hosts.
- The proxy receives the credentials: the API key in `X-Goog-Api-Key`, or the access token in `Authorization`. Point `baseUrl` only at a host you control.
- `headers` is the place for what your proxy needs, such as its own authentication. The client sets the credential header it uses, `authorization` or `x-goog-api-key`, after your headers, so you cannot replace that one.

## Content owners

`onBehalfOfContentOwner` is for YouTube content partners. The client adds it to every call of a method that takes the parameter and does not set it itself, in the Data, Analytics and Reporting APIs alike. Methods that do not take it, such as `analytics.query` (which names the owner in `ids`), are left alone.

```ts
const yt = new YouTube({ oauth, onBehalfOfContentOwner: "CONTENT_OWNER_ID" });
```

A call that carries it needs OAuth, public reads such as `videos.list` included: with an API key alone it is refused with `MISSING_CREDENTIALS`.

## Reference

The tables of `YouTubeOptions`, `RequestOptions` and `ClientEvents` are in the sections above. `RetryOptions` is on the [Errors](/basics/errors/) page, `CacheOptions` on [Caching](/basics/caching/) and `QuotaOptions` on [Quota](/basics/quota/).

### Members of the client

| Member | What it is |
| --- | --- |
| `yt.quota` | Quota spent by this client, per bucket and per method |
| `yt.oauth` | The `OAuth2` client, when the client was created with one |
| `yt.on(event, listener)` | Subscribes to an event. Returns a function that unsubscribes |
| `yt.once(event, listener)` | Like `on`, for a single occurrence |
| `yt.off(event, listener)` | Removes a listener |
| `yt.as(credentials, overrides?)` | A client that acts for another user and shares cache, quota count, events and settings |
| `yt.request(method, params?, options?)` | Calls a method by name |
| `yt.clearCache()` | Empties the response cache |
| `yt.liveChat(liveChatId)`, `yt.liveChatOf(video)` | A live chat, see [Live chat](/live/live-chat/) |
| `yt.watch(channels, options?)` | A watcher for new uploads, see [Watching uploads](/notifications/watching-uploads/) |

The client also has one property per resource, such as `yt.videos` and `yt.channels`. [Every method](/reference/methods/) lists them.

### Event payloads

| Event | Field | Type |
| --- | --- | --- |
| `request` | `method`, `verb`, `url` | `string` |
| | `attempt` | `number` |
| `response` | `method` | `string` |
| | `status`, `duration`, `cost` | `number` |
| | `cached` | `boolean` |
| | `bucket` | `QuotaBucket` |
| `retry` | `method` | `string` |
| | `attempt`, `delay` | `number` |
| | `error` | `Error` |
| `quota` | `method` | `string` |
| | `bucket` | `QuotaBucket` |
| | `cost`, `used`, `remaining` | `number` |
| `error` | The payload itself | `unknown` |

The types are exported as `YouTubeOptions`, `RequestOptions`, `RetryOptions`, `ClientEvents`, `QuotaEvent` and `Duration`.

## See also

- [Credentials](/start/credentials/): `apiKey`, `oauth` and `accessToken` in detail.
- [Errors](/basics/errors/): what `retry`, `timeout` and `signal` do when a call fails.
- [Caching](/basics/caching/) and [Quota](/basics/quota/): the two options with a page of their own.
- [Runtimes](/reference/runtimes/): what the library needs from each platform.
