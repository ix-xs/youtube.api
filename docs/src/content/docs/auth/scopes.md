---
title: Scopes
description: A scope says what a token may do. Pick the narrowest one that covers your calls, and let the client refuse a call the token cannot make before it is sent.
sidebar:
  order: 3
---

```ts
import { Scopes } from "@ix-xs/youtube.api";

// Short names and the constant are interchangeable.
await oauth.authUrl({ scopes: ["youtube.readonly", "youtube.upload"] });
await oauth.authUrl({ scopes: [Scopes.readonly, Scopes.upload] });
```

A scope is chosen when you build the consent URL. The user sees it on the consent screen, and the tokens that come back are limited to it. Every method of the API accepts a set of scopes: a token needs one of them.

## The scopes

Everywhere a scope is expected you can write the short name, the full URL, or the matching key of `Scopes`.

| Short name | `Scopes` key | What it allows |
| --- | --- | --- |
| `youtube.readonly` | `readonly` | View the YouTube account |
| `youtube` | `manage` | Manage the account: reads and writes, except comments and captions |
| `youtube.force-ssl` | `forceSsl` | Everything `youtube` does, plus comments and captions |
| `youtube.upload` | `upload` | Upload videos, thumbnails, banners and watermarks |
| `youtube.channel-memberships.creator` | `channelMemberships` | See a channel's current members, their level and join date |
| `yt-analytics.readonly` | `analytics` | View YouTube Analytics reports |
| `yt-analytics-monetary.readonly` | `analyticsMonetary` | View YouTube Analytics monetary reports |
| `youtubepartner` | `partner` | View and manage assets and content, for content partners |
| `youtubepartner-channel-audit` | `partnerChannelAudit` | View private channel information relevant to a partner audit |

Short names are typed, so the editor completes them. The full URL is `https://www.googleapis.com/auth/` followed by the short name.

## Which scope to pick

| You want to | Ask for | Notes |
| --- | --- | --- |
| Read the user's own channel, playlists, subscriptions, ratings | `youtube.readonly` | Covers the reads, except comments, captions and channel members |
| Create playlists, subscribe, rate, edit or delete videos | `youtube` | |
| Upload a video, set a thumbnail, a banner or a watermark | `youtube.upload` | Only those four methods. Editing the video afterwards needs `youtube` |
| Read, post, edit or moderate comments | `youtube.force-ssl` | The only scope the comment methods accept |
| List, download, upload or delete captions | `youtube.force-ssl` | |
| Schedule broadcasts, send or moderate live chat | `youtube` | `youtube.readonly` is enough to list broadcasts and read a chat |
| List channel members and membership levels | `youtube.channel-memberships.creator` | The only scope those two methods accept |
| Query Analytics, run Reporting jobs | `yt-analytics.readonly` | |
| Query revenue metrics | `yt-analytics-monetary.readonly` | |

Two rules of thumb:

- `youtube.force-ssl` is accepted by nearly every Data API method. The exceptions are the two membership methods and the partner-only `thirdPartyLinks` methods. It is the one to ask for when an app does a bit of everything, comments included.
- A narrower scope makes a shorter consent screen. An app that only reads should ask for `youtube.readonly`.

Reading comments in public is a special case. `commentThreads.list` works with an API key. With a token it only accepts `youtube.force-ssl`, so a client that holds a `youtube.readonly` token cannot use that token to read comments.

## How the client checks scopes

Before sending a call, the client compares the scopes of the token with the scopes the method accepts. If none matches, the call throws a `YouTubeAuthError` with the code `INSUFFICIENT_SCOPE`. Nothing was sent, so no quota was spent. One exception: a public read on a client that also has an API key goes out with the key instead of failing.

```ts
try {
  await yt.commentThreads.post(videoId, "Nice one");
} catch (error) {
  if (error instanceof YouTubeAuthError && error.code === "INSUFFICIENT_SCOPE") {
    console.log(error.scopes); // ["youtube.force-ssl"]: any of these would have worked
    console.log(error.message); // names the method, the accepted scopes and the ones the token has
  } else {
    throw error;
  }
}
```

The check needs to know what the token holds. It runs when both of these are true:

- The client was created with `oauth`.
- The tokens carry their `scope` string. That is the case when you store the tokens whole, as `exchange()`, `authorize()` and the device flow return them. `oauth.grantedScopes` is then a set of short names.

It is skipped in these cases, because the scopes are unknown:

- The tokens have no `scope`, for example when you only stored the refresh token.
- The client was created with a plain `accessToken`.
- The call carries its own `accessToken` request option.

A skipped check does not make the call work. The API then refuses it itself: a `YouTubeApiError` with the reason `insufficientPermissions`, after a round trip.

