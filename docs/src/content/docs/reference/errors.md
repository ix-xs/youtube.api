---
title: Error codes
description: Every error code the library throws, the reasons the API gives, and the properties of each error class. Use it to look up what a failure means and whether a retry already happened.
---

```ts
try {
  await yt.playlists.add(playlistId, videoId);
} catch (error) {
  if (error instanceof YouTubeApiError) {
    error.code; // set by the library, for example "NOT_FOUND"
    error.reason; // sent by the API, for example "playlistNotFound"
  }
  throw error;
}
```

Every error extends `YouTubeError` and carries a `code`. A `YouTubeApiError` also carries the `reason` the API gave. [Errors](/basics/errors/) explains how to handle them. This page is the lookup table.

## Codes

`code` is a `YouTubeErrorCode`. There are 21 of them.

In the tables, "retried" means up to 3 more attempts by default. The delay starts at 500 ms and doubles, up to 30 seconds, with some jitter. When the API sends a `Retry-After`, that wait is used instead. A `Retry-After` longer than `retry.maxDelay` is not waited for: the error is thrown at once, with its `retryAfter`. A read is a `GET`. [Errors](/basics/errors/) has the whole policy and the options that change it.

What is retried, in short:

| Failure | Reads | Writes |
| --- | --- | --- |
| Rate limit | Retried | Retried |
| Server error, timeout, network failure | Retried | Not retried: the write may have gone through |
| Status 401, when the client has an `OAuth2` that can refresh | Sent once more with a new token | Sent once more with a new token |
| Anything else | Not retried | Not retried |

### The API answered with an error

All of these are thrown as a `YouTubeApiError`. The code follows the HTTP status, except for the quota and rate limit reasons, which win over the status. `SERVER_ERROR` has one other source: `oEmbed` throws it as a `YouTubeRequestError` when YouTube answers with a status it does not expect.

| Code | When | Retried by the library | What to do |
| --- | --- | --- | --- |
| `BAD_REQUEST` | Status 400 | No | Fix the call. `error.reason` and `error.errors` name the parameter or the field |
| `UNAUTHORIZED` | Status 401 | Once, after refreshing the token, when the client has an `OAuth2` that can refresh | Send the user through consent again, or replace the access token |
| `FORBIDDEN` | Status 403 without a quota or rate limit reason | No | Read `error.reason`: the key, the project, the account or the resource refuses the call |
| `NOT_FOUND` | Status 404 | No | The resource does not exist, or these credentials cannot see it |
| `CONFLICT` | Status 409 | No | The resource is in a state that refuses the change. Read it again before retrying |
| `QUOTA_EXCEEDED` | Reason `quotaExceeded` or `dailyLimitExceeded`, whatever the status | No | Wait until `yt.quota.resetsAt`. See [Quota](/basics/quota/) |
| `RATE_LIMITED` | Status 429, or reason `rateLimitExceeded` or `userRateLimitExceeded` | Yes, reads and writes | Slow down. It reaches you only after the retries ran out, or when the API asked for a longer wait than `retry.maxDelay` |
| `SERVER_ERROR` | Status 500 and above. From `oEmbed`: any error status other than 400, 401, 403 and 404, which give `null` | Reads only. `oEmbed` is not retried | Try later. For a write, check whether it was applied before sending it again |
| `API_ERROR` | Any other error status | No | Read `error.status` and `error.body` |

### The request produced no usable response

All of these are thrown as a `YouTubeRequestError`.

| Code | When | Retried by the library | What to do |
| --- | --- | --- | --- |
| `TIMEOUT` | No response within `timeout`, 30 seconds by default. Also a feed or an oEmbed request that did not answer within its own `timeout`, 15 seconds by default | Reads only. Feed and oEmbed requests are not retried | Raise `timeout`, or try later |
| `NETWORK` | `fetch` failed: DNS, connection, TLS. Also an oEmbed request or a WebSub hub that could not be reached | Reads only. oEmbed requests, hub requests and report downloads are not retried. The chat stream is reopened up to three times in a row | Check the connection. `error.cause` holds the underlying failure |
| `ABORTED` | The `signal` you passed was aborted, during the request or during the wait before a retry | No | Nothing: you asked for it |
| `PARSE_ERROR` | The API, or `oEmbed`, answered with a success status and a body that is not valid JSON | No | Try again. If a proxy sits in between, look at what it returns |
| `FEED_UNAVAILABLE` | The public feed of a channel or a playlist answered with an error status, or could not be reached | No. `yt.watch()` reads that channel through the API for the next 30 minutes instead | Do not conclude the channel is gone. See [Feeds and oEmbed](/notifications/feeds-and-oembed/) |
| `HUB_ERROR` | The WebSub hub refused `websub.subscribe()` or `websub.unsubscribe()`: it answered with an error status | No | Read the message, which carries the status and the answer of the hub. See [Push notifications](/notifications/push-notifications/) |

