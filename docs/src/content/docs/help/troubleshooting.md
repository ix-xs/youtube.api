---
title: Troubleshooting
description: The failures people meet first, by symptom. Each entry gives the cause and the fix.
---

```ts
try {
  await yt.videos.get(videoId);
} catch (error) {
  if (error instanceof YouTubeApiError) console.error(error.code, error.status, error.reason, error.message);
  else if (isYouTubeError(error)) console.error(error.code, error.message);
  throw error;
}
```

Start there. The `code` and the `reason` are what the entries below are keyed on. [Error codes](/reference/errors/) lists all of them.

## Credentials

### "API key not valid. Please pass a valid API key."

`error.reason` is `keyInvalid`.

**Cause.** The string sent as the key is not a key of any project: a truncated copy, quotes or a space around it, a key that was deleted, or an OAuth client id pasted in its place.

**Fix.** Copy the key again from **APIs & Services > Credentials** in the Google Cloud console. When you rely on the environment, check that the variable is named `YOUTUBE_API_KEY` and is set in the process that runs your code. It is only read when the client gets no `apiKey`.

### "YouTube Data API v3 has not been used in project ... before or it is disabled"

`error.reason` is `accessNotConfigured`.

**Cause.** The key or the OAuth client belongs to a project where the API is not enabled.

**Fix.** In **APIs & Services > Library**, enable **YouTube Data API v3** for that project. `yt.analytics` and `yt.reporting` call two other APIs, to enable separately: **YouTube Analytics API** and **YouTube Reporting API**.

### `MISSING_CREDENTIALS` on a write

**Cause.** An API key only reads public data. Every write needs OAuth, and so do reads that concern a user, such as `mine: true`. The client refuses the call before sending it, so no quota is spent.

**Fix.** Create the client with `oauth` or `accessToken`. The error lists the scopes the method accepts in `error.scopes`. See [OAuth](/auth/oauth/).

```ts
try {
  await yt.playlists.create({ title: "Favourites" });
} catch (error) {
  if (error instanceof YouTubeAuthError && error.code === "MISSING_CREDENTIALS") {
    console.log("Needs OAuth with one of:", error.scopes.join(", "));
  }
}
```

The same code with the message "This OAuth2 client has no tokens yet" means the `OAuth2` object exists and the user never went through consent, or the saved tokens were not passed as `tokens`.

### `INSUFFICIENT_SCOPE`

**Cause.** The token was granted scopes, and none of them is accepted by the method. A token obtained for `youtube.readonly` cannot write. `youtube.upload` cannot add a video to a playlist. Comments need `youtube.force-ssl`.

**Fix.** Send the user through consent again with one of `error.scopes`. Scopes granted earlier are kept. In a script that uses `tokenFile`, test `oauth.grantedScopes` before deciding to skip `authorize()`. See [Scopes](/auth/scopes/).

### `ipRefererBlocked`

**Cause.** The key is restricted to some IP addresses or HTTP referrers, and the request comes from elsewhere. A key restricted to a website does not work from a server, and the reverse.

**Fix.** Use one key per environment, each with the restriction that fits. See [Credentials](/start/credentials/).

## Quota

### `quotaExceeded` although `yt.quota.used` is low

**Cause.** `yt.quota` counts what this client sent. It does not know what the rest of the project spent: another process, another deployment, a test run this morning, a second app on the same Google Cloud project. The count also starts from zero when the process starts. And `used` is the shared bucket only: searches and uploads are counted apart, in `yt.quota.usage`.

**Fix.** Carry the count across restarts with `yt.quota.snapshot()` and the `quota.restore` option. For the real number, open the quota page of the YouTube Data API v3 in the Google Cloud console. The quota resets at midnight Pacific Time, which is `yt.quota.resetsAt`.

### Search stops working after 100 calls

**Cause.** `search.list` has a bucket of its own: 100 calls a day by default, whatever is left in the shared 10,000 units. The error is still `QUOTA_EXCEEDED`.

