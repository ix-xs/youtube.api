---
title: Runtimes
description: Where the library runs, what differs from one runtime to the next, and what it needs from the platform. The main entry uses standard web APIs only, and a separate entry holds what needs Node.js.
---

```ts
import { YouTube } from "@ix-xs/youtube.api"; // anywhere fetch exists
import { fileMedia } from "@ix-xs/youtube.api/node"; // Node.js: files, a local server, the default browser
```

The package has two entry points. Everything except four helpers lives in the main one, which has no dependency and imports no Node.js module.

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
| `fileMedia(path)` | Prepares a file on disk for upload without reading it into memory | `node:fs` |
| `tokenFile(path)` | Keeps OAuth tokens in a JSON file | `node:fs` |
| `authorize(oauth, options)` | Runs the consent flow locally: a loopback server, and the consent page opened in the default browser | `node:http`, `node:child_process` |
| `webSubListener(options)` | Turns `websub.receive` into a listener for `node:http` and the frameworks built on it | Node's request and response objects |

When the client gets no `apiKey`, it reads the `YOUTUBE_API_KEY` environment variable from `process.env`.

What the project's CI runs:

| Node.js | What is run |
| --- | --- |
| 22 and 24 | The unit tests, the type-level tests, the build, and a smoke test of the built files |
| 20 | The smoke test of the built files: `require` and `import` of both entry points, a call through the client, `tokenFile` and `fileMedia` on a real file |

## Bun

Install it and import it as in Node.js. The main entry needs nothing Bun does not provide as a web standard. The `/node` entry depends on Bun's implementation of `node:fs`, `node:http` and `node:child_process`.

Bun is not part of the project's CI.

## Deno

Import the package with an `npm:` specifier:

```js
import { YouTube } from "npm:@ix-xs/youtube.api";

const yt = new YouTube({ apiKey: Deno.env.get("YOUTUBE_API_KEY") });
```

The main entry uses standard web APIs only. Pass the key yourself as above: the `YOUTUBE_API_KEY` fallback only looks at `process.env`. Network access has to be allowed for `youtube.googleapis.com`, plus `oauth2.googleapis.com` for OAuth and `www.youtube.com` for feeds and oEmbed.

Deno is not part of the project's CI.

## Browsers

The main entry runs in a page. Google's API answers cross-origin requests, so no proxy is needed for the calls themselves. What changes is what you can keep secret, which is nothing.

**The API key is visible to every visitor.** Restrict it in the Google Cloud console to your site, by HTTP referrer, and to the YouTube Data API. [Credentials](/start/credentials/) shows where.

**Never ship a client secret.** Leave `clientSecret` out of an `OAuth2` created in a page. `oauth.authUrl()` uses PKCE by default, and returns the `codeVerifier` to keep until the user comes back. When your OAuth client type requires a secret for the code exchange, do that one step on your server and hand the access token to the page:

```ts
// In the page, with a token your server obtained for this user.
const yt = new YouTube({ accessToken: () => session.accessToken });
```

[OAuth](/auth/oauth/) covers the flow, [Many users](/auth/many-users/) the server side.

**Uploads take a `File` or a `Blob`.** `fileMedia` is for Node.js. In a page, pass what an `<input type="file">` gives you:

```ts
await yt.videos.insert({
  body: { snippet: { title: file.name }, status: { privacyStatus: "private" } },
  media: { body: file, onProgress: ({ percent }) => console.log(percent) },
});
```

Other differences:

- There is no `process.env`: pass `apiKey` explicitly.
- `yt.quota` counts what this page sent since it loaded. Every visitor draws from the same project quota.
- PKCE, WebSub signatures and the cache keys of OAuth users need `crypto.subtle`, which browsers only expose in secure contexts: HTTPS pages and `localhost`.

No browser is part of the project's CI.

## Cloudflare Workers and other edge runtimes

Use the main entry. The `/node` entry is not meant for these runtimes: there is no disk for `fileMedia` and `tokenFile`, and no browser for `authorize`.

`websub.receive` fits them as it is. It takes a `Request` and returns the `Response` to send back:

```ts
import { websub } from "@ix-xs/youtube.api";

export default {
  async fetch(request: Request, env: { WEBSUB_SECRET: string }): Promise<Response> {
    const { response, notifications } = await websub.receive(request, { secret: env.WEBSUB_SECRET });
    for (const notification of notifications) {
      if (notification.type === "video") console.log(notification.title, notification.url);
    }
    return response;
  },
};
```

What to keep in mind where a process does not stay alive:

- **Loops.** `watcher.start()` and `chat.messages()` wait on timers between two requests. How long a request or an invocation may run is the platform's limit, not the library's. For upload notifications, run one round per scheduled invocation with `watcher.check()` and pass the time of the previous run as `since`. See [Watching uploads](/notifications/watching-uploads/).
- **Memory.** The response cache and the quota count live in memory, so they last as long as the instance does. Give the cache a `store` backed by the platform's key-value storage, and carry the quota count with `yt.quota.snapshot()` and the `quota.restore` option. See [Caching](/basics/caching/) and [Quota](/basics/quota/).
- **Environment.** There is no `process.env` fallback unless the runtime provides one. Pass `apiKey` from the platform's bindings.

No edge runtime is part of the project's CI.

## What the main entry needs from the platform

| API | Used for | Without it |
| --- | --- | --- |
| `fetch` | Every call | The client throws `INVALID_ARGUMENT` at creation. Pass your own with the `fetch` option |
| `Request`, `Response` | `websub.receive`, which reads one and builds the other | Only `websub.receive` is affected |
| `URL`, `URLSearchParams` | Building requests, parsing YouTube URLs, OAuth and hub requests | Required |
| `AbortController`, `AbortSignal` | Timeouts and cancellation. `oEmbed` uses `AbortSignal.timeout` | Required |
| `TextEncoder`, `TextDecoder` | Text uploads, PKCE, WebSub signatures and notifications, the chat stream | Only those are affected |
| `Blob` | Uploads from a `Blob` or a `File`, and multipart uploads | Only uploads are affected |
| `ReadableStream` | Uploads from a stream, the body of a request given to `websub.receive`, and the experimental `mode: "stream"` of the live chat | Only those are affected |
| Web Crypto: `crypto.subtle`, `crypto.getRandomValues` | PKCE and the `state` of `oauth.authUrl()`, WebSub signatures, the cache keys of calls made with a token | OAuth URLs and signed notifications fail. Responses of calls made with a token are not cached |
| `btoa` | PKCE | `oauth.authUrl()` fails |
| `Intl.DateTimeFormat` with the `America/Los_Angeles` time zone | The quota day and `yt.quota.resetsAt`. The formatters are created when the module loads | The import fails |
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
| The chunk it shares with the `/node` entry: errors, URL helpers, feeds, WebSub | 26 kB | 8 kB |
| `node.mjs` | 6 kB | 2 kB |

Importing the main entry loads the first two: about 34 kB gzipped before your bundler minifies anything. Doc comments are stripped from the JavaScript and kept in the declaration files, where editors read them. No source map is published.

The package declares `"sideEffects": false`, so a bundler is free to drop what you do not import. How much that saves depends on what you use: the `YouTube` class reaches every resource, so importing it keeps most of the library.

## Reference

| Runtime | Main entry | `/node` entry | In the project's CI |
| --- | --- | --- | --- |
| Node.js 20 | Yes | Yes | Smoke test of the build |
| Node.js 22, 24 | Yes | Yes | Full test suite |
| Bun | Standard web APIs only | Depends on Bun's Node.js compatibility | No |
| Deno | Standard web APIs only, through `npm:` | Depends on Deno's Node.js compatibility | No |
| Browsers | Standard web APIs only | No | No |
| Cloudflare Workers, edge runtimes | Standard web APIs only | No | No |

## See also

- [Quick start](/start/quick-start/) to install the package and make a first call.
- [Credentials](/start/credentials/) for restricting an API key.
- [Uploads](/resources/uploads/) for `File`, `Blob`, streams and `fileMedia`.
- [Push notifications](/notifications/push-notifications/) for `websub.receive` in a request handler.
