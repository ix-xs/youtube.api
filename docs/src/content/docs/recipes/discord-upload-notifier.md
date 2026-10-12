---
title: Discord upload notifier
description: A process that posts an embed to a Discord channel whenever one of the YouTube channels you watch uploads. It needs a webhook URL, no Discord library and, while YouTube's feed answers, no quota.
sidebar:
  order: 1
---

## What you get

A script that checks a list of YouTube channels every five minutes and posts each new video to a Discord channel, with its title, thumbnail and publication date. It remembers where it stopped, so a restart catches up on what was uploaded in the meantime and posts nothing twice.

## What it needs

| | |
| --- | --- |
| `DISCORD_WEBHOOK_URL` | The URL of a webhook created on the Discord channel that receives the posts |
| `YOUTUBE_API_KEY` | An API key, see [Credentials](/start/credentials/). It resolves handles and serves as a fallback |
| `STATE_FILE` | Optional. Where the script keeps its state. Default `./notifier-state.json` |

Quota: none while YouTube's public feed answers. The rest is small:

| When | Cost |
| --- | --- |
| Resolving a handle or a channel URL, once per channel each time the process starts | 1 unit. 2 for a bare name without `@` that turns out to be a legacy username |
| A `UC...` id or a `/channel/UC...` URL | Nothing |
| The feed of a channel fails | 1 unit per round for that channel, for the next 30 minutes |

A full day without the feed is 288 units per channel with the five minute interval.

## The program

```ts title="notifier.ts"
import { readFile, writeFile } from "node:fs/promises";
import { setTimeout as sleep } from "node:timers/promises";
import { YouTube, urls, type WatchedVideo } from "@ix-xs/youtube.api";

const channels = process.argv.slice(2);
const webhook = process.env.DISCORD_WEBHOOK_URL ?? "";
if (!channels.length || !webhook) {
  console.error("Usage: notifier.ts <channel> [more channels]");
  console.error("DISCORD_WEBHOOK_URL must be set.");
  process.exit(1);
}

const INTERVAL = 5 * 60_000;
// The feed lags a few minutes behind uploads: a restart looks back this far.
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
    const saved = JSON.parse(await readFile(STATE_FILE, "utf8"));
    return { posted: [], ...(saved as Partial<State>) };
  } catch (error) {
    const missing = (error as NodeJS.ErrnoException).code === "ENOENT";
    if (missing) return { posted: [] }; // first run
    throw error;
  }
}

const state = await loadState();
const saveState = () => writeFile(STATE_FILE, JSON.stringify(state));

const yt = new YouTube(); // reads YOUTUBE_API_KEY
const since =
  state.lastCheck === undefined ? Date.now() : state.lastCheck - OVERLAP;
const watcher = yt.watch(channels, { since });

let failed = false;
watcher.on("error", ({ channel, error }) => {
  failed = true;
  // `channel` is empty when a listener of yours failed, not a channel.
  const what = channel ? `Could not check ${channel}:` : "A listener failed:";
  console.warn(what, error instanceof Error ? error.message : error);
});

async function post(video: WatchedVideo): Promise<void> {
  const embed = {
    title: video.title,
    url: video.url,
    author: { name: video.channelTitle, url: urls.channel(video.channelId) },
    image: video.thumbnail ? { url: video.thumbnail } : undefined,
    timestamp: video.publishedAt,
    color: 0xff0000,
  };
  const response = await fetch(webhook, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ embeds: [embed] }),
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
  const fresh = found.filter((video) => !state.posted.includes(video.videoId));
  queue.push(...fresh);

  while (queue.length) {
    const video = queue[0]!;
    try {
      await post(video);
    } catch (error) {
      failed = true;
      const reason = error instanceof Error ? error.message : error;
      console.warn(`Could not post "${video.title}":`, reason);
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
export DISCORD_WEBHOOK_URL=...
node notifier.ts @GoogleDevelopers @YouTube
```

Node.js 22.18 and newer run a `.ts` file as it is. On an older version, use `npx tsx notifier.ts` with the same arguments.

Channels can be handles, channel URLs or `UC...` ids. The first run starts from now: it does not post the videos that already exist.

## How it works

**`watcher.check()` instead of `watcher.start()`.** `start()` polls on a timer and emits `video` events. Here the loop is written by hand, because the script has to know when a round is over and whether everything in it worked before it saves anything. `check()` runs one round and resolves to the new videos, oldest first.

**The state file.** `since` tells the watcher to report videos published after a given moment. Without it a watcher starts from the present, and whatever was uploaded while the process was down is lost. The script saves the start time of each round that fully succeeded and uses it at the next start.

**The overlap.** The public feed shows a video a few minutes after it goes public. A video published shortly before the saved time may not have been in the feed yet, so a restart passes a `since` 15 minutes earlier than the saved time. The `posted` list then filters out what was already sent. Inside one process the watcher does this itself: it remembers the ids it has seen.

**Errors.** A channel that cannot be checked emits `error` with its name and the round carries on with the others. A failed post leaves the video at the head of the queue. In both cases `lastCheck` keeps its old value, so nothing is skipped: the next round, or the next start, tries again. This also covers a webhook that refuses a post, whatever the reason.

**A channel that does not exist.** A handle or a URL that matches no channel is reported once, through the same `error` event. The watcher then leaves it alone and looks it up again 6 hours later, so a typo does not spend quota on every round. The other channels are not affected.

**The `error` payload.** It is `{ channel, error }`. `channel` is the reference as you gave it, or an empty string when the error came from one of your own listeners instead of a channel. This script has no other listener, so it only sees the first kind. The test is there for the day you add a `video` or `poll` listener.

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
      if (notification.type !== "video") return;
      if (posted.has(notification.videoId)) return;
      posted.add(notification.videoId);
      console.log(notification.title, notification.url); // post to Discord here
    },
  }),
).listen(3000);

const yt = new YouTube();
const channelId = await yt.channels.resolveId("@GoogleDevelopers");
if (channelId) {
  const callbackUrl = "https://example.com/youtube";
  await websub.subscribe({ channelId, callbackUrl, secret });
}
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

### Inside a Discord bot

A bot that is already running does not need the webhook. Move the loop into a function, call it once the bot is connected, and replace the `fetch` in `post()` with a message sent by the bot. The watcher, the state file and the queue stay as they are.

### Other variations

- One webhook per YouTube channel: key a `Map` by `video.channelId`.
- A line of text above the embed: add a `content` string next to `embeds` in the body.
- From a cron job: drop the loop and the `sleep`, and run the body once per invocation. [Watching uploads](/notifications/watching-uploads/) shows that shape.
