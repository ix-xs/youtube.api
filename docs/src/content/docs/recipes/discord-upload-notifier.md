---
title: Discord upload notifier
description: A process that posts an embed to a Discord channel whenever one of the YouTube channels you watch uploads. It needs a webhook URL, no Discord library and, most days, no quota.
sidebar:
  order: 1
---

## What you get

A script that checks a list of YouTube channels every five minutes and posts each new video to a Discord channel, with its title, thumbnail and publication date. It remembers where it stopped, so a restart catches up on what was uploaded in the meantime and posts nothing twice.

## What it needs

| | |
| --- | --- |
| `DISCORD_WEBHOOK_URL` | A webhook of the Discord channel: **Edit channel > Integrations > Webhooks > New webhook > Copy webhook URL** |
| `YOUTUBE_API_KEY` | An API key, see [Credentials](/start/credentials/). It resolves handles and serves as a fallback |
| `STATE_FILE` | Optional. Where the script keeps its state. Default `./notifier-state.json` |

Quota: none while YouTube's public feed answers. Resolving a handle costs 1 unit per channel each time the process starts, and nothing when you pass `UC...` ids. When the feed of a channel fails, the watcher reads that channel through the API for the next 30 minutes, at 1 unit per round. A full day without the feed is 288 units per channel with the five minute interval.

## The program

```ts title="notifier.ts"
import { readFile, writeFile } from "node:fs/promises";
import { setTimeout as sleep } from "node:timers/promises";
import { YouTube, urls, type WatchedVideo } from "@ix-xs/youtube.api";

const channels = process.argv.slice(2);
const webhook = process.env.DISCORD_WEBHOOK_URL ?? "";
if (!channels.length || !webhook) {
  console.error("Usage: DISCORD_WEBHOOK_URL=... notifier.ts <channel> [more channels]");
  process.exit(1);
}

const INTERVAL = 5 * 60_000;
// The feed lags a few minutes behind uploads, so a restart looks back this far.
const OVERLAP = 15 * 60_000;
const STATE_FILE = process.env.STATE_FILE ?? "./notifier-state.json";

interface State {
  /** When the last complete round started, in milliseconds. */
  lastCheck?: number;
  /** Ids of the videos already posted, newest last. */
  posted: string[];
}

async function loadState(): Promise<State> {
  try {
    return { posted: [], ...(JSON.parse(await readFile(STATE_FILE, "utf8")) as Partial<State>) };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { posted: [] }; // first run
    throw error;
  }
}

const state = await loadState();
const saveState = () => writeFile(STATE_FILE, JSON.stringify(state));

const yt = new YouTube(); // reads YOUTUBE_API_KEY
const since = state.lastCheck === undefined ? Date.now() : state.lastCheck - OVERLAP;
const watcher = yt.watch(channels, { since });

let failed = false;
watcher.on("error", ({ channel, error }) => {
  failed = true;
  console.warn(`Could not check ${channel}:`, error instanceof Error ? error.message : error);
});

async function post(video: WatchedVideo): Promise<void> {
  const response = await fetch(webhook, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      embeds: [
        {
          title: video.title,
          url: video.url,
          author: { name: video.channelTitle, url: urls.channel(video.channelId) },
          image: video.thumbnail ? { url: video.thumbnail } : undefined,
          timestamp: video.publishedAt,
          color: 0xff0000,
        },
      ],
    }),
  });
  if (!response.ok) throw new Error(`Discord answered ${response.status}`);
}

const queue: WatchedVideo[] = [];
const stop = new AbortController();
process.once("SIGINT", () => stop.abort());
process.once("SIGTERM", () => stop.abort());

console.log(`Watching ${channels.join(", ")}. Ctrl+C to stop.`);

while (!stop.signal.aborted) {
  const startedAt = Date.now();
  failed = false;

  const found = await watcher.check();
  queue.push(...found.filter((video) => !state.posted.includes(video.videoId)));

  while (queue.length) {
    const video = queue[0]!;
    try {
      await post(video);
    } catch (error) {
      failed = true;
      console.warn(`Could not post "${video.title}":`, error instanceof Error ? error.message : error);
      break; // it stays in the queue for the next round
    }
    queue.shift();
    state.posted = [...state.posted, video.videoId].slice(-200);
    await saveState();
    console.log(`${video.channelTitle} uploaded "${video.title}"`);
  }

  // The saved time only moves forward after a round where nothing went wrong.
  if (!failed) {
    state.lastCheck = startedAt;
    await saveState();
  }
  await sleep(INTERVAL, undefined, { signal: stop.signal }).catch(() => {});
}
```

