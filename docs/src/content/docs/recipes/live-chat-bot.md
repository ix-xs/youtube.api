---
title: Live chat bot
description: A bot for your own live stream that answers commands, thanks Super Chats and times out messages containing banned words. It reads the chat by polling, so the daily quota decides how long it can run.
sidebar:
  order: 5
---

## What you get

A process that sits in the chat of a broadcast, replies to `!uptime` and `!discord`, thanks every Super Chat, and bans for five minutes whoever posts a word from your list. It stops by itself when the stream ends, or on Ctrl+C.

## What it needs

| | |
| --- | --- |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | An OAuth client of type **Desktop app**, see [Credentials](/start/credentials/) |
| The account you sign in with | The channel that owns the stream, or one of its chat moderators. It is the account that speaks in chat |
| `BANNED_WORDS` | Optional. Comma-separated words that get a time-out |
| `DISCORD_INVITE` | Optional. The link `!discord` answers with |

Quota, all from the shared bucket, 10,000 units a day by default:

| Action | Cost |
| --- | --- |
| Starting: `channels.mine`, `liveChatOf`, `videos.get` | 3 units |
| Each read of the chat | 5 units |
| Each message sent | 20 units |
| Each ban | 200 units |

Reading is what adds up. At one read every 10 seconds, as set below, an hour costs 1,800 units before the bot says anything: the default allocation covers about five and a half hours of stream a day, less every reply and every ban. A reply costs as much as four reads, a ban as much as forty. `minInterval` is the lever: `"30s"` brings an hour of reading down to 600 units.

## The program

```ts title="chat-bot.ts"
import {
  OAuth2,
  YouTube,
  formatDuration,
  isYouTubeError,
  type ChatMessage,
} from "@ix-xs/youtube.api";
import { authorize, tokenFile } from "@ix-xs/youtube.api/node";

const video = process.argv[2];
const clientId = process.env.GOOGLE_CLIENT_ID;
const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
if (!video || !clientId || !clientSecret) {
  console.error("Usage: chat-bot.ts <URL or id of the live video>");
  console.error("GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET must be set.");
  process.exit(1);
}

const DISCORD_INVITE =
  process.env.DISCORD_INVITE ?? "https://example.com/invite";
const BANNED_WORDS = (process.env.BANNED_WORDS ?? "")
  .split(",")
  .map((word) => word.trim().toLowerCase())
  .filter(Boolean);
const COOLDOWN = 30_000;

// 1. Sign in. The browser opens on the first run, then the file has the tokens.
const SCOPE = "youtube.force-ssl";
const store = tokenFile("./tokens.json");
const oauth = new OAuth2({
  clientId,
  clientSecret,
  tokens: await store.load(),
  onTokens: store.save,
});
if (!oauth.canRefresh || !oauth.grantedScopes?.has(SCOPE)) {
  await authorize(oauth, { scopes: [SCOPE] });
}
const yt = new YouTube({ oauth });

// 2. Who the bot is, which chat it joins, and when the stream started.
const me = await yt.channels.mine({ part: "snippet" });
if (!me) {
  console.error("This Google account has no YouTube channel.");
  process.exit(1);
}
const chat = await yt.liveChatOf(video);
const live = await yt.videos.get(video, { part: "liveStreamingDetails" });
const startedAt =
  Date.parse(live?.liveStreamingDetails?.actualStartTime ?? "") || Date.now();

// 3. What it answers.
const uptime = () => formatDuration((Date.now() - startedAt) / 1000, "short");
const commands: Record<string, () => string> = {
  "!uptime": () => `Live for ${uptime()}.`,
  "!discord": () => `Join the Discord: ${DISCORD_INVITE}`,
};
const lastUsed = new Map<string, number>();

async function handle(message: ChatMessage): Promise<void> {
  const { snippet, authorDetails: author } = message;

  if (snippet.type === "superChatEvent") {
    const amount = snippet.superChatDetails?.amountDisplayString;
    const gift = amount ?? "the Super Chat";
    await chat.send(`Thank you ${author.displayName} for ${gift}!`);
    return;
  }
  if (snippet.type !== "textMessageEvent") return;

  const raw = snippet.textMessageDetails?.messageText ?? snippet.displayMessage;
  const text = (raw ?? "").trim().toLowerCase();
  const staff = author.isChatOwner || author.isChatModerator;

  if (!staff && BANNED_WORDS.some((word) => text.includes(word))) {
    await chat.ban(author.channelId, { duration: "5m" });
    console.log(`Timed out ${author.displayName} for 5 minutes.`);
    return;
  }

  const name = text.split(/\s+/)[0] ?? "";
  const reply = commands[name];
  if (!reply) return;
  if (Date.now() - (lastUsed.get(name) ?? 0) < COOLDOWN) return;
  lastUsed.set(name, Date.now());
  await chat.send(reply());
}

// 4. Read until the stream ends or Ctrl+C.
const stop = new AbortController();
process.once("SIGINT", () => stop.abort());
process.once("SIGTERM", () => stop.abort());

console.log(`${me.snippet.title} joined the chat. Ctrl+C to stop.`);

const messages = chat.messages({ signal: stop.signal, minInterval: "10s" });
for await (const message of messages) {
  if (message.authorDetails.channelId === me.id) continue; // its own messages
  try {
    await handle(message);
  } catch (error) {
    const code = isYouTubeError(error) ? error.code : undefined;
    if (code === "QUOTA_EXCEEDED" || code === "QUOTA_BUDGET_EXCEEDED") {
      console.error(`Out of quota until ${yt.quota.resetsAt.toISOString()}.`);
      break;
    }
    const reason = error instanceof Error ? error.message : error;
    console.warn("Could not handle a message:", reason);
  }
}

console.log(`Chat closed. Quota spent: ${yt.quota.used} units.`);
```

