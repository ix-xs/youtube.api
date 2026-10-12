---
title: Credentials
description: What an API key is enough for, what needs OAuth, and how to create both in the Google Cloud console. A call that needs OAuth or a missing scope is refused before it is sent, so it costs no quota.
---

```ts
import { YouTube } from "@ix-xs/youtube.api";

// Public data: an API key.
const reader = new YouTube({ apiKey: process.env.YOUTUBE_API_KEY });

// Private data and writes: OAuth.
const writer = new YouTube({
  oauth: { clientId, clientSecret, tokens: savedTokens, onTokens: saveTokens },
});
```

## What an API key can do

An API key reads public data and nothing else.

19 of the 82 Data API methods accept a key:

| Resource | Methods that work with a key |
| --- | --- |
| Videos | `videos.list`, `videos.batchGetStats`, `videoTrainability.get`, `videoCategories.list`, `videoAbuseReportReasons.list` |
| Channels | `channels.list`, `channelSections.list`, `activities.list`, `subscriptions.list` |
| Playlists | `playlists.list`, `playlistItems.list`, `playlistImages.list` |
| Search | `search.list` |
| Comments | `commentThreads.list`, `comments.list` |
| Live chat | `liveChatMessages.list`, `liveChatMessages.stream` |
| Localisation | `i18nLanguages.list`, `i18nRegions.list` |

The helpers built on those methods work with a key too: `yt.channels.get`, `yt.channels.latestVideos`, `yt.videos.get`, `yt.playlists.items`, `yt.search.videos`, `yt.liveChatOf` and the other helpers that read public data.

A key is never enough for:

- Any write: uploads, playlist edits, comments, ratings, subscriptions.
- The other 63 methods of the Data API, live broadcasts and captions included.
- The Analytics API and the Reporting API.
- A read that asks for the user's own data. On the methods above, these parameters need OAuth: `mine`, `myRating`, `mySubscribers`, `myRecentSubscribers`, `forMine`, `home`, `managedByMe`, `forContentOwner`, `forDeveloper`, `onBehalfOfContentOwner`, `onBehalfOfContentOwnerChannel`.

[Every method](/reference/methods/) says what each call accepts.

## Creating an API key