## Run it

```bash
npm install @ix-xs/youtube.api

export YOUTUBE_API_KEY=...
export DISCORD_WEBHOOK_URL=https://discord.com/api/webhooks/...
node notifier.ts @GoogleDevelopers @YouTube
```

Node.js 22.18 and newer run a `.ts` file as it is. On Node.js 20, use `npx tsx notifier.ts` with the same arguments.

Channels can be handles, channel URLs or `UC...` ids. The first run starts from now: it does not post the videos that already exist.

## How it works

**`watcher.check()` instead of `watcher.start()`.** `start()` polls on a timer and emits `video` events. Here the loop is written by hand, because the script has to know when a round is over and whether everything in it worked before it saves anything. `check()` runs one round and resolves to the new videos, oldest first.

**The state file.** `since` tells the watcher to report videos published after a given moment. Without it a watcher starts from the present, and whatever was uploaded while the process was down is lost. The script saves the start time of each round that fully succeeded and passes it back at the next start.

**The overlap.** The public feed shows a video a few minutes after it goes public. A video published shortly before the saved time may not have been in the feed yet, so a restart looks 15 minutes further back. The `posted` list then filters out what was already sent. Inside one process the watcher does this itself: it remembers the ids it has seen.

**Errors.** A channel that cannot be checked emits `error` and the round carries on with the others. A failed post leaves the video at the head of the queue. In both cases `lastCheck` keeps its old value, so nothing is skipped: the next round, or the next start, tries again. This also covers Discord answering `429` when many videos arrive at once.

**The limit of catching up.** Both the feed and the fallback return the 15 most recent uploads of a channel. After a long stop, a channel that uploaded more than that is only caught up on its latest 15.

**`video.thumbnail`** is `undefined` when YouTube gave none, and `JSON.stringify` then drops the `image` key.

## Going further

### Push instead of polling

With a public HTTPS endpoint, YouTube's hub calls you within seconds of an upload and there is no loop to run. `websub` costs no quota either. The hub also notifies when a title or a description changes, so keep the check on the video id.

```ts
import { createServer } from "node:http";
import { YouTube, websub } from "@ix-xs/youtube.api";
import { webSubListener } from "@ix-xs/youtube.api/node";

const secret = process.env.WEBSUB_SECRET;
const posted = new Set<string>();

createServer(
  webSubListener({
    secret,
    onNotification: (notification) => {
      if (notification.type !== "video" || posted.has(notification.videoId)) return;
      posted.add(notification.videoId);
      console.log(notification.title, notification.url); // post to Discord here
    },
  }),
).listen(3000);

const yt = new YouTube();
const channelId = await yt.channels.resolveId("@GoogleDevelopers");
if (channelId) await websub.subscribe({ channelId, callbackUrl: "https://example.com/youtube", secret });
```

Subscriptions expire: call `subscribe` again before the lease ends. [Push notifications](/notifications/push-notifications/) covers the details.

### Leave Shorts out

The feed says whether an entry is a Short. Filter on it before queueing:

```ts
const watcher = yt.watch(["@GoogleDevelopers"]);
const found = await watcher.check();

const withoutShorts = found.filter((video) => video.isShort !== true);
```

`isShort` is `undefined` for a video the watcher learnt about through the API fallback, where that information does not exist. Comparing with `true` lets those through.

### Inside a discord.js bot

A bot that is already running does not need the webhook. Move the loop into a function, call it from the bot's `ready` event, and replace the `fetch` in `post()` with a message sent by the bot. The watcher, the state file and the queue stay as they are.

### Other variations

- One webhook per YouTube channel: key a `Map` by `video.channelId`.
- From a cron job: drop the loop and the `sleep`, and run the body once per invocation. [Watching uploads](/notifications/watching-uploads/) shows that shape.
