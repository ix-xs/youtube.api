---
title: Caching
description: One option keeps successful reads for a few minutes, so a repeated call costs no quota and no round trip. Freshness is set per client, per method or per call, and the store can be your own.
sidebar:
  order: 5
---

```ts
const yt = new YouTube({ apiKey, cache: true });

await yt.videos.get(videoId); // 1 unit, sent to the API
await yt.videos.get(videoId); // no quota, answered from memory
```

## Turning it on

The cache is off by default. `cache: true` keeps every successful read for 5 minutes, in memory, up to 500 responses. Past that number, the least recently used one is dropped.

An object sets the details:

```ts
const yt = new YouTube({
  apiKey,
  cache: {
    ttl: "10m", // how long a response stays fresh
    max: 2000, // responses kept by the in-memory store
  },
});
```

A response is stored under the call that produced it: the request URL, which holds the method, every parameter, `fields` and `quotaUser`, and who asked. Change one parameter and it is another entry. Each page of a list is its own entry.

A call answered from the cache costs no quota and does not touch the network. The `response` event reports it with `cached: true` and a cost of 0.

## Freshness per method

Some answers change every minute, others once a year. `methods` sets the freshness of one method, or turns the cache off for it with `false`. Everything else uses `ttl`.

```ts
const yt = new YouTube({
  apiKey,
  cache: {
    ttl: "5m",
    methods: {
      "videoCategories.list": "1d", // changes rarely
      "search.list": "1h", // each call saved is one of 100 a day
      "videos.list": false, // always fresh
    },
  },
});
```

The keys are method names as the [method list](/reference/methods/) writes them. They are not checked, so a misspelled name is ignored. A helper is cached under the method it calls: `yt.videos.get` is `videos.list`, `yt.playlists.items` and `yt.channels.uploads` are `playlistItems.list`, `yt.search.videos` is `search.list`.

## One call at a time

The `cache` request option overrides the policy for a single call.

```ts
// Skip the cache: the call is sent, and its response is not stored.
const live = await yt.videos.get(videoId, { cache: false }); // 1 unit

// Keep the response of this call for an hour.
const categories = await yt.videoCategories.list(
  { part: "snippet", regionCode: "FR" },
  { cache: "1h" },
); // 1 unit
```

A duration sets how long the response stored by this call stays fresh. It does not shorten an entry that is already there and still fresh. To force a new read, use `cache: false`.

The option does nothing on a client created without `cache`.

## After a write

Writes are never cached, and they do not remove anything from the cache. A read that follows a write can return the state from before it, until the entry goes stale.

```ts
await yt.playlists.add(playlistId, videoId); // 50 units

// Read past the cache to see the new item. 1 unit per page.
const items = await yt.playlists.items(playlistId, { cache: false }).all();
```

`yt.clearCache()` empties the whole cache. It resolves once the store has cleared.

```ts
await yt.clearCache();
```

## Revalidation with ETags

A stale entry is not thrown away. When a response carries an ETag, the client keeps it with the entry. Once the entry is stale, the next call sends that ETag in `If-None-Match`:

- If nothing changed, the API answers `304 Not Modified` with no body. The entry is marked fresh again and its value is returned.
- If something changed, the API answers with the new response, which replaces the entry.

Revalidation saves the transfer, not the quota. `yt.quota` counts a `304` at the cost of the method. Only a fresh entry is free.

## Entries are kept per user

A cached response belongs to the credentials that fetched it.

- Calls made with the API key share their entries.
- Calls made with a token are stored under a digest of the user's token. Two users never share an entry, even for the same URL.
- No part of a token reaches the store. The key of an entry contains the digest and the request URL, and the API key is never in a URL.

This holds for clients made with [`yt.as()`](/auth/many-users/), which share the cache of the client they come from.

Two things follow from the digest. An `OAuth2` client with a refresh token is keyed on that token, so its entries survive each refresh. A bare `accessToken` is its own identity, and a new one starts with an empty cache. And in a runtime without the Web Crypto API, calls made with a token are not cached at all.

## Identical reads share a request

When the same read is asked several times at the same moment, one request is sent and every caller gets its answer. This works with or without the cache.

```ts
// One request, 1 unit.
const [a, b, c] = await Promise.all([
  yt.videos.get(videoId),
  yt.videos.get(videoId),
  yt.videos.get(videoId),
]);
```

"The same read" means the same URL and the same credentials. A call that carries a `signal` is never shared, so that aborting it cannot cancel someone else's request.

## What is never cached

- Writes. Only successful `GET` calls are stored.
- Errors. A failed read is retried or thrown, never stored.
- Live chat. `chat.messages()` reads past the cache, because a cached page would replay old messages as new ones.
- The upload watcher. When `yt.watch()` falls back on the API, it reads past the cache too.
- Media uploads, report downloads with `yt.reporting.download()`, and the live chat stream.

