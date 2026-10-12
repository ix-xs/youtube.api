---
title: Serving many users
description: Keep one client for the whole server and derive a client per user from it. They share the cache, the quota count and the settings, but not the credentials.
sidebar:
  order: 4
---

```ts
const yt = new YouTube({ apiKey, cache: true });

app.get("/me", async (req, res) => {
  const user = yt.as(req.session.accessToken);
  res.json(await user.channels.mine());
});
```

A server that holds the tokens of many users should not build a full client per user: each would have its own cache and its own quota count. Create one client at startup, then call `yt.as()` in each request.

## Deriving a client per user

`yt.as(credentials)` returns a new `YouTube` that acts for another user. It takes one of three things:

```ts
// An access token.
const fromToken = yt.as(session.accessToken);
// A function that returns one.
const fromFunction = yt.as(() => db.tokens.fresh(session.userId));
// An OAuth2 object: tokens refresh on their own.
const fromOAuth = yt.as(oauth);
```

Creating one sends nothing, so it can be done on every request.

| | Shared with the base client |
| --- | --- |
| Response cache | Yes, the same store and the same freshness rules |
| Quota count | Yes, `user.quota` is the same object as `yt.quota` |
| Events | Yes, a listener added with `yt.on()` sees the calls of every derived client |
| Settings | Yes: `apiKey`, `retry`, `timeout`, `fetch`, `baseUrl`, `headers`, `quotaUser`, `onBehalfOfContentOwner` |
| Credentials | No. The `oauth` or `accessToken` of the base client is replaced by what you pass |

A second argument changes the three settings that can differ per user: `quotaUser`, `headers` and `onBehalfOfContentOwner`. `headers` given there replace those of the base client, they are not merged with them.

```ts
const user = yt.as(session.accessToken, { quotaUser: session.userId });
```

The three kinds of credentials do not behave the same:

| Passed to `as()` | Refresh | Replay after a 401 | [Scope check](/auth/scopes/#how-the-client-checks-scopes) |
| --- | --- | --- | --- |
| A token string | No | No | No |
| A function | Yours: it is called before each request | No | No |
| An `OAuth2` object | Automatic | Once | Yes, when the tokens carry their `scope` |

A token string suits a setup where something else, a session library or an identity provider, already keeps the access token fresh. Otherwise use `OAuth2`.

## One `OAuth2` per user

Build an `OAuth2` for the user of the request, with their tokens loaded from your storage and an `onTokens` that saves them back under the same user.

```ts
import { OAuth2, type Tokens } from "@ix-xs/youtube.api";

function oauthFor(userId: string, tokens?: Tokens): OAuth2 {
  return new OAuth2({
    clientId,
    clientSecret,
    redirectUri: "https://example.com/oauth/callback",
    tokens,
    onTokens: (next) => db.tokens.set(userId, next),
  });
}

const tokens = await db.tokens.get(session.userId);
const user = yt.as(oauthFor(session.userId, tokens));
```

Everything [OAuth 2.0](/auth/oauth/) describes then works per user: the access token is refreshed before it expires, the new tokens go through `onTokens` into the right row, and a failed save fails the call instead of losing the tokens.

An `OAuth2` object holds no connection, so building one per request is fine. Requests of the same user that arrive together then each have their own, and each may refresh on its own. To make them share one refresh, keep one instance per user in a map and evict it when the user signs out.

:::danger
Never share one `OAuth2` object between users. `setTokens()` can switch it to another user, but a request is not atomic: between two of its `await`s another request can swap the tokens, and the first one carries on as the wrong person. `onTokens` would also have no way to know whose tokens it is saving.
:::

## A complete example

Sign-in, the callback, and a page of private data. `app`, `req` and `res` stand for your framework, `session` for the visitor's session, and `db` for your storage.

```ts
import {
  OAuth2,
  YouTube,
  YouTubeAuthError,
  type Tokens,
} from "@ix-xs/youtube.api";

const yt = new YouTube({
  apiKey: process.env.YOUTUBE_API_KEY,
  cache: { ttl: "5m" },
  quota: { enforce: true },
});

function oauthFor(userId: string, tokens?: Tokens): OAuth2 {
  return new OAuth2({
    clientId: process.env.GOOGLE_CLIENT_ID!,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
    redirectUri: "https://example.com/oauth/callback",
    tokens,
    onTokens: (next) => db.tokens.set(userId, next),
  });
}

app.get("/login", async (req, res) => {
  const { url, state, codeVerifier } = await oauthFor(session.userId).authUrl({
    scopes: ["youtube.readonly"],
  });
  session.oauthState = state;
  session.codeVerifier = codeVerifier;
  res.redirect(url);
});

app.get("/oauth/callback", async (req, res) => {
  if (!session.oauthState || req.query.state !== session.oauthState) {
    return res
      .status(400)
      .send("This answer does not belong to your session.");
  }
  // exchange() calls onTokens, which stores the tokens for this user.
  await oauthFor(session.userId).exchange(req.query.code, {
    codeVerifier: session.codeVerifier,
  });
  res.redirect("/playlists");
});

app.get("/playlists", async (req, res) => {
  const tokens = await db.tokens.get(session.userId);
  if (!tokens) return res.redirect("/login");

  const user = yt.as(oauthFor(session.userId, tokens));
  try {
    const playlists = await user.playlists
      .list({ part: "snippet", mine: true })
      .all({ limit: 200 });
    res.json(
      playlists.map((playlist) => ({
        id: playlist.id,
        title: playlist.snippet.title,
      })),
    );
  } catch (error) {
    if (
      error instanceof YouTubeAuthError &&
      error.oauthError === "invalid_grant"
    ) {
      // The user revoked the access, or the refresh token expired.
      await db.tokens.delete(session.userId);
      return res.redirect("/login");
    }
    throw error;
  }
});
```

`playlists.list` costs 1 quota unit per page of 50, so this route spends 1 to 4 units per visit that is not served from the cache.

## A token for a single call

Every call takes request options as its last argument, and `accessToken` is one of them. It replaces the credentials of the client for that call only.

```ts
const mine = await yt.channels.mine({ accessToken: session.accessToken });

const page = await yt.playlists.list(
  { part: "snippet", mine: true },
  { accessToken: session.accessToken },
);
```

It behaves like `yt.as(token)` for one call: no refresh, no replay after a 401, no scope check. Use it for the odd call on behalf of someone. For several calls in a row, `as()` reads better and cannot be forgotten on one of them.

## The cache keeps users apart

A cached response belongs to the credentials that fetched it. Calls made with the API key share their entries. Calls made with a token are stored per user, and two users never read each other's entries. [Caching](/basics/caching/) explains how.

On a server, two things follow:

1. **Public data is only shared when it is read with the key.** A derived client sends the user's token whenever it can, public reads included, so `user.videos.get(id)` is cached for that user alone. Read public data through the base client to let all users share the entry.
2. **A bare access token is its own identity.** With `yt.as(accessToken)`, a new access token for the same user starts with an empty cache. An `OAuth2` client is identified by its refresh token, so its entries survive each refresh.

```ts
app.get("/videos/:id", async (req, res) => {
  const user = yt.as(session.accessToken);

  // Public: read with the key, cached once for all visitors.
  const video = await yt.videos.get(req.params.id);
  // Private: read with the token, cached for this user.
  const rating = await user.videos.ratingOf(req.params.id);

  res.json({ title: video?.snippet.title, rating });
});
```

`videos.get` and `videos.ratingOf` cost 1 unit each.

## Quota is per project, not per user

The daily quota belongs to your Google Cloud project. Every user of your server draws from it, which is why derived clients share one count:

```ts
yt.quota.used; // default bucket, base client and derived ones together
yt.quota.remaining("search.list");

yt.on("quota", ({ method, bucket, cost, remaining }) => {
  if (bucket === "default" && remaining < 500) {
    console.warn(`${method} cost ${cost}, ${remaining} units left today`);
  }
});
```

With `quota: { enforce: true }` on the base client, a call that would go over the limit is refused before it is sent, whoever it is for. The count is local to the process. [Quota](/basics/quota/) explains how to carry it across restarts.

### `quotaUser`

`quotaUser` is a key of at most 40 characters that is sent to Google with the request, for server apps that enforce per-user limits. It can be set on the client for all requests, or per call:

```ts
const user = yt.as(session.accessToken);

await user.channels.mine({ quotaUser: session.userId });
```

A derived client inherits the `quotaUser` of the base client like any other setting, unless you give it its own as the second argument of `as()`. None of this splits the local count: `yt.quota` stays a total.

`quotaUser` is part of the request URL. Cached reads made with different values do not share an entry, even with the API key.

## Reference

| API | What it does |
| --- | --- |
| `yt.as(token)` | Derived client that sends this access token |
| `yt.as(() => token)` | Derived client that calls the function before each request. It may return a promise |
| `yt.as(oauth)` | Derived client that uses this `OAuth2` object. Available as `user.oauth` |
| `yt.as(credentials, overrides)` | The same, with its own `quotaUser`, `headers` or `onBehalfOfContentOwner` |
| `{ accessToken }` request option | Uses this token for one call, instead of the client's credentials |
| `{ quotaUser }` request option | Per-user quota key for one call, at most 40 characters |
| `quotaUser` client option | The same key for every request of the client |

Errors you should expect in a route:

| Error | Meaning | What to do |
| --- | --- | --- |
| `YouTubeAuthError`, `oauthError: "invalid_grant"` | The refresh token of this user no longer works | Delete the tokens, send the user to consent |
| `YouTubeAuthError`, code `INSUFFICIENT_SCOPE` | The user did not grant a scope the method accepts | [Ask for it](/auth/scopes/#asking-for-more-later) |
| `YouTubeApiError`, code `UNAUTHORIZED` | A plain access token expired or was revoked | Get a new token from whatever issued it |
| `YouTubeQuotaBudgetError` | `enforce` refused the call: the project is out of budget for today | Answer with an error page, retry after `error.resetsAt` |

## See also

- [OAuth 2.0](/auth/oauth/): the flow, refresh, and `onTokens`.
- [Scopes](/auth/scopes/): asking each user for what your feature needs.
- [Caching](/basics/caching/) and [Quota](/basics/quota/): the two things derived clients share.
- [Configuration](/basics/configuration/): the settings a derived client inherits.
