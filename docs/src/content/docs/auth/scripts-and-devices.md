---
title: Scripts and devices
description: Authorize a script on your own machine with one call, keep the tokens in a file, sign in on a device without a browser, and run the result on a server.
sidebar:
  order: 2
---

```ts
import { OAuth2, YouTube } from "@ix-xs/youtube.api";
import { authorize, tokenFile } from "@ix-xs/youtube.api/node";

const store = tokenFile("./tokens.json");
const oauth = new OAuth2({
  clientId: process.env.GOOGLE_CLIENT_ID!,
  clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
  tokens: await store.load(),
  onTokens: store.save,
});

if (!oauth.canRefresh) await authorize(oauth, { scopes: ["youtube.readonly"] }); // opens the browser

const yt = new YouTube({ oauth });
```

The first run opens the consent page and writes `tokens.json`. Every later run reads the file and goes straight to the API.

`authorize` and `tokenFile` come from `@ix-xs/youtube.api/node`, the entry point for helpers that need Node.js itself: files on disk, a local HTTP server, the default browser. The device flow further down is part of the main entry point and runs anywhere `fetch` does.

## Authorizing on your own machine

`authorize()` runs the whole [OAuth flow](/auth/oauth/) locally, so a script needs no web server and no callback route.

Create an OAuth client of type **Desktop app** in the Google Cloud console. That type accepts any loopback redirect, which is what makes a free local port usable. [Credentials](/start/credentials/) shows where.

```ts
const tokens = await authorize(oauth, { scopes: ["youtube.upload"] });
```

What the call does:

1. It starts an HTTP server on `127.0.0.1`, on any free port.
2. It builds the consent URL with that address as the redirect URI, with PKCE, and with `prompt: "consent"` so a refresh token comes back.
3. It prints the URL and opens it in the default browser.
4. It waits for Google to redirect back, and checks `state`. A request carrying another `state` gets an error page and the wait goes on.
5. It trades the code for tokens. They are stored on `oauth`, passed to `onTokens`, and returned.

The local server is closed whether the call succeeds or fails.

