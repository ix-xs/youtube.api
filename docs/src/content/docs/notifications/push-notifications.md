---
title: Push notifications
description: Have YouTube's hub call your server within seconds of an upload, through WebSub. No API key, no quota, no polling. You need a public HTTPS endpoint.
sidebar:
  order: 2
---

```ts
import { websub } from "@ix-xs/youtube.api";

const secret = process.env.WEBSUB_SECRET;

// Once: ask the hub to notify your endpoint.
await websub.subscribe({
  channelId: "UC_x5XG1OV2P6uZZ5FSM9Ttw",
  callbackUrl: "https://example.com/youtube/webhook",
  secret,
});

// On every request the hub sends to that URL.
export async function handler(request: Request): Promise<Response> {
  const result = await websub.receive(request, { secret });

  for (const notification of result.notifications) {
    if (notification.type !== "video") continue;
    console.log("New or updated:", notification.title, notification.url);
  }
  return result.response;
}
```

## How it works

YouTube publishes the uploads of every channel to a public WebSub hub. You tell the hub which channel you care about and where to call you. Three things then happen on your endpoint:

1. The hub sends a `GET` to confirm that you asked for the subscription. You answer with the challenge it sent.
2. For every change, the hub sends a `POST` with a small Atom document.
3. The subscription expires at the end of its lease. You subscribe again before that.

`websub.receive()` handles the first two. Nothing here touches the YouTube Data API: there is no key to give and no quota to spend.

## Subscribing

```ts
await websub.subscribe({
  channelId,
  callbackUrl: "https://example.com/youtube/webhook",
  secret,
  lease: "5d",
});
```

| Option | Meaning |
| --- | --- |
| `channelId` | The channel to follow, as a `UC...` id |
| `callbackUrl` | Public HTTPS URL of your endpoint |
| `secret` | Shared secret. The hub signs every notification with it |
| `lease` | How long the subscription lasts. Default `"5d"`. The hub caps it at about 10 days |
| `signal` | Cancels the request to the hub. There is no timeout otherwise |
| `fetch` | Custom `fetch` |

`subscribe` resolves when the hub has accepted the request. The subscription is not active yet: the hub first calls your endpoint to confirm. Your endpoint must be up before you subscribe.

`channelId` must be an id. Anything else throws a `YouTubeArgumentError`. Resolve a handle first, which costs 1 unit of quota the first time:

```ts
const id = await yt.channels.resolveId("@GoogleDevelopers");

if (id) {
  await websub.subscribe({
    channelId: id,
    callbackUrl: "https://example.com/youtube/webhook",
    secret,
  });
}
```

To stop, call `unsubscribe` with the same channel and callback URL. The hub confirms that too.

```ts
await websub.unsubscribe({
  channelId,
  callbackUrl: "https://example.com/youtube/webhook",
});
```

## Receiving

Pass every request that reaches the callback URL to `websub.receive()`, and send back the `response` it gives you. Always, whatever else you do with the result.

```ts
const result = await websub.receive(request, { secret });

result.response; // send this back
result.notifications; // what changed, possibly empty
result.confirmation; // set when the hub was confirming a subscription
result.verified; // false when the request was rejected
```

| Field | Content |
| --- | --- |
| `response` | The HTTP response for the hub. It carries the challenge for a confirmation and the right status otherwise |
| `notifications` | The notifications of the request. Empty for a confirmation or a rejected request |
| `confirmation` | `{ mode, topic, channelId, leaseSeconds }` when the request was a confirmation, else `undefined` |
| `verified` | `false` when a secret was expected and the signature was missing or wrong, or when the body was too large |

Answer fast. The hub only waits a few seconds, so return the response first and do slow work after it.

### In a fetch-style handler

`receive` takes a standard `Request` and returns a standard `Response`, so it fits any runtime built on them. A Next.js route handler:

```ts
// app/youtube/webhook/route.ts
import { websub } from "@ix-xs/youtube.api";

const secret = process.env.WEBSUB_SECRET;

async function handle(request: Request): Promise<Response> {
  const { response, notifications } = await websub.receive(request, { secret });

  for (const notification of notifications) {
    if (notification.type === "video") console.log(notification.title);
  }
  return response;
}

export { handle as GET, handle as POST };
```

Hono, where `c.req.raw` is the `Request`:

