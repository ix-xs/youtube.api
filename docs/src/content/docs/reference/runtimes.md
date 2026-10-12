---
title: Runtimes
description: Where the library runs, what the project tests, and what the main entry needs from the platform. The main entry uses standard web APIs only, and a separate entry holds what needs Node.js.
---

```ts
// Anywhere fetch exists.
import { YouTube } from "@ix-xs/youtube.api";
// Node.js: files, a local server, the default browser.
import { fileMedia } from "@ix-xs/youtube.api/node";
```

The package has two entry points. Everything except four helpers lives in the main one, which has no dependency and imports no Node.js module. Importing the package has no side effect: nothing runs until you call something.

## Node.js

Node.js 20 or newer, as `engines` in `package.json` says. Both module systems are built and typed:

```ts
import { YouTube } from "@ix-xs/youtube.api";
```

```js
const { YouTube } = require("@ix-xs/youtube.api");
```

`@ix-xs/youtube.api/node` adds what needs the machine itself:

| Export | What it does | Uses |
| --- | --- | --- |
| `fileMedia(path)` | Prepares a file on disk for upload without reading it into memory | `node:fs`, `node:path` |
| `tokenFile(path)` | Keeps OAuth tokens in a JSON file | `node:fs/promises`, `node:path` |
| `authorize(oauth, options)` | Runs the consent flow locally: a loopback server, and the consent page opened in the default browser | `node:http`, `node:child_process` |
| `webSubListener(options)` | Turns `websub.receive` into a listener for `node:http` and the frameworks built on it | Node's request and response objects |

The built `/node` entry imports these modules with the `node:` prefix.

When `apiKey` is left out, the client reads the `YOUTUBE_API_KEY` environment variable from `process.env`. That holds for a client created with `oauth` or `accessToken` too.

What the project's CI runs:

| Node.js | What is run |
| --- | --- |
| 22 and 24 | The test suite: type checks, the type-level tests, the build, the unit tests, and a smoke test of the built files |
| 20 | The smoke test, on files built with Node.js 22: `require` and `import` of both entry points, a call through the client with a stand-in `fetch`, `tokenFile` and `fileMedia` on a real file |

The test tooling no longer runs on Node.js 20, which is why that version gets the smoke test only.

## Bun and Deno

Neither is part of the project's CI, so nothing is tested on them. What the source and the build say:

- The main entry only uses the web APIs listed in [the table below](#what-the-main-entry-needs-from-the-platform).
- The `/node` entry imports `node:child_process`, `node:fs`, `node:fs/promises`, `node:http` and `node:path`. It works where the runtime implements them under those names.
- The `YOUTUBE_API_KEY` fallback reads `process.env`. Where the runtime has no such object, pass `apiKey` yourself.

## Browsers

The main entry is written to run in a page. Google's API allows cross-origin requests from browsers, so the API calls need no proxy. What changes is what you can keep secret, which is nothing.

**The API key is visible to every visitor.** Restrict it in the Google Cloud console to your site, by HTTP referrer, and to the YouTube Data API. [Credentials](/start/credentials/) shows where.

**Never ship a client secret.** Leave `clientSecret` out of an `OAuth2` created in a page. `oauth.authUrl()` uses PKCE by default, and returns the `codeVerifier` to keep until the user comes back. When your OAuth client requires a secret for the code exchange, do that one step on your server and hand the access token to the page:

```ts
// In the page, with a token your server obtained for this user.
const yt = new YouTube({ accessToken: () => session.accessToken });
```

[OAuth](/auth/oauth/) covers the flow, [Many users](/auth/many-users/) the server side.

**Uploads take a `File` or a `Blob`.** `fileMedia` is for Node.js. In a page, pass what an `<input type="file">` gives you:

```ts
await yt.videos.insert({
  body: {
    snippet: { title: file.name },
    status: { privacyStatus: "private" },
  },
  media: {
    body: file,
    onProgress: ({ percent }) => console.log(percent),
  },
});
```

Other differences:

- The `YOUTUBE_API_KEY` fallback reads `process.env`, which a page does not have: pass `apiKey` explicitly.
- `yt.quota` counts what this page sent since it loaded. Every visitor draws from the same project quota.
- PKCE, WebSub signatures and the cache keys of calls made with a token need `crypto.subtle`, which browsers only expose in secure contexts.
- `fetchFeed`, `oEmbed` and `websub.subscribe` do not call the API: they call `www.youtube.com` and the hub. Whether those hosts accept a request from a page is not something the project checks. Call them from a server.

No browser is part of the project's CI.

## Cloudflare Workers and other edge runtimes

Use the main entry. The `/node` entry is written for a machine with a disk and a browser: `fileMedia` and `tokenFile` read and write files, `authorize` listens on a local port and opens the default browser.

`websub.receive` fits a request handler as it is. It takes a `Request` and returns the `Response` to send back:

```ts
import { websub } from "@ix-xs/youtube.api";

interface Env {
  WEBSUB_SECRET: string;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const { response, notifications } = await websub.receive(request, {
      secret: env.WEBSUB_SECRET,
    });
    for (const notification of notifications) {
      if (notification.type !== "video") continue;
      console.log(notification.title, notification.url);
    }
    return response;
  },
};
```

What to keep in mind where a process does not stay alive:

- **Loops.** `watcher.start()` and `chat.messages()` wait on timers between two requests. How long a request or an invocation may run is the platform's limit, not the library's. For upload notifications, run one round per scheduled invocation with `watcher.check()`. Pass a `since` a few minutes before the previous run, and skip the video ids you already handled. See [Watching uploads](/notifications/watching-uploads/).
- **Memory.** The response cache and the quota count live in memory, so they last as long as the instance does. Give the cache a `store` backed by the platform's key-value storage, and carry the quota count with `yt.quota.snapshot()` and the `quota.restore` option. See [Caching](/basics/caching/) and [Quota](/basics/quota/).
- **Environment.** The `YOUTUBE_API_KEY` fallback only exists where the runtime provides `process.env`. Pass `apiKey` from the platform's bindings.

No edge runtime is part of the project's CI.

## Hosts the library calls

For a runtime that restricts outgoing requests, or a content security policy:

| Host | Used by |
| --- | --- |
| `youtube.googleapis.com` | The Data API, uploads included. The `baseUrl` option replaces it |
| `youtubeanalytics.googleapis.com` | `yt.analytics` |
| `youtubereporting.googleapis.com` | `yt.reporting` |
| `oauth2.googleapis.com` | `OAuth2`: code exchange, refresh, revocation, the device flow, `tokenInfo` |
| `www.youtube.com` | `fetchFeed`, the feed requests of a watcher, `oEmbed` |
| `pubsubhubbub.appspot.com` | `websub.subscribe` and `websub.unsubscribe` |

A resumable upload continues at the session URL the API returns, and a report download goes to the URL the API gives. Both are the API's choice. The consent page on `accounts.google.com` is opened by the user's browser, not requested by the library.

## What the main entry needs from the platform

| API | Used for | Without it |
| --- | --- | --- |
| `fetch` | Every call | Creating a client throws `INVALID_ARGUMENT`. Pass your own with the `fetch` option |
| `Request`, `Response` | `websub.receive`, which reads one and builds the other | Only `websub.receive` is affected |
| `URL`, `URLSearchParams` | Building requests, parsing YouTube URLs, OAuth and hub requests | Required |
| `AbortController`, `AbortSignal` | Timeouts and cancellation | Required |
| `TextEncoder`, `TextDecoder` | Text uploads, PKCE, WebSub signatures and notifications, the chat stream, the cache keys of calls made with a token | Only those are affected |
| `Blob` | Uploads from a `Blob` or a `File`, and multipart uploads | Only uploads are affected |
| `ReadableStream` | Uploads from a stream, the body of a request given to `websub.receive`, and the experimental `mode: "stream"` of the live chat | Only those are affected |
| Web Crypto: `crypto.subtle`, `crypto.getRandomValues` | PKCE and the generated `state` of `oauth.authUrl()`, WebSub signatures, the cache keys of calls made with a token | `oauth.authUrl()` fails unless you pass `state` and set `pkce: false`. Signed notifications cannot be checked. Responses of calls made with a token are not cached |
| `btoa` | PKCE and the generated `state` | Same as above for `oauth.authUrl()` |
| `Intl.DateTimeFormat` with the `America/Los_Angeles` time zone | The quota day and `yt.quota.resetsAt`. The formatters are built on first use, which is when a client is created | Creating a client fails |
| `Intl.NumberFormat` with compact notation | `formatCount` | Only `formatCount` is affected |
| `setTimeout` | Timeouts, retry delays, polling | Required |

The JavaScript is built for ES2022 and is not minified.

## TypeScript

Types are included, there is no `@types` package for the library. Each entry point ships a declaration file for CommonJS and one for ES modules, so the types you get match the module system you compile for.

| `moduleResolution` | Main entry | `/node` entry |
| --- | --- | --- |
| `node16`, `nodenext` | Resolves through `exports` | Resolves through `exports` |
| `bundler` | Resolves through `exports` | Resolves through `exports` |
| `node10`, the legacy `node` | Resolves through `main` and `types` | Resolves through `typesVersions` |

The project's CI checks this on every change by packing the package and running `@arethetypeswrong/cli` on it.

The declarations refer to web types such as `Request`, `Response`, `Blob`, `ReadableStream` and `AbortSignal`. Your project gets them from the `DOM` library or from `@types/node`. The `/node` entry needs `@types/node`.

## Bundle size

Measured on the ES module build of version 2.0.0, with gzip at its default level:

| File | Raw | Gzipped |
| --- | --- | --- |
| `index.mjs` | 129 kB | 26 kB |
| The chunk it shares with the `/node` entry: errors, URL helpers, feeds, oEmbed, WebSub | 26 kB | 8 kB |
| `node.mjs` | 6 kB | 2 kB |

Importing the main entry loads the first two: about 34 kB gzipped before your bundler minifies anything. Doc comments are stripped from the JavaScript and kept in the declaration files, where editors read them. No source map is published.

The package declares `"sideEffects": false`, so a bundler is free to drop what you do not import. How much that saves depends on what you use: the `YouTube` class reaches every resource, so importing it keeps most of the library.

## Reference

| Runtime | Main entry | `/node` entry | In the project's CI |
| --- | --- | --- | --- |
| Node.js 20 | Yes | Yes | Smoke test of the build |
| Node.js 22, 24 | Yes | Yes | Test suite |
| Bun, Deno | Standard web APIs only | Needs the runtime's `node:` modules | No |
| Browsers | Standard web APIs only | No | No |
| Cloudflare Workers, edge runtimes | Standard web APIs only | No | No |

## See also

- [Quick start](/start/quick-start/) to install the package and make a first call.
- [Credentials](/start/credentials/) for restricting an API key.
- [Uploads](/resources/uploads/) for `File`, `Blob`, streams and `fileMedia`.
- [Push notifications](/notifications/push-notifications/) for `websub.receive` in a request handler.
