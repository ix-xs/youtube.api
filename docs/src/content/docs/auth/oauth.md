---
title: OAuth 2.0
description: Send a user through Google's consent screen, trade the code for tokens, and let the client keep them fresh. Needed for private data and for every write.
sidebar:
  order: 1
---

```ts
import { OAuth2, YouTube } from "@ix-xs/youtube.api";

const oauth = new OAuth2({
  clientId: process.env.GOOGLE_CLIENT_ID!,
  clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
  redirectUri: "https://example.com/oauth/callback",
  tokens: await loadTokens(), // saved by an earlier run, or undefined
  onTokens: saveTokens, // called after every exchange and refresh
});

const yt = new YouTube({ oauth });
const me = await yt.channels.mine();
```

An API key reads public data. Anything private (`mine`, your subscriptions, analytics) and every write (playlists, comments, uploads) needs a user's consent. `OAuth2` handles that: the consent URL, the code exchange, the refresh and the revocation.

This page follows one account from consent to API calls. A server where every visitor connects their own account needs one `OAuth2` per user: read [Serving many users](/auth/many-users/) after this page. A script on your own machine can skip the routes below: see [Scripts and devices](/auth/scripts-and-devices/).

## Creating the OAuth client

You need an OAuth client from the Google Cloud console, with your callback URL among its redirect URIs. [Credentials](/start/credentials/) shows where to create it.

```ts
const oauth = new OAuth2({
  clientId,
  clientSecret,
  redirectUri: "https://example.com/oauth/callback",
});
```

`redirectUri` must match one configured on the Google side, character for character. `clientSecret` can be left out for a public client (browser, mobile, desktop) that relies on PKCE.

Nothing is sent to Google at this point. The object holds the settings and, later, the tokens.

## Sending the user to Google

`authUrl()` builds the consent URL. It returns three values:

```ts
const { url, state, codeVerifier } = await oauth.authUrl({
  scopes: ["youtube.readonly"],
});
```

| Value | What to do with it |
| --- | --- |
| `url` | Redirect the user there |
| `state` | Keep it for this visitor. Google echoes it back, and comparing the two blocks CSRF |
| `codeVerifier` | Keep it for this visitor. `exchange()` needs it. `undefined` when PKCE is off |

Both `state` and `codeVerifier` belong in the visitor's session or in a cookie only your server can read. They are useless after the callback.

`scopes` takes short names, full URLs or the `Scopes` constant. [Scopes](/auth/scopes/) lists them and says which one a task needs.

The defaults are the ones a server wants:

- `accessType: "offline"` asks for a refresh token, so the app keeps working when the user is away.
- `pkce: true` adds a PKCE challenge. It is required for clients without a secret and recommended for all.
- `includeGrantedScopes: true` keeps the scopes the user granted earlier next to the new ones.
- `state` is generated when you do not pass one.

```ts
const { url } = await oauth.authUrl({
  scopes: ["youtube.readonly", "youtube.upload"],
  prompt: "consent", // show the consent screen even to a returning user
  loginHint: "someone@example.com", // preselect this account
  state: "my-own-opaque-value",
});
```

## Handling the callback

Google sends the user back to your redirect URI with `code` and `state` in the query string, or with `error` when they refused. Check `state`, then trade the code for tokens with `exchange()`.

In the example, `app`, `req` and `res` stand for your framework, and `session` for wherever you keep per-visitor state.

```ts
app.get("/login", async (req, res) => {
  const { url, state, codeVerifier } = await oauth.authUrl({ scopes: ["youtube.readonly"] });
  session.oauthState = state;
  session.codeVerifier = codeVerifier;
  res.redirect(url);
});

app.get("/oauth/callback", async (req, res) => {
  if (!session.oauthState || req.query.state !== session.oauthState) {
    return res.status(400).send("This answer does not belong to your session.");
  }
  if (req.query.error) {
    return res.status(400).send(`Google answered: ${req.query.error}`);
  }

  await oauth.exchange(req.query.code, { codeVerifier: session.codeVerifier });
  session.oauthState = session.codeVerifier = undefined;
  res.redirect("/");
});
```

`exchange()` stores the tokens on the `OAuth2` object, calls `onTokens`, and returns them. A code works once. Exchanging it a second time fails with `invalid_grant`.

If you passed a `redirectUri` to `authUrl()` to override the one of the client, pass the same one to `exchange()`.

## Giving it to the client

Pass the `OAuth2` object to the client:

```ts
const yt = new YouTube({ oauth });
```

Or pass the options and let the client build it. It is then available as `yt.oauth`:

```ts
const yt = new YouTube({
  oauth: { clientId, clientSecret, tokens: savedTokens, onTokens: saveTokens },
});

yt.oauth?.canRefresh; // true once there is a refresh token
```

You can set `apiKey` next to `oauth`. A token wins when both are usable. While the `OAuth2` object has no usable token yet, public reads go out with the key, so the same client serves the pages before and after sign-in.

## Automatic refresh

From here on you do not handle access tokens. Before each request the client asks `OAuth2` for a valid one.

- An access token that is missing, or that expires within 60 seconds, is refreshed first.
- If the API still answers 401, the token is refreshed once and the call is replayed.
- Calls that need a refresh at the same moment share one request to Google.

A refresh needs a refresh token. Without one, an expired access token ends the session: the call throws a `YouTubeAuthError` with the code `OAUTH_ERROR`, and the user has to consent again.

## Storing tokens

Tokens are plain data. Store them as JSON and give them back at the next start.

```ts
const oauth = new OAuth2({
  clientId,
  clientSecret,
  tokens: await db.tokens.get("main"),
  onTokens: async (tokens) => {
    await db.tokens.set("main", tokens);
  },
});
```

`onTokens` runs after an exchange and after each refresh, with the complete set of tokens. Google only sends the refresh token on first consent, so the library carries the one it has into every later set: saving what you receive is always enough.

`onTokens` is awaited. If it throws, the call that triggered it fails with a `YouTubeAuthError` whose `cause` is your error. This is deliberate: tokens that could not be saved are not lost silently.

To observe changes without being part of the call, subscribe with the method of the same name. It is not awaited and returns a function that unsubscribes:

```ts
const stop = oauth.onTokens((tokens) => {
  console.log("Access token valid until", new Date(tokens.expiresAt ?? 0));
});

stop();
```

:::caution
A refresh token gives lasting access to the account. Store it like a password, and keep it out of logs and out of the browser.
:::

## Reading the session

```ts
oauth.tokens; // { accessToken, refreshToken, expiresAt, scope, tokenType, idToken }
oauth.canRefresh; // true when there is a refresh token
oauth.isExpired; // true when the access token is missing or expires within 60 seconds
oauth.grantedScopes; // Set { "youtube.readonly" }, or undefined when the tokens do not say
```

These read local state and cost nothing. `tokenInfo()` asks Google instead, which is how you check a token you did not create yourself:

```ts
const info = await oauth.tokenInfo();

info.clientId; // the OAuth client the token was issued to
info.scopes; // ["youtube.readonly"]
info.expiresIn; // seconds left
info.email; // only when an identity scope was granted
```

Pass a string to inspect another access token: `oauth.tokenInfo(someAccessToken)`.

## Signing out

`revoke()` revokes the tokens at Google and clears them from the object. The user has to consent again afterwards.

```ts
await oauth.revoke();
await db.tokens.delete("main");
```

`revoke()` calls `onTokens` with an empty object, and so are the listeners added with `oauth.onTokens()`. That is the moment to delete your stored copy: a store that saves what it receives overwrites the dead tokens with nothing.

`setTokens()` replaces the tokens without contacting Google and without calling `onTokens`:

```ts
oauth.setTokens({ refreshToken: process.env.YOUTUBE_REFRESH_TOKEN });
```

## When no refresh token comes back

Google sends a refresh token the first time a user approves your app, and not on later sign-ins. If you lost it, or never stored it, `oauth.canRefresh` stays `false` after the exchange.

Force the consent screen to get a new one:

```ts
const { url } = await oauth.authUrl({
  scopes: ["youtube.readonly"],
  prompt: "consent",
});
```

Two other causes are in your hands: `accessType: "online"` never asks for one, and an `onTokens` that only stores `accessToken` throws the refresh token away.

## Bringing your own access token

When another part of your stack already handles OAuth, skip `OAuth2` and pass the access token:

```ts
const fixed = new YouTube({ accessToken: session.accessToken });

const dynamic = new YouTube({
  accessToken: async () => (await db.tokens.get("main")).accessToken,
});
```

A function is called before each request, so it can return a fresh token every time. There is no automatic refresh in this mode and no replay after a 401: an expired token surfaces as a `YouTubeApiError` with the code `UNAUTHORIZED`. Scopes are not checked before sending either.

## Errors

Everything that goes wrong with credentials is a `YouTubeAuthError`. When Google refused something, `oauthError` carries the name it gave.

