---
title: Errors
description: A failed call throws an error with a stable code and, when the API answered, the reason it gave. Rate limits, server errors and network failures are retried before anything is thrown.
sidebar:
  order: 4
---

```ts
import { YouTubeApiError, isYouTubeError } from "@ix-xs/youtube.api";

try {
  await yt.commentThreads.post(videoId, "Nice one"); // 50 units
} catch (error) {
  if (error instanceof YouTubeApiError && error.reason === "commentsDisabled") {
    // comments are turned off on that video
  } else if (isYouTubeError(error, "QUOTA_EXCEEDED")) {
    // wait until yt.quota.resetsAt
  } else {
    throw error;
  }
}
```

## The error classes

Everything the library throws extends `YouTubeError` and carries a `code`. The class tells you where the failure happened.

| Class | Thrown when | Sent to the API |
| --- | --- | --- |
| `YouTubeApiError` | The API answered with an error status | Yes |
| `YouTubeRequestError` | No usable response: timeout, network failure, abort, unreadable body, feed unavailable | Maybe |
| `YouTubeUploadError` | A media upload could not be completed | Yes |
| `YouTubeAuthError` | Credentials are missing or insufficient, or an OAuth exchange failed | No, except for the OAuth exchange |
| `YouTubeArgumentError` | An argument was rejected before anything was sent | No |
| `YouTubeQuotaBudgetError` | The call would go over the budget you set with `quota.enforce` | No |

The last three cost no quota: the call never left your process. [Credentials](/start/credentials/) covers the auth checks and [Quota](/basics/quota/) the budget.

## Branching on the code

`error.code` is a fixed set of strings. Compare against it instead of reading messages. `isYouTubeError(error, code)` checks the class and the code in one call:

```ts
try {
  await yt.playlists.add(playlistId, videoId); // 50 units
} catch (error) {
  if (isYouTubeError(error, "NOT_FOUND")) {
    console.log("That playlist or that video does not exist");
  } else if (isYouTubeError(error, "MISSING_CREDENTIALS")) {
    console.log("Sign in first");
  } else {
    throw error;
  }
}
```

Without a code, `isYouTubeError(error)` tells a library error from anything else, and gives you a typed `error.code` to switch on:

```ts
function explain(error: unknown): string {
  if (!isYouTubeError(error)) return "Something else went wrong";
  switch (error.code) {
    case "QUOTA_EXCEEDED":
      return `Out of quota until ${yt.quota.resetsAt.toISOString()}`;
    case "RATE_LIMITED":
      return "Too many requests, try again in a moment";
    case "TIMEOUT":
    case "NETWORK":
      return "YouTube could not be reached";
    default:
      return error.message;
  }
}
```

For an API error, the code comes from the reason first and from the HTTP status second. A `403` whose reason is `quotaExceeded` has the code `QUOTA_EXCEEDED`, not `FORBIDDEN`. A `403` whose reason is `rateLimitExceeded` has the code `RATE_LIMITED`.

The reference at the end of this page lists every code.

## Branching on the reason

A code says what kind of failure it is. The `reason` of a `YouTubeApiError` says exactly what the API objected to. It is the string YouTube puts in its error body.

```ts
try {
  await yt.videos.rate({ id: videoId, rating: "like" }); // 50 units
} catch (error) {
  if (error instanceof YouTubeApiError) {
    if (error.reason === "videoRatingDisabled") console.log("Ratings are turned off on that video");
    else console.log(error.status, error.reason, error.message);
  } else {
    throw error;
  }
}
```

`error.reason` is typed with the reasons worth branching on, so your editor completes them. The type stays open: the API can return a reason that is not in the list.

A `YouTubeApiError` has three shortcuts for the cases you will handle most:

| Getter | True when | What to do |
| --- | --- | --- |
| `error.isQuotaExceeded` | The project ran out of quota for the day | Stop. Retrying before midnight Pacific Time is pointless |
| `error.isRateLimited` | Too many requests in a short window | Retry after a pause. The client already did, see below |
| `error.isNotFound` | The resource does not exist, or the credentials cannot see it | Treat it as missing |

```ts
try {
  const items = await yt.channels.uploads(channelId).take(10); // 1 unit
  console.log(items.length);
} catch (error) {
  if (error instanceof YouTubeApiError && error.isNotFound) {
    console.log("This channel never uploaded anything");
  } else {
    throw error;
  }
}
```

The helpers named `get` do not throw for a missing resource. `yt.videos.get`, `yt.channels.get` and `yt.playlists.get` resolve to `null`.

## What is retried

The client retries a failed call on its own when retrying can help and cannot do harm. An error reaches you only after the retries ran out.

| Failure | A read (`GET`) | A write |
| --- | --- | --- |
| Rate limit: a `429`, or the reasons `rateLimitExceeded` and `userRateLimitExceeded` | Retried | Retried |
| Server error, `5xx` | Retried | Not retried |
| Timeout or network failure | Retried | Not retried |
| Quota exceeded | Not retried | Not retried |
| Any other `4xx` | Not retried | Not retried |
| Aborted with `signal`, or an unreadable body | Not retried | Not retried |