To give the check its data when you only kept a refresh token, store the whole `Tokens` object instead, as [Storing tokens](/auth/oauth/#storing-tokens) shows.

## Finding the scopes of a method

Three places, from the closest to your code to the furthest:

1. **In the editor.** Hover a method. Its description has a line such as "Auth: OAuth, with one of `youtube`, `youtube.force-ssl`, `youtubepartner`".
2. **In code.** `METHODS` holds the same facts as data.
3. **On this site.** [Every method](/reference/methods/) says for each method whether an API key is enough or OAuth is required.

```ts
import { METHODS } from "@ix-xs/youtube.api";

METHODS["videos.rate"].scopes; // ["youtube", "youtube.force-ssl", "youtubepartner"]
METHODS["videos.rate"].auth; // "oauth": an API key can never be enough
METHODS["videos.list"].auth; // "any": a key works for public data
```

With `METHODS` you can ask the same question as the client, for example to hide a button the current user cannot use:

```ts
import { METHODS, type MethodId } from "@ix-xs/youtube.api";

function canCall(method: MethodId): boolean {
  const granted = oauth.grantedScopes;
  const accepted = METHODS[method].scopes;
  if (!granted || accepted.length === 0) return true; // unknown: let the API decide
  return accepted.some((scope) => granted.has(scope));
}

canCall("playlists.insert");
```

## Asking for more later

You do not have to request everything at sign-in. Ask for `youtube.readonly` first, and for a write scope the day the user reaches a feature that needs it.

```ts
// At sign-in.
const first = await oauth.authUrl({ scopes: ["youtube.readonly"] });

// Later, when the user wants to upload.
const second = await oauth.authUrl({ scopes: ["youtube.upload"] });
```

`includeGrantedScopes` is `true` by default: it asks Google to keep the scopes the user granted earlier in addition to the new ones. After the second exchange, one set of tokens covers both. Pass `includeGrantedScopes: false` to get tokens limited to the scopes of that request.

The `INSUFFICIENT_SCOPE` error is a good trigger for it. In a route, with `app`, `req`, `res` and `session` standing for your application:

```ts
app.post("/videos/:id/like", async (req, res) => {
  try {
    await yt.videos.like(req.params.id);
    res.sendStatus(204);
  } catch (error) {
    if (!isYouTubeError(error, "INSUFFICIENT_SCOPE")) throw error;

    const { url, state, codeVerifier } = await oauth.authUrl({ scopes: ["youtube"] });
    session.oauthState = state;
    session.codeVerifier = codeVerifier;
    res.redirect(url);
  }
});
```

The callback route is the one from [OAuth 2.0](/auth/oauth/#handling-the-callback).

## Getting the identity too

The OpenID Connect scopes `openid`, `email` and `profile` are accepted next to the YouTube ones. With `openid`, the tokens carry an `idToken`. With an identity scope, `tokenInfo()` returns the `email` of the account.

```ts
await oauth.authUrl({ scopes: ["youtube.readonly", "openid", "email"] });
```

## Converting names

`scopeUrl` expands a short name to the URL Google expects. `scopeName` does the reverse. You need them when you talk to Google's endpoints yourself, or when you compare scopes that come from another library.

```ts
scopeUrl("youtube.readonly"); // "https://www.googleapis.com/auth/youtube.readonly"
scopeUrl("openid"); // "openid": OpenID Connect scopes are left as they are
scopeUrl(Scopes.upload); // a full URL is returned unchanged

scopeName("https://www.googleapis.com/auth/youtube.upload"); // "youtube.upload"
```

The library always reports short names: in `oauth.grantedScopes`, in `tokenInfo().scopes`, in `METHODS[id].scopes` and in `error.scopes`.

## Reference

| Export | What it is |
| --- | --- |
| `Scopes` | Frozen object mapping a key (`readonly`, `upload`, ...) to the full scope URL |
| `scopeUrl(scope)` | Short name to URL |
| `scopeName(scope)` | URL to short name |
| `Scope` | Type of a scope: a short name, a full URL, `"openid"`, `"email"`, `"profile"`, or any string |
| `ShortScope` | Union of the nine short names |
| `METHODS[id].scopes` | Scopes a method accepts, short names |
| `METHODS[id].auth` | `"oauth"` when an API key can never be enough, `"any"` otherwise |

| Where scopes show up | Type |
| --- | --- |
| `oauth.grantedScopes` | `ReadonlySet<string> \| undefined` |
| `(await oauth.tokenInfo()).scopes` | `string[]` |
| `oauth.tokens.scope` | `string \| undefined`, space separated, as Google returns them |
| `YouTubeAuthError.scopes` | `readonly string[]`: the scopes that would have allowed the call |

## See also

- [OAuth 2.0](/auth/oauth/): where `scopes` is passed.
- [Every method](/reference/methods/): which methods need OAuth at all.
- [Errors](/basics/errors/): `YouTubeAuthError` and the other classes.
- [Scripts and devices](/auth/scripts-and-devices/): the device flow accepts fewer scopes.