`SERVER_ERROR` from `oEmbed` belongs to this class too, see the table above.

### Refused by the library

None of these is retried. The first, the second and the last are raised before the request is sent, so they spend no quota.

| Code | Class | When | What to do |
| --- | --- | --- | --- |
| `MISSING_CREDENTIALS` | `YouTubeAuthError` | The client has no credentials. Or the call needs OAuth and there is only an API key: every write, every Analytics and Reporting call, a few reads that are private by nature such as `captions.list`, and reads with parameters such as `mine`. Or the `OAuth2` client has no tokens yet | Pass `oauth` or `accessToken`. `error.scopes` lists the scopes the method accepts |
| `INSUFFICIENT_SCOPE` | `YouTubeAuthError` | The scopes granted to the token include none of those the method accepts. A public read is not refused when the client also has an API key: it goes out with the key | Send the user through consent again with one of `error.scopes` |
| `INVALID_ARGUMENT` | `YouTubeArgumentError` | An argument cannot be right: a string that is not a video id or URL, an unknown method name, an invalid duration, a media type the method does not accept, an empty file. Or a reference matched nothing: a handle with no channel, a video with no live chat. That second kind is known after a lookup, which costs its usual unit | Fix the argument. The message says which one |
| `QUOTA_BUDGET_EXCEEDED` | `YouTubeQuotaBudgetError` | The client was created with `quota.enforce` and the call does not fit in what is left of its bucket | Wait until `error.resetsAt`, or raise `quota.limits` |

### OAuth and uploads