A rate limit means the call was not processed, so anything can be sent again. A server error or a timeout says nothing about a write: it may have gone through. The client never replays one, so a retry cannot create a second comment or a second playlist item. If a write fails that way, read the resource before you send it again.

By default there are 3 retries. The delay starts at 500 ms and doubles each time, up to 30 seconds. The client waits a random time between half of that delay and all of it, so many clients do not retry in step. When the API sends a `Retry-After` header, that value is used instead. If it is longer than `maxDelay`, the call is not retried: the error is thrown at once with its `retryAfter`, so you decide whether to wait.

One more case is handled apart. On a `401`, a client created with `oauth` refreshes the access token once and sends the call again. That does not count as a retry.

A resumable upload applies the same policy to each chunk and resumes from the byte the server confirmed. See [Uploads](/resources/uploads/).

## Tuning retries and timeouts

Both are options of the client, and both can be overridden for one call.

```ts
const yt = new YouTube({
  apiKey,
  retry: { attempts: 5, delay: "1s", maxDelay: "1m" },
  timeout: "10s",
});

// No retry and a short timeout for this one call.
await yt.videos.get(videoId, { retry: false, timeout: "3s" });

// Only the number of attempts changes. The delays stay those of the client.
await yt.videos.get(videoId, { retry: { attempts: 1 } });
```

`timeout` is the time allowed for one attempt, `"30s"` by default. A call that is retried three times can therefore take four timeouts plus the waits. A timeout throws a `YouTubeRequestError` with the code `TIMEOUT`. Uploads are not subject to it.

The `retry` event fires before each wait:

```ts
yt.on("retry", ({ method, attempt, delay, error }) => {
  console.warn(`${method}: retry ${attempt} in ${delay} ms (${error.message})`);
});
```

## Cancelling a call

Pass a `signal`. Aborting it stops the request, or the wait between two retries, and the call throws a `YouTubeRequestError` with the code `ABORTED`.

```ts
const controller = new AbortController();
setTimeout(() => controller.abort(), 5_000);

try {
  for await (const item of yt.playlists.items(playlistId, { signal: controller.signal })) {
    console.log(item.snippet.title);
  }
} catch (error) {
  if (!isYouTubeError(error, "ABORTED")) throw error;
}
```

`timeout` bounds one attempt. To bound a whole call, retries included, use a signal:

```ts
await yt.videos.get(videoId, { signal: AbortSignal.timeout(15_000) });
```

## What an error contains

The message starts with the method that failed, `videos.list: `, followed by what the API said. A `YouTubeApiError` also carries the rest of the answer.

```ts
try {
  await yt.videos.get(videoId);
} catch (error) {
  if (error instanceof YouTubeApiError) {
    console.error({
      code: error.code, // "FORBIDDEN"
      status: error.status, // 403
      reason: error.reason, // "accessNotConfigured"
      method: error.method, // "videos.list"
      url: error.url, // the request URL
      errors: error.errors, // every entry of the error body
    });
  }
  throw error;
}
```

`error.url` has credentials removed, so it is safe to log. The same goes for the URLs in the client's events. The API key is not in the URL to begin with: it travels in a header.

A `YouTubeRequestError` keeps the underlying failure in `error.cause`.

## Reference

### Codes

| `code` | Class | Meaning |
| --- | --- | --- |
| `BAD_REQUEST` | `YouTubeApiError` | Status 400 |
| `UNAUTHORIZED` | `YouTubeApiError` | Status 401 |
| `FORBIDDEN` | `YouTubeApiError` | Status 403, for another reason than quota or rate limit |
| `NOT_FOUND` | `YouTubeApiError` | Status 404 |
| `CONFLICT` | `YouTubeApiError` | Status 409 |
| `QUOTA_EXCEEDED` | `YouTubeApiError` | Reason `quotaExceeded` or `dailyLimitExceeded` |
| `RATE_LIMITED` | `YouTubeApiError` | Status 429, or reason `rateLimitExceeded` or `userRateLimitExceeded` |
| `SERVER_ERROR` | `YouTubeApiError` | Status 500 and above |
| `API_ERROR` | `YouTubeApiError` | Any other error status |
| `TIMEOUT` | `YouTubeRequestError` | No response within `timeout` |
| `NETWORK` | `YouTubeRequestError` | The request could not be made |
| `ABORTED` | `YouTubeRequestError` | Your `signal` aborted |
| `PARSE_ERROR` | `YouTubeRequestError` | The response is not valid JSON |
| `FEED_UNAVAILABLE` | `YouTubeRequestError` | The public feed of a channel or playlist could not be read |
| `UPLOAD_FAILED` | `YouTubeUploadError` | A media upload could not be completed |
| `MISSING_CREDENTIALS` | `YouTubeAuthError` | No credentials, or the call needs OAuth and there is no token |
| `INSUFFICIENT_SCOPE` | `YouTubeAuthError` | The token has none of the scopes the method accepts |
| `OAUTH_ERROR` | `YouTubeAuthError` | An OAuth request failed, or the access token expired and there is no refresh token |
| `INVALID_ARGUMENT` | `YouTubeArgumentError` | An argument was rejected before anything was sent |
| `QUOTA_BUDGET_EXCEEDED` | `YouTubeQuotaBudgetError` | The call does not fit in the budget of `quota.enforce` |