```ts
try {
  await yt.channels.mine();
} catch (error) {
  if (error instanceof YouTubeAuthError && error.oauthError === "invalid_grant") {
    // The refresh token no longer works. Start the consent flow again.
    res.redirect("/login");
  } else {
    throw error;
  }
}
```

| `error.code` | When |
| --- | --- |
| `MISSING_CREDENTIALS` | The `OAuth2` object has no tokens yet: call `exchange()` or pass saved `tokens`. Also thrown when a call needs OAuth and the client only has an API key |
| `OAUTH_ERROR` | Google refused an exchange, a refresh, a revocation or a token inspection. Also: the access token expired and there is no refresh token, or `onTokens` threw |
| `INSUFFICIENT_SCOPE` | The token does not carry a scope the method accepts. See [Scopes](/auth/scopes/) |

| `error.oauthError` | Meaning |
| --- | --- |
| `invalid_grant` | The code or the refresh token is no longer valid: used twice, revoked or expired. Send the user through consent again |
| `redirect_uri_mismatch` | The redirect URI is not one configured on the OAuth client |

The message of an `OAUTH_ERROR` includes the description Google returned. `MISSING_CREDENTIALS` and `INSUFFICIENT_SCOPE` are raised before anything is sent, so they cost no quota. [Errors](/basics/errors/) covers the other error classes.

## Reference

### `new OAuth2(options)`

| Option | Type | Meaning |
| --- | --- | --- |
| `clientId` | `string` | Client id of your OAuth client. Required |
| `clientSecret` | `string` | Client secret. Leave it out for a public client that uses PKCE |
| `redirectUri` | `string` | Where Google sends the user back. Must match the client's configuration exactly |
| `tokens` | `Tokens` | Tokens saved from an earlier session |
| `onTokens` | `(tokens) => void \| Promise<void>` | Called after an exchange and after each refresh. Awaited |
| `fetch` | `typeof fetch` | Custom `fetch` for the calls to Google's OAuth endpoints |

### `oauth.authUrl(options)`

| Option | Default | Meaning |
| --- | --- | --- |
| `scopes` | Required | Scopes to request. At least one |
| `accessType` | `"offline"` | `"offline"` asks for a refresh token, `"online"` does not |
| `prompt` | None | `"none"`, `"consent"`, `"select_account"` or `"consent select_account"` |
| `state` | Random | Opaque value echoed back to the redirect URI |
| `loginHint` | None | Email or account id to preselect |
| `includeGrantedScopes` | `true` | Keep earlier grants in addition to the new scopes |
| `pkce` | `true` | Add a PKCE challenge and return a `codeVerifier` |
| `redirectUri` | The client's | Overrides the redirect URI for this URL |

### Methods and properties

| Member | Returns | What it does |
| --- | --- | --- |
| `authUrl(options)` | `Promise<{ url, state, codeVerifier }>` | Builds the consent URL |
| `exchange(code, { codeVerifier, redirectUri })` | `Promise<Tokens>` | Trades the code for tokens and keeps them |
| `getAccessToken()` | `Promise<string>` | A valid access token, refreshed first when needed |
| `refresh()` | `Promise<string>` | Forces a refresh. Concurrent calls share one request |
| `revoke()` | `Promise<void>` | Revokes the tokens at Google and forgets them |
| `tokenInfo(accessToken?)` | `Promise<TokenInfo>` | Client, scopes and remaining lifetime of a token |
| `setTokens(tokens)` | `void` | Replaces the tokens |
| `onTokens(listener)` | `() => void` | Subscribes to token changes |
| `tokens` | `Tokens` | A copy of the current tokens |
| `canRefresh` | `boolean` | Whether there is a refresh token |
| `isExpired` | `boolean` | Whether the access token is missing or about to expire |
| `grantedScopes` | `ReadonlySet<string> \| undefined` | Granted scopes, short names |
| `clientId` | `string` | The client id |

### `Tokens`

| Field | Meaning |
| --- | --- |
| `accessToken` | Short-lived token sent with each request |
| `refreshToken` | Long-lived token used to get new access tokens |
| `expiresAt` | When the access token expires, as a timestamp in milliseconds |
| `scope` | Granted scopes, space separated, as Google returns them |
| `tokenType` | Always `Bearer` |
| `idToken` | OpenID Connect identity token, when an `openid` scope was requested |

## See also

- [Scopes](/auth/scopes/): which scope a call needs.
- [Scripts and devices](/auth/scripts-and-devices/): the same flow without a web server.
- [Serving many users](/auth/many-users/): one client, one `OAuth2` per user.
- [Credentials](/start/credentials/): creating the OAuth client in the Google Cloud console.