1. Open the [Google Cloud console](https://console.cloud.google.com/) and create a project, or pick one.
2. Enable **YouTube Data API v3** for the project. Without it, calls fail with the reason `accessNotConfigured`.
3. In **APIs & Services > Credentials**, create an API key.
4. Restrict the key before you use it. The next section says how.

Quota belongs to the project, not to the key: two keys of one project share one daily allowance. [Quota](/basics/quota/) has the numbers.

## Restricting the key

A key can be restricted in three ways. Use the first one always, and one of the other two when it fits.

| Restriction | Use it when |
| --- | --- |
| By API: allow only YouTube Data API v3 | Always. A leaked key then cannot call the other APIs of your project |
| By IP address | The key runs on a server with a known address |
| By HTTP referrer | The key ships in a web page |

A key in a web page is public: anyone can read it in the requests their browser sends. A referrer restriction limits where it can be used. If you can, keep the key on a server and call the API from there.

On a server, keep the key out of the code and out of the repository. Put it in an environment variable.

## The `YOUTUBE_API_KEY` fallback

When `apiKey` is left out, the client reads the `YOUTUBE_API_KEY` environment variable:

```ts
const yt = new YouTube(); // uses process.env.YOUTUBE_API_KEY
```

That also holds next to `oauth`. Public reads then go out with the key until the user has signed in, see [A key and a token together](#a-key-and-a-token-together).

A string is a shorthand for `{ apiKey }`:

```ts
const yt = new YouTube(apiKey);
```

## Three ways to authenticate

| Option | What you give | Use it when |
| --- | --- | --- |
| `apiKey` | A key | You only read public data |
| `oauth` | An `OAuth2` client, or the options to build one | You need private data or writes. Tokens are refreshed for you |
| `accessToken` | A token, or a function that returns one | Something else already manages the tokens. Nothing is refreshed |

```ts
import { OAuth2, YouTube } from "@ix-xs/youtube.api";

// 1. A key.
const withKey = new YouTube({ apiKey });

// 2. An OAuth client. Pass an instance, or its options.
const client = new OAuth2({
  clientId,
  clientSecret,
  tokens: savedTokens,
  onTokens: saveTokens,
});
const withOAuth = new YouTube({ oauth: client });

// 3. A token you got elsewhere. A function is called for every call.
const withToken = new YouTube({
  accessToken: () => session.accessToken as string,
});
```

Whether you pass an instance or options, the `OAuth2` client is available as `yt.oauth`. [OAuth](/auth/oauth/) covers the consent flow, and [Scripts and devices](/auth/scripts-and-devices/) the flows that need no web server.

One call can use another token than the client's, with the `accessToken` request option. This one costs 1 unit:

```ts
const mine = await yt.channels.mine({ accessToken: session.accessToken });
```

For a server that holds the tokens of many users, [`yt.as()`](/auth/many-users/) is the better tool.

## A key and a token together

You can set `apiKey` next to `oauth`. The rules are:

- When a token is available, it is used. A token sees everything a key sees, plus the user's private data.
- When the `OAuth2` client has no usable token (no access token or an expired one, and no refresh token), a public read is sent with the key.
- When the scopes of the token are known and the method accepts none of them, a public read is sent with the key too.
- A call that needs OAuth never falls back on the key. It is refused, see below.

That makes one client enough for an app where signing in is optional:

```ts
const oauth = new OAuth2({
  clientId,
  clientSecret,
  redirectUri: "https://example.com/oauth/callback",
});
const yt = new YouTube({ apiKey, oauth });

await yt.videos.get(videoId); // 1 unit. No tokens yet: sent with the key

await oauth.exchange(code, { codeVerifier });
await yt.videos.get(videoId); // 1 unit, sent with the user's token
await yt.channels.mine(); // 1 unit, works now
```

There is no such fallback with `accessToken`: the token you give is always sent.

## How credentials travel

- The API key goes in the `X-Goog-Api-Key` header, never in a URL.
- An access token goes in the `Authorization` header. `yt.reporting.download()` refuses a download URL on any host other than `youtubereporting.googleapis.com`.
- URLs in errors and in [client events](/basics/configuration/) have credentials removed.
- Nothing is written to disk unless you use `tokenFile()` from `@ix-xs/youtube.api/node`.
- With `baseUrl`, the Data API requests and their credentials go to the host you name. See [Configuration](/basics/configuration/).

## What is refused before it is sent

The client knows which methods and parameters need OAuth, and which scopes each method accepts. It checks before sending. A refused call throws a `YouTubeAuthError`. Nothing is sent to the API and no quota is spent.

| `error.code` | Thrown when |
| --- | --- |
| `MISSING_CREDENTIALS` | The call needs OAuth and there is no token. Or the client has no credentials at all |
| `INSUFFICIENT_SCOPE` | The scopes of the token are known, the method accepts none of them, and the call cannot go out with the key |
| `OAUTH_ERROR` | The `OAuth2` client holds an expired access token and no refresh token |

`error.scopes` lists the scopes that would have worked:

```ts
const yt = new YouTube({ apiKey });

try {
  await yt.playlists.insert({ body: { snippet: { title: "Favourites" } } });
} catch (error) {
  if (error instanceof YouTubeAuthError) {
    console.log(error.code); // "MISSING_CREDENTIALS"
    // ["youtube", "youtube.force-ssl", "youtubepartner"]
    console.log(error.scopes);
  }
}
```

The scope check needs to know what the user granted. An `OAuth2` client knows it from the `scope` field of its tokens. With `accessToken`, on the client or on one call, the library cannot tell: the call is sent and the API answers. [Scopes](/auth/scopes/) lists what each scope allows.

## Creating an OAuth client

1. In the Google Cloud console, enable **YouTube Data API v3** for the project, as for an API key.
2. Configure the OAuth consent screen of the project.
3. Create an OAuth client and pick its application type.

| Application type | For | Notes |
| --- | --- | --- |
| Web application | A server that receives the redirect | List every redirect URI. It must match `redirectUri` character for character |
| Desktop app | A script or a command-line tool on your machine | Accepts any loopback redirect, which is what `authorize()` uses |
| TVs and Limited Input devices | A device without a browser or a keyboard | Required by the device flow, `oauth.requestDeviceCode()` |

The OAuth client has a client id and a client secret. Keep the secret on a server. A client without a secret (browser, mobile, desktop) relies on PKCE, which `oauth.authUrl()` turns on by default.

## The "Testing" status

While the consent screen of your app has the status **Testing**, two things hold:

- Only the accounts you list as test users can give consent.
- Its refresh tokens expire after 7 days.

:::caution
A script that worked for a week and then fails to refresh has likely met this. The refresh throws a `YouTubeAuthError` with the code `OAUTH_ERROR` and `error.oauthError === "invalid_grant"`. Send the user through consent again. To get refresh tokens that last, take the app out of the Testing status.
:::

```ts
try {
  await yt.channels.mine(); // 1 unit
} catch (error) {
  const expired =
    error instanceof YouTubeAuthError && error.oauthError === "invalid_grant";
  if (!expired) throw error;
  // The refresh token is no longer valid: start the consent flow again.
}
```

## Reference

| Option of `new YouTube()` | Type | Notes |
| --- | --- | --- |
| `apiKey` | `string` | Falls back on `YOUTUBE_API_KEY` when left out |
| `oauth` | `OAuth2 \| OAuth2Options` | Refreshes tokens on its own. Available afterwards as `yt.oauth` |
| `accessToken` | `string \| (() => string \| Promise<string>)` | No refresh, no local scope check |

| Request option | Type | Notes |
| --- | --- | --- |
| `accessToken` | `string` | Uses this token for one call, instead of the client's credentials. No local scope check |

| Error | `code` | Useful fields |
| --- | --- | --- |
| `YouTubeAuthError` | `MISSING_CREDENTIALS` | `scopes` |
| `YouTubeAuthError` | `INSUFFICIENT_SCOPE` | `scopes` |
| `YouTubeAuthError` | `OAUTH_ERROR` | `oauthError`, for example `"invalid_grant"` |
| `YouTubeApiError` | From the HTTP status | `reason` when the API rejects the key: `keyInvalid`, `keyExpired`, `accessNotConfigured`, `ipRefererBlocked` |

## See also

- [OAuth](/auth/oauth/): the consent flow, token storage and refresh.
- [Scripts and devices](/auth/scripts-and-devices/): `authorize()` and the device flow.
- [Scopes](/auth/scopes/): which scope each kind of call needs.
- [Errors](/basics/errors/): every error code, and what is retried.