`yt.captions.download()` is a read like any other: its text is cached. Pass `cache: false` when you need the current track.

## A custom store

The built-in store lives in the memory of one process. To share the cache between processes, or to keep it across restarts, give the client a `CacheStore`. It needs two methods, `get` and `set`. `delete` and `clear` are optional. Each can be synchronous or return a promise.

A store backed by a `Map`:

```ts
import type { CacheEntry, CacheStore } from "@ix-xs/youtube.api";

class MapStore implements CacheStore {
  readonly #entries = new Map<string, CacheEntry>();

  get(key: string) {
    return this.#entries.get(key);
  }
  set(key: string, entry: CacheEntry) {
    this.#entries.set(key, entry);
  }
  delete(key: string) {
    this.#entries.delete(key);
  }
  clear() {
    this.#entries.clear();
  }
}

const yt = new YouTube({ apiKey, cache: { store: new MapStore() } });
```

A store backed by Redis:

```ts
import type { CacheEntry, CacheStore } from "@ix-xs/youtube.api";

const store: CacheStore = {
  async get(key) {
    const text: string | null = await redis.get(`yt:${key}`);
    return text ? (JSON.parse(text) as CacheEntry) : undefined;
  },
  async set(key, entry) {
    // Keep the entry a day past its freshness, so it can still be revalidated.
    const seconds = Math.ceil((entry.expires - Date.now()) / 1000) + 86_400;
    await redis.set(`yt:${key}`, JSON.stringify(entry), "EX", seconds);
  },
  async delete(key) {
    await redis.del(`yt:${key}`);
  },
};

const yt = new YouTube({ apiKey, cache: { store, ttl: "10m" } });
```

What to know when you write one:

- An entry is `{ value, etag, expires }`. `value` is the parsed response body, so it serialises as JSON. `expires` is a timestamp in milliseconds.
- The client decides whether an entry is fresh. Return entries past their `expires`: a stale entry with an ETag is what makes revalidation possible. Evict on your own terms, by count or by a longer delay.
- The client calls `get`, `set` and, from `yt.clearCache()`, `clear`. It never calls `delete`: write one for your own invalidation, or leave it out.
- `max` only applies to the built-in store. With your own store, bounding the size is your job.
- Without `clear`, `yt.clearCache()` does nothing.

`MemoryCache`, the built-in store, is exported. `new MemoryCache(max)` gives you one to share between several clients.

## When the store fails

A cache that fails never fails the call it was meant to speed up. If `get` throws, the call is sent as if nothing was cached. If `set` throws, the response is returned and not stored. Either way the failure goes to the `error` event of the client:

```ts
yt.on("error", (error) => {
  console.warn("YouTube client:", error);
});
```

## Reference

### `CacheOptions`

| Field | Type | Default | What it does |
| --- | --- | --- | --- |
| `ttl` | `Duration` | `"5m"` | How long a response stays fresh |
| `max` | `number` | `500` | Entries kept by the in-memory store before the least recently used is dropped |
| `methods` | `Record<string, Duration \| false>` | `{}` | Freshness per method. `false` turns the cache off for that method |
| `store` | `CacheStore` | An in-memory store | Custom storage |

`cache: true` is the same as `cache: {}`.

### The `cache` request option

| Value | Effect |
| --- | --- |
| `false` | The call skips the cache: nothing is read from it, nothing is stored |
| A `Duration` | The response of this call stays fresh for that long, whatever `ttl` and `methods` say |

### `CacheStore`

| Method | Signature |
| --- | --- |
| `get` | `(key: string) => CacheEntry \| undefined \| Promise<CacheEntry \| undefined>` |
| `set` | `(key: string, entry: CacheEntry) => void \| Promise<void>` |
| `delete` | `(key: string) => void \| Promise<void>`, optional |
| `clear` | Optional. `() => void \| Promise<void>` |

### `CacheEntry`

| Field | Type | What it is |
| --- | --- | --- |
| `value` | `unknown` | Parsed response body |
| `etag` | `string \| undefined` | ETag of the response, used to revalidate once the entry is stale |
| `expires` | `number` | Timestamp in milliseconds after which the entry is stale |

A `Duration` is a number of milliseconds or a string such as `"30s"`, `"5m"`, `"2h"` or `"1d"`. See [Configuration](/basics/configuration/).

## See also

- [Quota](/basics/quota/): what a call costs when it is not cached.
- [Configuration](/basics/configuration/): the other options of the client, and its events.
- [Many users](/auth/many-users/): one client, one cache, many tokens.
- [Live chat](/live/live-chat/): the reads that must stay fresh.