**Fix.** Keep search for actual searches. The uploads of a channel, the videos of a playlist and a video by id all have cheaper methods that do not touch that bucket. [Quota](/basics/quota/#buckets) lists the buckets and the alternatives.

```ts
yt.quota.remaining("search.list"); // calls left today, as far as this client knows

const latest = await yt.channels.latestVideos("@GoogleDevelopers", { limit: 10 }); // no search call
```

### `QUOTA_BUDGET_EXCEEDED`

**Cause.** This one comes from the library, not from YouTube. The client was created with `quota: { enforce: true }` and the call does not fit in what remains of its bucket. Nothing was sent.

**Fix.** Wait until `error.resetsAt`, or raise `quota.limits` if your project has more than the default allocation.

## Results that look wrong

### A channel is `null` for a `/c/` URL

**Cause.** The API has no lookup for legacy `/c/name` URLs. `yt.channels.get` tries the name as a handle, then as a username. That is usually right, and sometimes the channel uses a different handle.

**Fix.** Pass the `@handle` shown on the channel page, a `/channel/UC...` URL, or the channel id. All three are exact.

### `subscriberCount` is `undefined`, or looks rounded

**Cause.** A channel can hide its subscriber count. `statistics.hiddenSubscriberCount` is then `true` and `subscriberCount` is absent. When it is present, it is rounded by YouTube to three significant figures: this is the API, not the library.

**Fix.** Handle both cases. No parameter turns the rounding off. See [Channels](/resources/channels/).

```ts
const channel = await yt.channels.get("@GoogleDevelopers");

if (channel) {
  const { hiddenSubscriberCount, subscriberCount } = channel.statistics;
  console.log(hiddenSubscriberCount || subscriberCount === undefined ? "hidden" : formatCount(subscriberCount));
}
```

### `likeCount` or `commentCount` is `undefined`

**Cause.** The owner can hide the like count. `commentCount` is absent when comments are turned off. Both are optional in the types for that reason.

**Fix.** Treat `undefined` as "not shown", not as zero.

### A video is `null`, or missing from `getMany`

**Cause.** `yt.videos.get` resolves to `null`, and `yt.videos.getMany` leaves the video out, when it does not exist or is private. No error is thrown.

**Fix.** Compare the ids you sent with the ids you got. To read your own private videos, use OAuth.

### A playlist item has no thumbnail

**Cause.** The video behind the item was deleted or made private. The item stays in the playlist, with an empty `snippet.thumbnails`.

**Fix.** `bestThumbnail(item.snippet.thumbnails)` returns `undefined` in that case: use it as the test. `yt.playlists.videos` skips those entries altogether.

### `videos.update` erased my description

**Cause.** An update replaces every part it sends. A `snippet` that only holds a new title is a snippet without description and without tags.

**Fix.** Read the part, change it, send it back. [Videos](/resources/videos/#updating-a-video) has the full pattern.

```ts
const video = await yt.videos.get(videoId, { part: "snippet" });

if (video) {
  await yt.videos.update({ body: { id: video.id, snippet: { ...video.snippet, title: "A better title" } } });
}
```

### A duration of 0

**Cause.** A live stream that has not ended reports the duration `P0D`, which `parseDuration` turns into 0.

**Fix.** Check `snippet.liveBroadcastContent` or `liveStreamingDetails` before trusting the duration of a video that may be live.

## OAuth

### No refresh token came back

**Cause.** Google sends the refresh token the first time a user approves the app. On a later consent it sends an access token only, so `oauth.canRefresh` is `false` if the first one was not stored.

**Fix.** Force the consent screen, which makes Google send a refresh token again. Keep `accessType` at its default, `"offline"`. `authorize()` already does both.

```ts
const { url } = await oauth.authUrl({ scopes: ["youtube.readonly"], prompt: "consent" });
```

Then store what `onTokens` receives. It is called after the exchange and after every refresh.

### `invalid_grant`

The error is a `YouTubeAuthError` with the code `OAUTH_ERROR` and `error.oauthError === "invalid_grant"`.

**Cause.** The authorization code or the refresh token is no longer valid:

- the code was exchanged twice, or after it expired;
- the user revoked the access, or the token was revoked with `oauth.revoke()`;
- the consent screen of the project has the publishing status **Testing**. Google expires the refresh tokens of such an app after 7 days.

**Fix.** Send the user through consent again. For the last cause, publish the app in the Google Cloud console so its tokens stop expiring. See [Credentials](/start/credentials/).

### `redirect_uri_mismatch`

**Cause.** The redirect URI of the request is not one of those configured on the OAuth client. The comparison is exact: scheme, host, port, path and trailing slash.

**Fix.** Copy the URI you pass as `redirectUri` into **Authorized redirect URIs** of the client. For `authorize()`, which redirects to `http://127.0.0.1` on a free port, create the client with the type **Desktop app**: it accepts any loopback address.

### "The access token expired and there is no refresh token"

**Cause.** The `OAuth2` client has an access token and nothing to renew it with: the tokens were saved without their `refreshToken`, or Google never sent one.

**Fix.** Save the whole object `onTokens` gives you and pass it back as `tokens`. If it holds no `refreshToken`, see the first entry of this section.

A client created with a bare `accessToken` string fails differently when the token expires: the API answers 401 and the call throws `UNAUTHORIZED`. Nothing refreshes that token for you. Pass a function that returns a current one instead of a string.

## Uploads

### The uploaded video is locked as private

**Cause.** Videos uploaded by an unverified API project are locked as private until the project passes an audit. The upload itself succeeds.

**Fix.** Request the audit for your project. The [FAQ](/help/faq/#how-do-i-get-more-quota) has the link to the form.

### The upload fails midway

**Cause.** The connection dropped and the retries of a chunk ran out. The error is a `YouTubeUploadError` with the code `UPLOAD_FAILED`.

**Fix.** The bytes already sent are not lost. Pass `error.sessionUri` back as `resumeUri` and the upload carries on from the last confirmed byte. A session stays valid for about a week. When `sessionUri` is `undefined`, there is nothing to resume: the file was small enough to go in one request, or the session expired. Start again.

```ts
import { fileMedia } from "@ix-xs/youtube.api/node";

const body = { snippet: { title: "Holiday 2026" }, status: { privacyStatus: "private" } } as const;

try {
  await yt.videos.insert({ body, media: await fileMedia("./holiday.mp4") });
} catch (error) {
  if (!(error instanceof YouTubeUploadError) || !error.sessionUri) throw error;
  await yt.videos.insert({ body, media: await fileMedia("./holiday.mp4", { resumeUri: error.sessionUri }) });
}
```

To resume after the process itself died, store the `sessionUri` that `onProgress` receives. [Upload from a script](/recipes/upload-from-a-script/) does it.

### "does not accept ..." before anything is sent

**Cause.** The MIME type of the media is not one the method takes: an image for `videos.insert`, a video for `thumbnails.set`. `fileMedia` derives the type from the file extension, and a `Blob` carries its own.

**Fix.** Check you are passing the right file. For an unusual extension, set `mimeType` yourself.

## Live chat

### `liveChatOf` throws "has no active live chat"

**Cause.** The video exists and has no chat to join: it is not live right now, or its chat is turned off. The error is a `YouTubeArgumentError`.

**Fix.** Open the chat once the broadcast is live. For your own broadcast, the chat id is also on the broadcast resource: see [Broadcasts](/live/broadcasts/).

### The loop ends without an error

**Cause.** That is how the end of a chat is reported. `chat.messages()` returns when the broadcast goes offline, when the API answers `liveChatEnded` or `liveChatDisabled`, or when your `signal` aborts.

**Fix.** Nothing. Put what should happen at the end of the stream after the loop.

### The messages already in the chat are not delivered

**Cause.** By default the loop only yields messages posted after it started.

**Fix.** Pass `history: true` to `chat.messages()`.

### The quota is gone after a few hours

**Cause.** Each read of the chat costs 5 units, and there is one every few seconds.

**Fix.** Set `minInterval`. No message is lost with a longer interval: they arrive later, in larger batches. [Live chat](/live/live-chat/) has the arithmetic.

## Notifications

### `FEED_UNAVAILABLE`

**Cause.** The public feed did not answer, or answered with an error. YouTube does not guarantee this feed, and it has had outages where every feed answers 404 for hours. It does not mean the channel is gone.

**Fix.** Use `yt.watch()` instead of `fetchFeed` in a loop: it switches to the API for that channel when the feed fails. Or read the uploads through the API with `yt.channels.uploads()`, at 1 unit per call. See [Feeds and oEmbed](/notifications/feeds-and-oembed/).

### The hub never calls my endpoint

If `subscribe()` itself throws, the hub refused the request: the error has the code `HUB_ERROR` and its message carries the answer of the hub. When `subscribe()` resolves and nothing follows, work through these in order:

1. **The URL is not reachable.** `callbackUrl` has to be a public HTTPS URL. `localhost`, a private address or a URL behind a login will not do. Use a tunnel while developing.
2. **The confirmation was not answered.** After `subscribe()`, the hub sends a `GET` with a challenge to your URL, and the subscription only becomes active once it gets the right answer. Route `GET` as well as `POST` to `websub.receive` and send back `result.response` unchanged.
3. **The endpoint started too late.** `subscribe()` resolves when the hub accepted the request, before the confirmation. The server must be listening first.
4. **The signature does not match.** With a `secret`, a notification whose signature is wrong is dropped quietly: `notifications` is empty and `verified` is `false`. Use the same secret in `subscribe` and in `receive`.
5. **The lease ran out.** A subscription lasts 5 days by default. Call `subscribe` again before it ends.
6. **Your `confirm` function refused it.** It has to return `true` for the channels you follow.

[Push notifications](/notifications/push-notifications/) describes each step.

### A notification arrives for an old video

**Cause.** The hub notifies when a video is published and also when its title or its description changes. The notification does not say which.

**Fix.** Remember the video ids you already handled.

### The watcher reports nothing for videos that already exist

**Cause.** A watcher reports videos published after it was created.

**Fix.** Pass `since` with the moment to start from, for example the time of your last run. See [Watching uploads](/notifications/watching-uploads/).

### "is not a channel id" from `new Watcher()`

**Cause.** A `Watcher` built directly has no API client, so it cannot resolve handles or URLs.

**Fix.** Create it with `yt.watch()`, or pass `UC...` ids.

## TypeScript

### "Property 'statistics' does not exist on type ..."

**Cause.** The part was not requested. The result type only has the parts named in `part`, because the API only returns those.

**Fix.** Add the part to the call. See [Parts and types](/basics/parts-and-types/).

```ts
const slim = await yt.videos.get(videoId, { part: "snippet" });
// @ts-expect-error statistics was not requested
slim?.statistics;

const full = await yt.videos.get(videoId, { part: ["snippet", "statistics"] });
full?.statistics.viewCount;
```

### `part` built in a variable does not compile

**Cause.** An array of strings declared on its own line is typed `string[]`. The part names are lost, and so is the link between `part` and the result.

**Fix.** Declare it `as const`.

```ts
const loose = ["snippet", "statistics"];
// @ts-expect-error string[] is not a list of video parts
yt.videos.list({ part: loose, id: videoId });

const part = ["snippet", "statistics"] as const;
const { items } = await yt.videos.list({ part, id: videoId });
items[0]?.statistics.viewCount;
```

### A field is `string | undefined` and I know it is there

**Cause.** A field is optional when YouTube does not return it for every resource: tags, a hidden like count, the thumbnails of a deleted video.

**Fix.** Handle the missing case. The [FAQ](/help/faq/#why-is-a-field-optional) explains how the list of required fields is decided.

### The types resolve to `any`, or the module is not found

**Cause.** Not the `moduleResolution` setting: the package ships declarations for CommonJS and for ES modules, and both entry points resolve under `node16`, `nodenext`, `bundler` and the legacy `node10`. Look at these instead:

- **The package is not installed where the compiler looks.** In a monorepo, check the workspace that imports it. `npm ls @ix-xs/youtube.api` tells.
- **Version 1 is installed.** Version 2 is a rewrite with a different API: `npm ls` shows which one you have. See [Migrating from v1](/start/migrating-from-v1/).
- **`skipLibCheck` hides errors inside the declarations.** The declarations refer to web types such as `Request`, `Blob` and `ReadableStream`. A project with neither the `DOM` library nor `@types/node` does not have them, and with `skipLibCheck` the compiler stays silent and types what it cannot resolve as `any`. Add `@types/node`, or `"DOM"` to `lib`.
- **The compiler is old.** The declarations are generated with TypeScript 6. If turning `skipLibCheck` off shows syntax errors inside `index.d.ts`, upgrade TypeScript.

[Runtimes](/reference/runtimes/#typescript) has the resolution table.

## See also

- [Error codes](/reference/errors/) for every code and reason.
- [Errors](/basics/errors/) for handling, retries and timeouts.
- [FAQ](/help/faq/) for the questions that are not failures.
- [GitHub issues](https://github.com/ix-xs/youtube.api/issues) when none of this matches.