```ts
app.all("/youtube/webhook", async (c: { req: { raw: Request } }) => {
  const { response, notifications } = await websub.receive(c.req.raw, {
    secret,
  });
  for (const notification of notifications) console.log(notification);
  return response;
});
```

A Cloudflare Worker, which keeps running after the response with `waitUntil`:

```ts
import { websub, type WebSubNotification } from "@ix-xs/youtube.api";

interface Env {
  WEBSUB_SECRET: string;
}

interface Context {
  waitUntil(promise: Promise<unknown>): void;
}

async function handleAll(notifications: WebSubNotification[]): Promise<void> {
  for (const notification of notifications) {
    console.log(notification.type, notification.videoId);
  }
}

export default {
  async fetch(request: Request, env: Env, ctx: Context): Promise<Response> {
    const { response, notifications } = await websub.receive(request, {
      secret: env.WEBSUB_SECRET,
    });
    ctx.waitUntil(handleAll(notifications));
    return response;
  },
};
```

### With `node:http` or Express

`webSubListener()` wraps `receive` for Node's request and response objects. It answers the hub first, then calls your handlers.

```ts
import { createServer } from "node:http";
import { webSubListener } from "@ix-xs/youtube.api/node";

createServer(
  webSubListener({
    secret: process.env.WEBSUB_SECRET,
    onNotification: async (notification) => {
      if (notification.type !== "video") return;
      await notify(`${notification.title} ${notification.url}`);
    },
    onConfirmation: ({ mode, channelId, leaseSeconds }) => {
      console.log(mode, channelId, leaseSeconds);
    },
    onError: (error) => console.error("Handler failed:", error),
  }),
).listen(3000);
```

In Express, mount it on the route for every method:

```ts
import { webSubListener } from "@ix-xs/youtube.api/node";

app.all(
  "/youtube/webhook",
  webSubListener({
    secret: process.env.WEBSUB_SECRET,
    onNotification: (notification) => console.log(notification),
  }),
);
```

The listener reads the request body itself, because the signature is computed over the exact bytes. Mount it before any middleware that consumes the body of that route.

| Option | Meaning |
| --- | --- |
| `onNotification` | Required. Called for each notification with a valid signature, one after the other |
| `onConfirmation` | Called when the hub confirms a subscription or its removal |
| `onError` | Called when a handler throws. Default: logs to the console |
| `secret`, `confirm` | The options of `receive` |

Without `onNotification`, `webSubListener` throws a `YouTubeArgumentError`.

## Signatures

The callback URL is public. Anyone who finds it can post a fake notification to it. Always set a `secret`.

With a secret, the hub signs each notification in an `X-Hub-Signature` header, and `receive` checks it:

- A notification without a valid signature is dropped. `notifications` is empty and `verified` is `false`.
- The response is still a success status. The WebSub specification asks for it, so that a forger learns nothing.

Give the same secret to `subscribe` and to `receive`. Without the `secret` option, `receive` checks no signature.

```ts
const { response, notifications, verified } = await websub.receive(request, {
  secret,
});

if (!verified) console.warn("Dropped a request with a bad signature");
```

## Confirming only what you asked for

By default `receive` confirms every subscription the hub asks about. Anyone can ask the hub to subscribe your URL to any channel, so restrict it to the channels you follow with `confirm`:

```ts
const wanted = new Set(["UC_x5XG1OV2P6uZZ5FSM9Ttw"]);

const result = await websub.receive(request, {
  secret,
  confirm: ({ mode, channelId }) => {
    if (!channelId) return false;
    return mode === "subscribe" ? wanted.has(channelId) : !wanted.has(channelId);
  },
});
```

This confirms a subscription for a channel you want, and a removal for a channel you no longer want. The second half matters as much: it keeps a stranger from unsubscribing you.

`confirm` receives `{ mode, topic, channelId }` and may be async. Returning `false` answers the hub with a 404.

## Renewing

A subscription ends with its lease. The confirmation tells you how long the hub granted:

```ts
const { response, confirmation } = await websub.receive(request, { secret });

if (confirmation?.mode === "subscribe" && confirmation.channelId) {
  const expiresAt = Date.now() + (confirmation.leaseSeconds ?? 0) * 1000;
  await db.set(`lease:${confirmation.channelId}`, expiresAt);
}
```