The browser must run on the same machine as the script, because Google redirects to `127.0.0.1`. For a machine you only reach over SSH, authorize on your own computer and [copy the tokens](#running-on-a-server), or use the [device flow](#signing-in-on-a-device).

### Options

```ts
await authorize(oauth, {
  scopes: ["youtube.readonly"],
  port: 8085, // listen here instead of a free port
  open: false, // do not launch the browser
  onUrl: (url) => console.log(`Sign in at ${url}`), // replaces the default message
  timeout: "2m", // give up after two minutes, default "5m"
});
```

With a fixed `port` the redirect URI is `http://127.0.0.1:8085`. If the port is taken, the call rejects with Node's own listen error.

### When it fails

`authorize()` throws a `YouTubeAuthError` with the code `OAUTH_ERROR` in two cases:

- Nobody completed the consent screen before `timeout`.
- The user refused, or Google returned another error. `error.oauthError` then holds the name Google gave.

```ts
try {
  await authorize(oauth, { scopes: ["youtube.readonly"], timeout: "2m" });
} catch (error) {
  if (error instanceof YouTubeAuthError) {
    console.error("Not authorized:", error.oauthError ?? error.message);
    process.exit(1);
  }
  throw error;
}
```

## Keeping tokens in a file

`tokenFile(path)` returns two functions shaped for `OAuth2`: `load` for the `tokens` option and `save` for `onTokens`.

```ts
const store = tokenFile("./secrets/tokens.json");

const saved = await store.load(); // Tokens, or undefined when the file does not exist
await store.save({ refreshToken: "1//example" });
```

- `load()` resolves to `undefined` when there is no file yet. A file that cannot be read or is not valid JSON makes it throw.
- `save()` creates the folder when it is missing and writes the tokens as indented JSON.

On Linux and macOS the file is readable by the current user only. Windows ignores that setting, so the permissions of the folder apply there. Put the file somewhere other accounts cannot read, and keep it out of version control.

Since `save` is wired to `onTokens`, the file is rewritten after every refresh. If the write fails, the API call that triggered the refresh fails too: see [Storing tokens](/auth/oauth/#storing-tokens).

## A complete script

This script prints your channel and your playlists. Run it twice: the second run does not open the browser.

```ts
import { OAuth2, YouTube } from "@ix-xs/youtube.api";
import { authorize, tokenFile } from "@ix-xs/youtube.api/node";

const SCOPE = "youtube.readonly";

const store = tokenFile("./tokens.json");
const oauth = new OAuth2({
  clientId: process.env.GOOGLE_CLIENT_ID!,
  clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
  tokens: await store.load(),
  onTokens: store.save,
});

// Consent is needed the first time, and again when the script asks for a scope the file does not have.
if (!oauth.canRefresh || !oauth.grantedScopes?.has(SCOPE)) {
  await authorize(oauth, { scopes: [SCOPE] });
}

const yt = new YouTube({ oauth });

const me = await yt.channels.mine();
console.log(me?.snippet.title, me?.statistics.subscriberCount);

for await (const playlist of yt.playlists.list({ part: ["snippet", "contentDetails"], mine: true })) {
  console.log(playlist.snippet.title, playlist.contentDetails.itemCount);
}
```

```bash
GOOGLE_CLIENT_ID=... GOOGLE_CLIENT_SECRET=... node script.mjs
```

It spends 1 quota unit for the channel and 1 per page of 50 playlists.

Testing `grantedScopes` matters when a script grows. A file written for `youtube.readonly` still has a refresh token, so `canRefresh` alone would skip the consent that a new upload feature needs. Earlier grants are kept when you ask for more: see [Scopes](/auth/scopes/#asking-for-more-later).

[Upload from a script](/recipes/upload-from-a-script/) builds on the same start.

## Signing in on a device

The device flow is for a TV, a console, or a command-line tool on a machine without a browser. The device shows a short code. The user types it on another device, and the script waits.

Create an OAuth client of type **TVs and Limited Input devices**.

```ts
import { OAuth2, YouTube } from "@ix-xs/youtube.api";
import { tokenFile } from "@ix-xs/youtube.api/node";

const store = tokenFile("./tokens.json");
const oauth = new OAuth2({ clientId, clientSecret, tokens: await store.load(), onTokens: store.save });

if (!oauth.canRefresh) {
  const device = await oauth.requestDeviceCode({ scopes: ["youtube.readonly"] });
  console.log(`Open ${device.verificationUrl} and enter ${device.userCode}`);

  await oauth.pollDeviceToken(device); // resolves once the user approved
}

const yt = new YouTube({ oauth });
```

`requestDeviceCode()` asks Google for the codes. `pollDeviceToken()` then polls every `device.interval` seconds, slows down when Google asks it to, and resolves with the tokens. They are stored on `oauth` and passed to `onTokens`, exactly as after an `exchange()`.

If the codes expire first, `pollDeviceToken()` throws a `YouTubeAuthError` whose `oauthError` is `expired_token`. Request a new code and show it again. Any other refusal is thrown as a `YouTubeAuthError` with the name Google gave.

To stop waiting earlier, pass a `signal`. The promise then rejects with the reason of the signal:

```ts
const device = await oauth.requestDeviceCode({ scopes: ["youtube.readonly"] });
await oauth.pollDeviceToken(device, { signal: AbortSignal.timeout(120_000) });
```

:::caution
Google limits which scopes the device flow accepts. `youtube` and `youtube.readonly` are allowed. Before relying on another one, check [Google's list of scopes allowed for devices](https://developers.google.com/identity/protocols/oauth2/limited-input-device#allowedscopes).
:::

## Running on a server

A cron job or a worker has nobody to click through a consent screen. Do the consent once on your machine, then give the result to the server.

1. Run a script with `authorize()` locally, as above. It writes `tokens.json`.
2. Move the tokens to the server, in one of the two ways below.
3. Create the `OAuth2` object on the server with the same `clientId` and `clientSecret`.

**Copy the file.** Point `tokenFile()` at it. The process must be able to write to the file, because `save` runs after each refresh.

```ts
const store = tokenFile("/var/lib/my-app/tokens.json");
const oauth = new OAuth2({ clientId, clientSecret, tokens: await store.load(), onTokens: store.save });
```

**Pass the refresh token only.** This suits a read-only filesystem or a platform that injects secrets as environment variables. Copy the `refreshToken` value out of `tokens.json`:

```ts
const oauth = new OAuth2({
  clientId: process.env.GOOGLE_CLIENT_ID!,
  clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
  tokens: { refreshToken: process.env.YOUTUBE_REFRESH_TOKEN },
});

const yt = new YouTube({ oauth });
```

The first call fetches an access token, and later ones renew it in memory. Nothing has to be written back: the library keeps the refresh token it was given.

If a refresh ever fails with `oauthError: "invalid_grant"`, the refresh token is no longer valid: it was revoked or it expired. Repeat step 1.

## Reference

### `authorize(oauth, options)`

Returns `Promise<Tokens>`.

| Option | Default | Meaning |
| --- | --- | --- |
| `scopes` | Required | Scopes to request |
| `port` | Any free port | Local port to listen on |
| `open` | `true` | Open the consent page in the default browser |
| `onUrl` | Prints the URL | Called with the consent URL |
| `timeout` | `"5m"` | How long to wait for the user. Milliseconds, or a string such as `"90s"` or `"10m"` |

### `tokenFile(path)`

| Member | Returns | What it does |
| --- | --- | --- |
| `load()` | `Promise<Tokens \| undefined>` | Reads the file. `undefined` when it does not exist |
| `save(tokens)` | `Promise<void>` | Writes the file, creating its folder when needed |

### Device flow

| Method | Returns | What it does |
| --- | --- | --- |
| `oauth.requestDeviceCode({ scopes })` | `Promise<DeviceCode>` | Starts the flow |
| `oauth.pollDeviceToken(device, { signal })` | `Promise<Tokens>` | Waits for the approval, then stores and returns the tokens |

| `DeviceCode` field | Meaning |
| --- | --- |
| `userCode` | Code the user types on the verification page |
| `verificationUrl` | Page the user opens on another device |
| `expiresIn` | Seconds until the codes expire |
| `interval` | Seconds to wait between two polls |
| `deviceCode` | Code `pollDeviceToken()` sends to Google while it waits |

## See also

- [OAuth 2.0](/auth/oauth/): the flow behind `authorize()`, refresh and errors.
- [Scopes](/auth/scopes/): what to put in `scopes`.
- [Upload from a script](/recipes/upload-from-a-script/): a full program built on this page.
- [Runtimes](/reference/runtimes/): what the `/node` entry point needs.