| Code | Class | When | Retried by the library | What to do |
| --- | --- | --- | --- | --- |
| `OAUTH_ERROR` | `YouTubeAuthError` | Google refused a token request: exchange, refresh, revocation, device flow. Or the access token expired and there is no refresh token. Or your `onTokens` callback threw. Or nobody completed `authorize()` in time | No | Read `error.oauthError`. See [the names below](#oauth-error-names) |
| `UPLOAD_FAILED` | `YouTubeUploadError` | A media upload could not be completed: a session could not be opened or reached, the retries of a chunk ran out, the session expired, or the connection failed during a single-request upload | Each chunk is retried, 3 times by default, on a network failure or a status 408, 429 or 5xx. A single-request upload is not retried | Pass `error.sessionUri` back as `resumeUri`. When it is `undefined`, start the upload again. See [Uploads](/resources/uploads/) |

During an upload, an error status that a retry cannot fix is thrown as a `YouTubeApiError` with the codes of the first table, and an aborted `signal` as `ABORTED`.

## Reasons

`error.reason` is the `reason` of the first entry of the API's error body, in `error.errors`. The type `YouTubeErrorReason` lists the values below so that they autocomplete. It stays open: the API can send others, and comparing with any string compiles.

The library takes these names from the API and does not define what they mean. The meanings below are short readings of the names: for a given failure, `error.message` is what YouTube says about it.

```ts
try {
  await yt.commentThreads.post(videoId, "Nice one");
} catch (error) {
  if (!(error instanceof YouTubeApiError)) throw error;

  if (error.reason === "commentsDisabled") {
    console.log("Comments are off on this video.");
  } else if (error.reason === "someFutureReason") {
    console.log("Still compiles.");
  } else {
    throw error;
  }
}
```

Some error bodies name a more precise cause in a `details` entry. When they do, that one wins and the library maps it to the same reasons: `API_KEY_INVALID` to `keyInvalid`, `API_KEY_EXPIRED` to `keyExpired`, `SERVICE_DISABLED` to `accessNotConfigured`, `ACCESS_TOKEN_SCOPE_INSUFFICIENT` to `insufficientPermissions` and `RATE_LIMIT_EXCEEDED` to `rateLimitExceeded`.

### Quota and rate limits

| Reason | Meaning |
| --- | --- |
| `quotaExceeded` | The project spent its quota for the day, in the bucket the method draws from. Code `QUOTA_EXCEEDED` |
| `dailyLimitExceeded` | The daily limit of the project is reached. Code `QUOTA_EXCEEDED` as well |
| `rateLimitExceeded` | Too many requests in a short window. Code `RATE_LIMITED`, retried |
| `userRateLimitExceeded` | Too many requests in a short window for one user. Code `RATE_LIMITED`, retried |

### Credentials

| Reason | Meaning |
| --- | --- |
| `keyInvalid` | The API key is not a valid key |
| `keyExpired` | The API key has expired |
| `accessNotConfigured` | The API is not enabled in the Google Cloud project of the credentials |
| `ipRefererBlocked` | The key has an IP address or HTTP referrer restriction, and the request does not match it |
| `authError` | The access token is invalid or expired |
| `required` | The call needs authorization and the request carried none the API accepts |
| `forbidden` | The credentials are valid and are not allowed to do this |
| `insufficientPermissions` | The token lacks a scope the method needs. The library refuses the call itself, with `INSUFFICIENT_SCOPE`, when it knows the granted scopes |
| `youtubeSignupRequired` | The Google account has no YouTube channel |
| `accountClosed` | The account of the user is closed |
| `accountSuspended` | The account of the user is suspended |
| `channelClosed` | The channel is closed |
| `channelSuspended` | The channel is suspended |
| `emailNotVerified` | The user has to verify their email address before doing this |

### Not found

Each of these means the resource does not exist, or exists and is hidden from the credentials used.

| Reason | What was not found |
| --- | --- |
| `notFound` | The resource, when the API does not say more |
| `videoNotFound` | The video |
| `channelNotFound` | The channel |
| `playlistNotFound` | The playlist |
| `playlistItemNotFound` | The playlist item |
| `commentNotFound` | The comment |
| `commentThreadNotFound` | The comment thread |
| `subscriptionNotFound` | The subscription |
| `captionNotFound` | The caption track |
| `liveChatNotFound` | The live chat |
| `liveBroadcastNotFound` | The broadcast |
| `liveStreamNotFound` | The stream |

### Request problems

| Reason | Meaning |
| --- | --- |
| `badRequest` | The request is not valid, without more detail |
| `invalid` | A value is not valid. `error.errors[0].location` names it when the API says |
| `invalidParameter` | A parameter has a value the method does not accept |
| `missingRequiredParameter` | A required parameter is missing |
| `incompatibleParameters` | Two parameters that cannot go together were sent |
| `invalidPageToken` | The `pageToken` is not one the API issued for this request |
| `invalidFilters` | The combination of filters is not valid |
| `unknownPart` | `part` names a part the resource does not have |

The parameter and part names are checked at compile time, so most of these only appear when a call is built from untyped data.

### Comments, playlists, subscriptions, uploads

| Reason | Meaning |
| --- | --- |
| `commentsDisabled` | Comments are turned off on the video |
| `videoRatingDisabled` | Ratings are turned off on the video |
| `subscriptionDuplicate` | The subscription already exists |
| `subscriptionForbidden` | The subscription is not allowed |
| `playlistForbidden` | The playlist does not allow the operation, or the credentials may not perform it |
| `playlistContainsMaximumNumberOfVideos` | The playlist is full |
| `videoAlreadyInPlaylist` | The video is already in the playlist |
| `uploadLimitExceeded` | The channel has reached the number of videos it may upload for now |
| `invalidTitle` | The title is empty or not accepted |
| `invalidDescription` | The description is not accepted |
| `invalidTags` | The tags are not accepted |
| `invalidCategoryId` | `snippet.categoryId` is not a category videos can be assigned to |
| `invalidVideoMetadata` | The metadata of the video is not valid |
| `defaultLanguageNotSet` | Localized details were sent for a resource that has no default language |

### Live chat

| Reason | Meaning |
| --- | --- |
| `liveChatDisabled` | The broadcast has its chat turned off. `chat.messages()` ends without throwing |
| `liveChatEnded` | The chat is over. `chat.messages()` ends without throwing |

`liveChatNotFound` is in the table of resources not found.

### Server

| Reason | Meaning |
| --- | --- |
| `processingFailure` | The API failed to process the request |
| `backendError` | An error on YouTube's side |
| `internalError` | An error on YouTube's side |
| `serviceUnavailable` | The service is not available right now |

## OAuth error names

`error.oauthError` on a `YouTubeAuthError` is the `error` field of Google's answer, unchanged.

| `oauthError` | Meaning |
| --- | --- |
| `invalid_grant` | The code or the refresh token is no longer valid: used twice, revoked or expired. Send the user through consent again |
| `redirect_uri_mismatch` | The redirect URI is not one configured on the OAuth client. It must match character for character |
| `authorization_pending`, `slow_down` | Device flow: the user has not approved yet. `pollDeviceToken()` handles both and keeps waiting |
| `expired_token` | Device flow: the code expired before the user approved it. Set by the library |
| Any other name | Passed through as Google sent it. `authorize()` also reports the `error` parameter Google puts on the redirect when the user refuses |

`oauthError` is `undefined` when the failure did not come from Google: a missing refresh token, a failing `onTokens`, a consent that timed out.

## Error classes

All classes are exported from the main entry. `isYouTubeError(error, code?)` tells whether a value is a `YouTubeError`, and optionally whether it has a given code.

### `YouTubeError`

The base class. Everything the library throws is one.

| Property | Type | What it is |
| --- | --- | --- |
| `code` | `YouTubeErrorCode` | Stable code, safe to switch on |
| `message` | `string` | Readable description. For a failed call it starts with the method, `videos.list: ` |
| `name` | `string` | The class name, for example `"YouTubeApiError"` |
| `cause` | `unknown` | The underlying failure, when the error wraps one |

### `YouTubeApiError`

The API answered with an error status.

| Property | Type | What it is |
| --- | --- | --- |
| `status` | `number` | HTTP status code |
| `reason` | `YouTubeErrorReason \| undefined` | First reason of the error body, or the more precise one of its `details` when there is one |
| `errors` | `ApiErrorDetail[]` | Every entry of the error body: `message`, and when the API sends them `domain`, `reason`, `location`, `locationType`. Empty when the body had none |
| `apiStatus` | `string \| undefined` | gRPC-style status, for example `PERMISSION_DENIED` |
| `method` | `string` | Method that failed, for example `videos.list` |
| `url` | `string` | Request URL with credentials removed |
| `retryAfter` | `number \| undefined` | Seconds to wait before retrying, when the API sent `Retry-After` |
| `body` | `unknown` | The parsed response body, or its text when it was not JSON |
| `isQuotaExceeded` | `boolean` | `code === "QUOTA_EXCEEDED"` |
| `isRateLimited` | `boolean` | `code === "RATE_LIMITED"` |
| `isNotFound` | `boolean` | `code === "NOT_FOUND"` |

### `YouTubeAuthError`

Codes `MISSING_CREDENTIALS`, `INSUFFICIENT_SCOPE` and `OAUTH_ERROR`.

| Property | Type | What it is |
| --- | --- | --- |
| `scopes` | `readonly string[]` | Scopes that would have allowed the call, short names. Empty when unknown |
| `oauthError` | `string \| undefined` | OAuth error name returned by Google, for example `invalid_grant` |

### `YouTubeRequestError`

Codes `TIMEOUT`, `NETWORK`, `ABORTED`, `PARSE_ERROR`, `FEED_UNAVAILABLE`, `HUB_ERROR`, and `SERVER_ERROR` when `oEmbed` gets an unexpected status from YouTube.

| Property | Type | What it is |
| --- | --- | --- |
| `method` | `string` | Method that failed, for example `videos.list`. The helpers that do not call the API use `feed`, `oembed`, `websub.subscribe`, `websub.unsubscribe` and `oauth.pollDeviceToken` |

### `YouTubeArgumentError`

Code `INVALID_ARGUMENT`. No property of its own: the message says what was wrong.

### `YouTubeQuotaBudgetError`

Code `QUOTA_BUDGET_EXCEEDED`.

| Property | Type | What it is |
| --- | --- | --- |
| `bucket` | `string` | Bucket the call is charged to |
| `cost` | `number` | Units the call would have cost |
| `remaining` | `number` | Units left in the bucket |
| `resetsAt` | `Date` | When the bucket resets: midnight Pacific Time |

### `YouTubeUploadError`

Code `UPLOAD_FAILED`.

| Property | Type | What it is |
| --- | --- | --- |
| `sessionUri` | `string \| undefined` | Resumable session, valid for about a week. Pass it back as `resumeUri`. `undefined` when there is nothing to resume: the upload went in a single request, or the session expired |
| `uploaded` | `number` | Bytes the server confirmed |

## See also

- [Errors](/basics/errors/) for handling: branching, retries, timeouts, cancelling.
- [Troubleshooting](/help/troubleshooting/) for the failures people meet first, by symptom.
- [Quota](/basics/quota/#buckets) for what `QUOTA_EXCEEDED` means per bucket.
- [All exports](/reference/exports/) for the error classes next to everything else.
