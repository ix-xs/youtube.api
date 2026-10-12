# Changelog

All notable changes to `@ix-xs/youtube.api` are documented here. This project
adheres to [Semantic Versioning](https://semver.org).

## 2.0.0

A rewrite from the ground up. Version 1 had four methods for reading a channel
and its latest video; version 2 is a complete client for the YouTube APIs,
written in TypeScript.

### Breaking changes

- The package exports a named `YouTube` class instead of a default class.
  `new YoutubeAPI({ apiKey })` becomes `new YouTube({ apiKey })`.
- Methods return the data itself and throw a `YouTubeApiError` on failure,
  instead of resolving to `{ ok, status, statusText, data }`.
- `getChannelByUsername` and `getChannelById` are replaced by
  `yt.channels.get()`, which takes an id, a handle, a username or a URL.
- `getLastVideoByUsername` and `getLastVideoByChannelId` are replaced by
  `yt.channels.latestVideo()`, which returns a full video resource rather
  than a playlist item snippet.
- Node.js 20 or newer is required.
- The license is now MIT (it was ISC).

### Added

- **Every method of the YouTube Data API v3**, 82 of them, live streaming
  included, plus the 8 methods of the Analytics API and the 8 of the Reporting
  API. Types, parameters and method classes are generated from Google's
  discovery documents, pinned in the repository.
- **Results typed by `part`.** `yt.videos.list({ part: ["snippet"] })` returns
  videos whose `snippet` is there and typed, and on which reading
  `statistics` is a compile error.
- **Lazy lists.** Every `list` method can be awaited for one page, iterated
  with `for await` across pages, or collected with `.all({ limit })`,
  `.take(n)` and `.first()`.
- **Long id lists.** More than 50 ids are split across calls and merged.
- **Helpers that accept ids, handles and URLs**: `channels.get`,
  `channels.mine`, `channels.resolveId`, `channels.uploads`,
  `channels.latestVideos`, `videos.get`, `videos.getMany`, `videos.popular`,
  `videos.like`, `playlists.get`, `playlists.items`, `playlists.videos`,
  `playlists.create`, `playlists.add`, `playlists.removeVideo`,
  `search.videos`, `search.channels`, `search.playlists`, `search.live`,
  `commentThreads.forVideo`, `commentThreads.post`, `comments.replies`,
  `comments.reply`, `subscriptions.subscribe`, `subscriptions.unsubscribe`.
- **Quota tracking** per bucket and per method, following the granular
  buckets YouTube introduced in June 2026, with optional enforcement before a
  call is sent, snapshots, and `quotaCost()`.
- **OAuth 2.0**: consent URL with PKCE, code exchange, automatic refresh, a
  retry after a 401, revocation, token inspection and the device flow.
  `authorize()` in `@ix-xs/youtube.api/node` runs the whole consent flow
  locally for scripts.
- **Checks before sending.** A call that needs OAuth, or a scope the token
  does not have, fails locally with the list of accepted scopes and spends no
  quota.
- **Uploads**: videos, thumbnails, captions, channel banners, playlist images
  and watermarks. One request for small files, a resumable session with
  chunking, progress, retries and resume for the rest. Accepts a Blob, bytes,
  a stream or text; `fileMedia()` reads a file from disk without loading it
  in memory.
- **Live chat**: `yt.liveChat()` and `yt.liveChatOf(video)` to read messages
  as an async iterator, send, delete, ban and manage moderators.
- **Upload notifications without quota**: `yt.watch()` polls the public feed
  and falls back on the API when the feed is down; `websub` subscribes to
  push notifications and verifies, parses and answers the hub's requests.
- **Analytics** with `yt.analytics.query()`: typed metrics and dimensions,
  rows as objects, filters as an object.
- **Reporting**: jobs, report types, reports, and `yt.reporting.download()`.
- **Response cache** with freshness per method, ETag revalidation, and a
  store interface for Redis or anything else. Identical concurrent reads
  share one request.
- **Retries** with exponential backoff and jitter on rate limits, server
  errors and network failures, honouring `Retry-After`. Writes are only
  replayed when the API guarantees they were not applied.
- **Typed errors** with a stable `code`, the API's `reason`, and credentials
  removed from URLs.
- **Utilities**: `parseUrl`, `videoIdFrom`, `playlistIdFrom`,
  `parseChannelRef`, `channelPlaylistId`, `urls`, `parseDuration`,
  `formatDuration`, `formatCount`, `bestThumbnail`, `oEmbed`, `fetchFeed`,
  `VideoCategories`, `Scopes`.
- **Events** on the client: `request`, `response`, `retry`, `quota`.
- `yt.as(token)` to act for another user while sharing cache and quota.
- ES module and CommonJS builds with their own type declarations. No runtime
  dependency.

## 1.0.1

- Fixed the README.

## 1.0.0

- First release: `getChannelByUsername`, `getChannelById`,
  `getLastVideoByUsername`, `getLastVideoByChannelId`.