## Run it

```bash
npm install @ix-xs/youtube.api

export GOOGLE_CLIENT_ID=...
export GOOGLE_CLIENT_SECRET=...
export BANNED_WORDS="spam.example,free followers"
node chat-bot.ts https://www.youtube.com/watch?v=jfKfPfyJRdk
```

Node.js 22.18 and newer run a `.ts` file as it is. On an older version, use `npx tsx chat-bot.ts` with the same argument.

Start it once the broadcast is live: `liveChatOf` throws when the video has no active chat. The first run opens the consent page. Sign in with the account the bot should speak as.

## How it works

**The scope.** `youtube.force-ssl` is accepted by every call the bot makes: reading the channel and the video, reading the chat, sending messages and banning. `youtube` would work as well.

**`yt.liveChatOf(video)`** reads the video once to find the id of its chat, and returns the object that reads, writes and moderates it. The script fetches the video a second time for `liveStreamingDetails.actualStartTime`, which `!uptime` needs. When that field is missing, the bot counts from its own start.

**`chat.messages()`** is the polling loop. It only yields messages posted after the bot started, waits between two reads for as long as YouTube asks, and never less than `minInterval`. Each read continues from the page token of the previous one and asks for up to 2,000 messages, so a longer interval delivers the same messages later, in larger batches. `minInterval` is therefore also the longest a viewer waits for an answer.

**Ignoring its own messages.** The bot's replies come back through the chat like any other message. Comparing `authorDetails.channelId` with the id of the signed-in channel drops them. Without this test a reply that starts with a command name would trigger the bot again.

**Super Chats** arrive in the same stream with `snippet.type === "superChatEvent"`. `superChatDetails.amountDisplayString` is the amount as a display string. It is optional in the type, hence the fallback text.

**The cooldown is per command**, not per viewer. Twenty people typing `!discord` in the same half minute get one answer, which is 20 units instead of 400.

**The time-out.** `chat.ban` with a `duration` is a temporary ban. Without `duration` it is permanent. The owner and the moderators are exempt here, so a moderator can quote a banned word. Matching is a plain substring test on the lowercased text: adapt it before trusting it with a real audience.

**Stopping.** Aborting the signal ends the `for await` without an error, and the last line still runs. The loop also ends by itself when the broadcast goes offline or the chat is closed.

**One bad message does not stop the bot.** A reply or a ban that fails is logged and the loop moves on. Running out of quota is the exception: every later call would fail the same way until the reset, so the bot leaves.

**A read that fails does stop it.** When `chat.messages()` itself cannot read the chat, after the client's retries, the error is thrown out of the `for await` and the process ends with it. That is the right outcome for refused credentials or an exhausted quota. Run the bot under a supervisor if you want it back after a network outage.

## Going further

### Remove the message too

To delete the offending message as well, `chat.delete` takes its id. It costs 20 units:

```ts
const chat = await yt.liveChatOf(videoId);

for await (const message of chat.messages()) {
  if (message.snippet.displayMessage?.includes("spam.example")) {
    await chat.delete(message.id);
    await chat.ban(message.authorDetails.channelId, { duration: "5m" });
  }
}
```

### Cap what the bot can spend

Give the client a budget and it refuses the call that would go over, before sending it. The rest of the day's quota stays available to your other tools.

```ts
import { YouTube } from "@ix-xs/youtube.api";

const yt = new YouTube({
  oauth,
  quota: { enforce: true, limits: { default: 6000 } },
});
```

The refused call throws a `QUOTA_BUDGET_EXCEEDED` error. The loop above treats it like an exhausted quota: the bot leaves at the first reply or ban that does not fit. A read that does not fit throws the same error out of the `for await`.

### Read without signing in

A bot that only watches, to log Super Chats or count messages, needs no OAuth: reading works with an API key. Drop the sign-in, the `me` lookup, and the `chat.send` and `chat.ban` calls.

### More

- [Live chat](/live/live-chat/) for every message type, moderators, and the callback form `chat.listen`.
- [Quota](/basics/quota/) to follow the spend while the bot runs.
- [Scripts and devices](/auth/scripts-and-devices/) to run it on a machine without a browser.
