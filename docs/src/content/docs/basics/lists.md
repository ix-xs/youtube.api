---
title: Lists
description: Every list method returns a request you can await for one page, iterate to the end, or collect into an array. Nothing is sent until you do one of the three.
sidebar:
  order: 2
---

```ts
const request = yt.playlistItems.list({ part: "snippet", playlistId });

// One page.
const page = await request;
console.log(page.items.length, page.nextPageToken);

// Every item, fetched page by page as the loop advances.
for await (const item of request) {
  console.log(item.snippet.title);
}

// A bounded array.
const firstHundred = await request.take(100);
```

## What a list method returns

Every `list` method, and every helper that returns a list (`yt.playlists.items`, `yt.channels.uploads`, `yt.search.videos`, `yt.commentThreads.forVideo`...), returns a `ListRequest`. It is a description of a call, not a call in progress:

- Nothing is sent when you create it. Creating a request costs no quota.
- `await` sends it and resolves to the first `Page`.
- `for await` sends it and walks every item of every page.
- `.all()`, `.take(n)`, `.first()` and `.pages()` are the other ways to consume it.

A request can be consumed more than once. Each time sends it again and costs quota again.

## One page

Await the request. You get a `Page`: the items, and what the API said about the rest.

```ts
const page = await yt.search.videos("lofi hip hop");

page.items; // the results of this page
page.nextPageToken; // string | undefined
page.totalResults; // number | undefined
page.hasNext; // whether another page follows
```

A page is iterable, and it destructures like the raw response:

```ts
const { items } = await yt.videos.list({ part: "snippet", chart: "mostPopular" });

for (const video of await yt.videos.list({ part: "snippet", chart: "mostPopular" })) {
  console.log(video.snippet.title);
}
```

An awaited request is sent as you wrote it. Without `maxResults`, the API's own default page size applies.

`totalResults` is the size of the whole result set as the API reports it. For a search it is an estimate, and it is capped at 1,000,000. Do not use it to decide how many pages to fetch: walk until there is no next page.

## Every item

Iterate the request. Pages are fetched one at a time, when the loop needs the next one.

```ts
for await (const thread of yt.commentThreads.forVideo(videoId)) {
  console.log(thread.snippet.topLevelComment.snippet?.textDisplay);
}
```

Leaving the loop with `break` or `return` stops the fetching. A page that was not needed is never requested.

While walking, the request uses the largest page size the method allows, because that is the cheapest in quota: 50 for most methods, 100 for comments. If you set `maxResults` yourself, your value is used.

## A bounded array

`.all()` collects every item into an array. `.all({ limit })` stops once it has that many, and `.take(n)` is a shorthand for it.

```ts
const everything = await yt.playlists.items(playlistId).all();
const firstHundred = await yt.playlists.items(playlistId).all({ limit: 100 });
const sameThing = await yt.playlists.items(playlistId).take(100);
```

The page size follows the limit. `.take(10)` asks for one page of 10 items, `.take(120)` asks for three pages of 50 and keeps 120 items.

Prefer a limit to a bare `.all()` on anything you do not own. A playlist can hold thousands of items and a popular video millions of comments.

## The first item

`.first()` resolves to the first item, or to `undefined` when there is none. It asks the API for a single item when the method allows it.

```ts
const video = await yt.videos.list({ part: ["snippet", "liveStreamingDetails"], id: videoId }).first();

const newest = await yt.channels.uploads("@GoogleDevelopers").first();
```

The helpers named `get` are built on it and resolve to `null` instead of `undefined`: `yt.videos.get`, `yt.channels.get`, `yt.playlists.get`.

## Page by page

`.pages()` walks whole pages instead of items. Use it when you work in batches:

```ts
for await (const page of yt.playlists.items(playlistId).pages()) {
  const ids = page.items.map((item) => item.contentDetails.videoId);
  await db.saveVideoIds(ids);
}
```

`.pages({ limit })` stops after the page that reaches the limit. It yields whole pages, so the last one can go past it.

From a page, `page.next()` fetches the one after it. It resolves to `null` on the last page.

```ts
const first = await yt.commentThreads.list({ part: "snippet", videoId, maxResults: 100 });
const second = await first.next();

if (second) console.log(second.items.length);
```

When the pages are requested by someone else, a browser for instance, pass the token yourself. Send `page.nextPageToken` to the client and take it back as `pageToken`:

```ts
const page = await yt.playlistItems.list({ part: "snippet", playlistId, maxResults: 25 });
const pageToken = page.nextPageToken;

// Later, in another request of your server:
const next = await yt.playlistItems.list({ part: "snippet", playlistId, maxResults: 25, pageToken });
```

## More than 50 ids

The API accepts at most 50 ids in one call. The library accepts any number: a longer list is split into calls of 50, and duplicates are removed.

```ts
const { items } = await yt.videos.list({ part: "statistics", id: ids });
```

How the calls are made depends on how you consume the request:

| You write | What happens |
| --- | --- |
| `await request` | The calls run in parallel, four at a time. Their items are merged into one page |
| `for await`, `.all()`, `.take()`, `.pages()` | One call per 50 ids, made when the loop reaches it |

