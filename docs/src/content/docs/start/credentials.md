---
title: Credentials
description: What an API key is enough for, what needs OAuth, and how to create both in the Google Cloud console. A call your credentials cannot make is refused before it is sent, so it costs no quota.
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

An API key identifies your Google Cloud project, not a user. It reads public data and nothing else.

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

The helpers built on those methods work with a key too: `yt.channels.get`, `yt.channels.latestVideos`, `yt.videos.get`, `yt.playlists.items`, `yt.search.videos`, `yt.liveChatOf` and the others that only read.

A key is never enough for:

- Any write: uploads, playlist edits, comments, ratings, subscriptions.
- The other 63 methods of the Data API, live broadcasts and captions included.
- The Analytics API and the Reporting API.
- A read that asks for the user's own data. On the methods above, these parameters need OAuth: `mine`, `myRating`, `mySubscribers`, `myRecentSubscribers`, `forMine`, `home`, `managedByMe`, `forContentOwner`, `forDeveloper`, `onBehalfOfContentOwner`, `onBehalfOfContentOwnerChannel`.

[Every method](/reference/methods/) says what each call accepts.

## Creating an API key

1. Open the [Google Cloud console](https://console.cloud.google.com/) and create a project, or pick one.
2. In **APIs & Services > Library**, enable **YouTube Data API v3**. Without it, calls fail with the reason `accessNotConfigured`.
3. In **APIs & Services > Credentials**, choose **Create credentials > API key**.
4. Restrict the key before you use it. The next section says how.

Quota belongs to the project, not to the key. Two keys of one project share the same daily budget. [Quota](/basics/quota/) has the numbers.

## Restricting the key

Open the key in **APIs & Services > Credentials**. There are two kinds of restriction, and you want both.

| Restriction | Setting | Use it when |
| --- | --- | --- |
| API restrictions | **Restrict key**, then select **YouTube Data API v3** | Always. A leaked key then cannot be used on the other APIs of your project |
| Application restrictions | **IP addresses** | The key runs on a server with a known address |
| Application restrictions | **Websites** (HTTP referrers) | The key ships in a web page |

A key in a web page is public. Anyone can read it in the network tab of their browser, and a referrer restriction is the only thing that stops them from spending your quota elsewhere. If you can, keep the key on a server and call the API from there.

On a server, keep the key out of the code and out of the repository. Put it in an environment variable.

## The `YOUTUBE_API_KEY` fallback

When you give the client no credentials at all, it reads the `YOUTUBE_API_KEY` environment variable:

```ts
const yt = new YouTube(); // uses process.env.YOUTUBE_API_KEY
```

The variable is read whenever `apiKey` is left out, also next to `oauth` or `accessToken`. Public reads then work with the key before the user has signed in.

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
const client = new OAuth2({ clientId, clientSecret, tokens: savedTokens, onTokens: saveTokens });
const withOAuth = new YouTube({ oauth: client });

// 3. A token you got elsewhere. A function is called before every request.
const withToken = new YouTube({ accessToken: () => session.accessToken as string });
```

When you pass options instead of an instance, the client builds the `OAuth2` object and exposes it as `yt.oauth`. [OAuth](/auth/oauth/) covers the consent flow, and [Scripts and devices](/auth/scripts-and-devices/) the flows that need no web server.

One call can use another token than the client's, with the `accessToken` request option:

```ts
const mine = await yt.channels.mine({ accessToken: session.accessToken });
```

For a server that holds the tokens of many users, [`yt.as()`](/auth/many-users/) is the better tool.

## A key and a token together

You can set `apiKey` next to `oauth` or `accessToken`. The rules are:

- When a token is available, it is used. A token sees everything a key sees, plus the user's private data.
- When the `OAuth2` client has no usable token (no access token or an expired one, and no refresh token), a public read is sent with the key.
- A call that needs OAuth never falls back on the key. It is refused, see below.

That makes one client enough for an app where signing in is optional:

```ts
const oauth = new OAuth2({ clientId, clientSecret, redirectUri: "https://example.com/oauth/callback" });
const yt = new YouTube({ apiKey, oauth });

await yt.videos.get(videoId); // no tokens yet: sent with the key

await oauth.exchange(code, { codeVerifier });
await yt.videos.get(videoId); // sent with the user's token
await yt.channels.mine(); // works now
```

There is no such fallback with `accessToken`: the token you give is always sent.

## How credentials travel

- The API key goes in the `X-Goog-Api-Key` header. It is never put in a URL, so it does not end up in access logs or in a `Referer` header.
- An access token goes in the `Authorization` header, to Google's API hosts. `yt.reporting.download()` refuses any other host.
- URLs in errors and in [client events](/basics/configuration/) have credentials removed.
- Nothing is written to disk unless you call `tokenFile()` from `@ix-xs/youtube.api/node`.

If you set `baseUrl` to go through a proxy, the Data API requests and their credentials go to that proxy. Only point it at a host you control.

## What is refused before it is sent

The client knows which methods and parameters need OAuth, and which scopes each method accepts. It checks before sending. A refused call throws a `YouTubeAuthError`, makes no request and costs no quota.

| `error.code` | Thrown when |
| --- | --- |
| `MISSING_CREDENTIALS` | The call needs OAuth and there is no token. Or the client has no credentials at all |
| `INSUFFICIENT_SCOPE` | The token's scopes are known and none of them is accepted by the method |

`error.scopes` lists the scopes that would have worked:

```ts
const yt = new YouTube({ apiKey });

try {
  await yt.playlists.insert({ body: { snippet: { title: "Favourites" } } });
} catch (error) {
  if (error instanceof YouTubeAuthError) {
    console.log(error.code); // "MISSING_CREDENTIALS"
    console.log(error.scopes); // ["youtube", "youtube.force-ssl", "youtubepartner"]
  }
}
```

The scope check needs to know what the user granted. An `OAuth2` client knows it from the `scope` field of its tokens. With a bare `accessToken` the library cannot tell, so the call is sent and the API answers. [Scopes](/auth/scopes/) lists what each scope allows.

## Creating an OAuth client

1. In the Google Cloud console, enable the APIs you call: **YouTube Data API v3**, and **YouTube Analytics API** or **YouTube Reporting API** if you use them.
2. Configure the OAuth consent screen: an app name, a support email, the audience, and the scopes you request.
3. In **APIs & Services > Credentials**, choose **Create credentials > OAuth client ID** and pick an application type.

| Application type | For | Notes |
| --- | --- | --- |
| Web application | A server that receives the redirect | List every redirect URI. It must match `redirectUri` character for character |
| Desktop app | A script or a command-line tool on your machine | Accepts any loopback redirect, which is what `authorize()` uses |
| TVs and Limited Input devices | A device without a browser or a keyboard | Required by the device flow, `oauth.requestDeviceCode()` |

Google gives you a client id and a client secret. Keep the secret on the server. A client without a secret (browser, mobile, desktop) relies on PKCE, which `oauth.authUrl()` turns on by default.

## The "Testing" status

A new consent screen for external users starts with the publishing status **Testing**. Two things follow:

- Only the accounts you list as test users can give consent.
- Google expires the refresh tokens of such an app after 7 days.

:::caution
A script that worked for a week and then fails to refresh is almost always this. The refresh throws a `YouTubeAuthError` with the code `OAUTH_ERROR` and `error.oauthError === "invalid_grant"`. Send the user through consent again, or publish the app (status **In production**) to get refresh tokens that last.
:::

```ts
try {
  await yt.channels.mine();
} catch (error) {
  if (error instanceof YouTubeAuthError && error.oauthError === "invalid_grant") {
    // The refresh token is no longer valid: start the consent flow again.
  } else {
    throw error;
  }
}
```

## Reference

| Option of `new YouTube()` | Type | Notes |
| --- | --- | --- |
| `apiKey` | `string` | Falls back on `YOUTUBE_API_KEY` when no credentials are given |
| `oauth` | `OAuth2 \| OAuth2Options` | Refreshes tokens on its own. Available afterwards as `yt.oauth` |
| `accessToken` | `string \| (() => string \| Promise<string>)` | No refresh, no local scope check |

| Request option | Type | Notes |
| --- | --- | --- |
| `accessToken` | `string` | Uses this token for one call, instead of the client's credentials |

| Error | `code` | Useful fields |
| --- | --- | --- |
| `YouTubeAuthError` | `MISSING_CREDENTIALS` | `scopes` |
| `YouTubeAuthError` | `INSUFFICIENT_SCOPE` | `scopes` |
| `YouTubeAuthError` | `OAUTH_ERROR` | `oauthError`, for example `"invalid_grant"` |
| `YouTubeApiError` | From the HTTP status | `reason` when Google rejects the key: `keyInvalid`, `keyExpired`, `accessNotConfigured`, `ipRefererBlocked` |

## See also

- [OAuth](/auth/oauth/): the consent flow, token storage and refresh.
- [Scripts and devices](/auth/scripts-and-devices/): `authorize()` and the device flow.
- [Scopes](/auth/scopes/): which scope each kind of call needs.
- [Errors](/basics/errors/): every error class and code.