[Errors](/reference/errors/) in the reference section has the full table of codes.

### Fields

| Class | Field | Type | What it is |
| --- | --- | --- | --- |
| Every error | `code` | `YouTubeErrorCode` | Stable code |
| Every error | `message` | `string` | Readable description |
| `YouTubeApiError` | `status` | `number` | HTTP status code |
| | `reason` | `YouTubeErrorReason \| undefined` | First reason of the error body |
| | `errors` | `ApiErrorDetail[]` | Every error entry the API returned |
| | `apiStatus` | `string \| undefined` | gRPC-style status, for example `PERMISSION_DENIED` |
| | `method` | `string` | Method that failed, for example `videos.list` |
| | `url` | `string` | Request URL with credentials removed |
| | `retryAfter` | `number \| undefined` | Seconds to wait, when the API said so |
| | `body` | `unknown` | Parsed response body, when there was one |
| `YouTubeRequestError` | `method` | `string` | Method that failed |
| `YouTubeAuthError` | `scopes` | `readonly string[]` | Scopes that would have allowed the call, when known |
| | `oauthError` | `string \| undefined` | OAuth error name returned by Google, for example `invalid_grant` |
| `YouTubeQuotaBudgetError` | `bucket`, `cost`, `remaining`, `resetsAt` | | The bucket, what the call costs, what is left, and when it resets |
| `YouTubeUploadError` | `sessionUri` | `string \| undefined` | Resumable session, to pass back as `resumeUri` |
| | `uploaded` | `number` | Bytes the server confirmed |

### Common reasons

| Group | `error.reason` |
| --- | --- |
| Quota | `quotaExceeded`, `dailyLimitExceeded` |
| Rate limit | `rateLimitExceeded`, `userRateLimitExceeded` |
| Key and project | `keyInvalid`, `keyExpired`, `accessNotConfigured`, `ipRefererBlocked` |
| Authorization | `authError`, `required`, `forbidden`, `insufficientPermissions` |
| Account and channel | `youtubeSignupRequired`, `accountClosed`, `accountSuspended`, `channelClosed`, `channelSuspended`, `emailNotVerified` |
| Request | `badRequest`, `invalid`, `invalidParameter`, `missingRequiredParameter`, `incompatibleParameters`, `invalidPageToken`, `invalidFilters`, `unknownPart` |
| Not found | `notFound`, `videoNotFound`, `channelNotFound`, `playlistNotFound`, `playlistItemNotFound`, `commentNotFound`, `commentThreadNotFound`, `subscriptionNotFound`, `captionNotFound`, `liveChatNotFound`, `liveBroadcastNotFound`, `liveStreamNotFound` |
| Turned off | `commentsDisabled`, `videoRatingDisabled`, `liveChatDisabled`, `liveChatEnded` |
| Playlists and subscriptions | `playlistForbidden`, `playlistContainsMaximumNumberOfVideos`, `videoAlreadyInPlaylist`, `subscriptionDuplicate`, `subscriptionForbidden` |
| Video metadata and uploads | `invalidTitle`, `invalidDescription`, `invalidTags`, `invalidCategoryId`, `invalidVideoMetadata`, `defaultLanguageNotSet`, `uploadLimitExceeded` |
| Server | `processingFailure`, `backendError`, `internalError`, `serviceUnavailable` |

### Retry and timeout options

These exist on the client and on every call.

| Option | Type | Default | What it does |
| --- | --- | --- | --- |
| `retry.attempts` | `number` | `3` | Retries after the first attempt. `0` turns retries off |
| `retry.delay` | `Duration` | `"500ms"` | First delay, doubled on each retry |
| `retry.maxDelay` | `Duration` | `"30s"` | Upper bound of a single delay |
| `retry` | `false` | | Turns retries off |
| `timeout` | `Duration` | `"30s"` | Time allowed for one attempt |
| `signal` | `AbortSignal` | | Cancels the call. Per call only |

## See also

- [Errors](/reference/errors/) in the reference section: the full table of codes.
- [Quota](/basics/quota/): `QUOTA_EXCEEDED`, and how not to get there.
- [Credentials](/start/credentials/): the calls that are refused before they are sent.
- [Troubleshooting](/help/troubleshooting/): the errors people meet first.