Each call costs the method's quota: 300 video ids are 6 calls to `videos.list`, 6 units.

On a merged page there is no next page, `raw` is the response of the first call, and `totalResults` is the number of items merged.

`yt.videos.getMany(ids)` is the helper for videos. It accepts URLs as well as ids, and returns the videos in the order you gave. Videos that do not exist or are private are left out, so the result can be shorter than the list.

Methods that split their `id` list: `captions.list`, `channels.list`, `channelSections.list`, `comments.list`, `commentThreads.list`, `liveBroadcasts.list`, `liveStreams.list`, `playlistItems.list`, `playlists.list`, `subscriptions.list`, `videoCategories.list`, `videos.list`, `videos.getRating` and `videos.batchGetStats`.

## The raw response

`page.raw` is the response body as the API sent it, fully typed. Use it for the fields that are not items or page tokens:

```ts
const page = await yt.liveChatMessages.list({ part: ["snippet", "authorDetails"], liveChatId });

page.raw.pollingIntervalMillis; // how long YouTube asks you to wait before the next call
page.raw.offlineAt; // set once the broadcast has ended
```

That call costs 5 units. [Live chat](/live/live-chat/) wraps this loop for you.

## Passing a request around

A `ListRequest` behaves like a promise when awaited. That has one consequence worth knowing: an `async` function awaits what it returns, so it resolves to the first page, not to the request.

```ts
// Returns the request. The caller chooses how to consume it.
function itemsOf(playlist: string) {
  return yt.playlists.items(playlist);
}

// Returns a promise of the first page.
async function firstPageOf(playlist: string) {
  return yt.playlists.items(playlist);
}

const all = await itemsOf(playlistId).all();
const page = await firstPageOf(playlistId);
// @ts-expect-error a Page has no all(): the request was already awaited
page.all();
```

Request options go in the last argument of the list method and apply to every page:

```ts
const controller = new AbortController();

for await (const item of yt.playlists.items(playlistId, { signal: controller.signal, timeout: "10s" })) {
  console.log(item.snippet.title);
}
```

## What it costs

Each page is a call, and each call costs the method's quota again. Quota is counted per call, not per item, which is why the largest page size is the cheapest.

| Walking | Page size | Cost |
| --- | --- | --- |
| `yt.playlists.items(id)`, `yt.channels.uploads(channel)` | 50 | 1 unit per page |
| `yt.commentThreads.forVideo(video)` | 100 | 1 unit per page |
| `yt.videos.list({ id: [...] })` | 50 ids | 1 unit per call |
| `yt.search.videos(query)` | 50 | 1 call of the search bucket per page |

:::caution
Search has a bucket of 100 calls a day. A `for await` over a search with many results can use all of it in one loop. Give searches a limit: `yt.search.videos(query).take(50)` is one call.
:::

[Quota](/basics/quota/#buckets) explains the buckets.

## Reference

### `ListRequest<T>`

| Member | Returns | What it does |
| --- | --- | --- |
| `await request` | `Page<T>` | Fetches the first page. With more than 50 ids, fetches every chunk in parallel and merges them |
| `for await (const item of request)` | `T` | Walks every item of every page |
| `.page()` | `Promise<Page<T>>` | What `await` does, as a method |
| `.pages({ limit? })` | `AsyncGenerator<Page<T>>` | Walks the pages one by one |
| `.all({ limit? })` | `Promise<T[]>` | Collects items across pages |
| `.take(n)` | `Promise<T[]>` | Shorthand for `.all({ limit: n })` |
| `.first()` | `Promise<T \| undefined>` | The first item |

### `Page<T>`

| Member | Type | What it is |
| --- | --- | --- |
| `items` | `T[]` | Items of this page |
| `nextPageToken` | `string \| undefined` | Token of the next page, when there is one |
| `prevPageToken` | `string \| undefined` | Token of the previous page, when the API provides it |
| `totalResults` | `number \| undefined` | Size of the whole result set as reported by the API. An estimate for searches |
| `resultsPerPage` | `number \| undefined` | Items the API put in a full page |
| `raw` | The response type | The response body as the API sent it |
| `hasNext` | `boolean` | Whether another page follows |
| `next()` | `Promise<Page<T> \| null>` | Fetches the next page, `null` on the last one |

A page is also iterable: `for (const item of page)`.

### Largest page sizes

| Page size | Methods |
| --- | --- |
| 50 | `activities.list`, `channels.list`, `liveBroadcasts.list`, `liveChatModerators.list`, `liveStreams.list`, `playlistImages.list`, `playlistItems.list`, `playlists.list`, `search.list`, `subscriptions.list`, `superChatEvents.list`, `videos.list` |
| 100 | `comments.list`, `commentThreads.list` |
| 1,000 | `members.list` |
| 2,000 | `liveChatMessages.list` |

For the other list methods the library sets no page size.

## See also

- [Parts and types](/basics/parts-and-types/): what each item contains.
- [Quota](/basics/quota/): what a page costs and how to spend less.
- [Playlists](/resources/playlists/) and [Comments](/resources/comments/): the lists you will walk most.
- [Playlist length](/recipes/playlist-length/): a whole playlist walked in a few lines.