To renew, call `subscribe` again with the same arguments before the lease ends. A daily job that renews everything is enough with the default lease of 5 days:

```ts
const followed: string[] = await db.get("channels");

for (const id of followed) {
  await websub.subscribe({
    channelId: id,
    callbackUrl: "https://example.com/youtube/webhook",
    secret,
  });
}
```

## What a notification contains

```ts
const { notifications } = await websub.receive(request, { secret });

for (const notification of notifications) {
  if (notification.type === "video") {
    notification.videoId;
    notification.channelId;
    notification.title;
    notification.url;
    notification.author; // { name, url }
    notification.publishedAt; // ISO 8601 date the video went public
    notification.updatedAt; // ISO 8601 date of this change
  } else {
    notification.videoId;
    notification.channelId; // string | undefined
    notification.deletedAt; // string | undefined
  }
}
```

| `type` | Meaning |
| --- | --- |
| `"video"` | A video was published, or its title or description changed. YouTube does not say which |
| `"deleted"` | A video was deleted or made private |

### Telling a new upload from an edit

The same video reaches you several times: once when it is published, again each time its title or description changes, and the hub may deliver the same notification more than once. Remember the ids you have handled:

```ts
const { response, notifications } = await websub.receive(request, { secret });

for (const notification of notifications) {
  if (notification.type !== "video") continue;
  const isNew = await redis.set(`seen:${notification.videoId}`, "1", "NX");
  if (isNew) await notify(`New video: ${notification.title} ${notification.url}`);
}
```

A notification carries little. For the duration, the statistics or the privacy status, fetch the video with `yt.videos.get(videoId)`, 1 unit.

## Reference

| Member | What it does |
| --- | --- |
| `websub.subscribe(options)` | Asks the hub to notify your callback URL. Calling it again renews the lease |
| `websub.unsubscribe(options)` | Asks the hub to stop |
| `websub.receive(request, options)` | Handles a request from the hub: confirmations, signatures, parsing |
| `websub.parse(xml)` | Parses the Atom body of a notification |
| `websub.verify(body, header, secret)` | Checks an `X-Hub-Signature` header against your secret. Resolves to a boolean |
| `websub.topicUrl(channelId)` | The topic URL that identifies a channel at the hub: `https://www.youtube.com/xml/feeds/videos.xml?channel_id=...` |
| `websub.hub` | Address of the hub: `https://pubsubhubbub.appspot.com/subscribe` |
| `webSubListener(options)` | The same as `receive`, for `node:http` and Express. From `@ix-xs/youtube.api/node` |

`parse` and `verify` are for a framework that hands you the body as text and not a `Request`. `verify` takes the body as a string or as bytes, and needs it exactly as it was received.

### How `receive` answers

| Request | Status | Result |
| --- | --- | --- |
| `GET` with a valid confirmation | 200, the challenge as body | `confirmation` is set |
| `GET` refused by `confirm` | 404 | |
| `GET` that is not a confirmation | 400 | |
| `POST` with a valid signature, or no secret expected | 204 | `notifications` is filled |
| `POST` with a missing or wrong signature | 202 | `verified` is `false` |
| `POST` with a body over 1 MiB | 413 | `verified` is `false` |
| Any other method | 405 | |

## Limits and errors

- `subscribe` and `unsubscribe` throw a `YouTubeRequestError`. The code is `NETWORK` when the hub cannot be reached, `HUB_ERROR` when the hub refuses and answers with an error status, and `ABORTED` when your `signal` was aborted. The message of a `HUB_ERROR` carries the status and the start of the hub's answer.
- `receive` reads the body up to 1 MiB, counted in bytes. Beyond that it stops reading, keeps nothing more in memory and answers 413. `webSubListener` does the same. A notification is a few kilobytes.
- The hub needs a public URL. For local development, expose your machine through a tunnel and subscribe with the tunnel's URL.
- A lapsed lease stops notifications without any error on your side. Store the expiry and renew.
- Notifications are about videos only: published, title or description changed, deleted or made private.

## See also

- [Watching for uploads](/notifications/watching-uploads/) when you have no public endpoint.
- [Feeds and oEmbed](/notifications/feeds-and-oembed/) to read the same data on demand.
- [Channels](/resources/channels/) for `resolveId` and the other ways to name a channel.
- [Runtimes](/reference/runtimes/) for where the Node helpers are available.
