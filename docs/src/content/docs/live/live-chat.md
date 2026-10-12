---
title: Live chat
description: Read the chat of a live broadcast as messages arrive, tell Super Chats and new members from plain text, and send, delete, ban and moderate. Reading works with an API key.
sidebar:
  order: 2
---

```ts
const chat = await yt.liveChatOf("https://www.youtube.com/watch?v=jfKfPfyJRdk");

for await (const message of chat.messages()) {
  const { displayName } = message.authorDetails;
  console.log(`${displayName}: ${message.snippet.displayMessage}`);
}
```

## Opening a chat

`yt.liveChatOf(video)` takes a video id or any video URL and finds the chat of that broadcast. Quota: 1 unit, for one `videos.list` call.

```ts
const chat = await yt.liveChatOf(videoId);

chat.id; // the live chat id
```

It throws a `YouTubeArgumentError` when the string is not a video, when the video does not exist or is private, and when it has no active chat: the video is not live right now, or its chat is turned off.

When you already have the chat id, `yt.liveChat(liveChatId)` builds the same object without any call. The id is `liveStreamingDetails.activeLiveChatId` on a video, or `snippet.liveChatId` on [your own broadcast](/live/broadcasts/).

```ts
const chat = yt.liveChat(liveChatId);
```

## Reading messages

`chat.messages()` is an async generator. It asks YouTube for new messages, yields them, waits for the time YouTube asks for, and starts again. Quota: 5 units per request.

```ts
const chat = yt.liveChat(liveChatId);

const stop = new AbortController();
process.once("SIGINT", () => stop.abort());

const messages = chat.messages({ signal: stop.signal, minInterval: "10s" });

for await (const { snippet, authorDetails } of messages) {
  console.log(snippet.publishedAt, authorDetails.displayName);
  console.log(snippet.displayMessage);
}

console.log("Chat closed.");
```

Each message is a `ChatMessage`: a chat message with its `snippet` and its `authorDetails`.

| Option | Default | Effect |
| --- | --- | --- |
| `history` | `false` | `true` also yields the messages already in the chat when reading starts |
| `minInterval` | none | Never ask more often than this, even when YouTube allows it. In `"stream"` mode, the pause before reconnecting |
| `signal` | none | Aborting it ends the loop quietly |
| `profileImageSize` | API default | Size in pixels of `authorDetails.profileImageUrl`, from 16 to 720 |
| `hl` | API default | Language of the system messages, for example `"fr"` |
| `mode` | `"poll"` | `"stream"` keeps one connection open. [Experimental](#one-connection-instead-of-polling) |

Without `history`, the first request is still made. Its messages are skipped, and it tells the loop where "now" is.

## With a callback

`chat.listen()` runs the same loop in the background and calls you for each message. It returns a handle.

```ts
const chat = yt.liveChat(liveChatId);

const subscription = chat.listen(
  (message) => {
    if (message.snippet.displayMessage === "!hello") void chat.send("Hello!");
  },
  {
    minInterval: "5s",
    onError: (error) => console.error("Chat reading failed:", error),
  },
);

// Later.
subscription.stop();
await subscription.done;
```

`done` settles when listening is over: the chat ended, `stop()` was called, or reading failed. A failure goes to `onError` when you gave one. Without it, the failure rejects `done`.

The callback can be async. Messages are delivered one at a time: the next one waits for your callback to finish. A callback that throws ends the loop and counts as a failure.

`listen` takes the options of `messages()` except `signal`: `stop()` replaces it.

## Telling message types apart

A chat carries more than text. Switch on `message.snippet.type`, then read the details object that goes with it.

```ts
const chat = yt.liveChat(liveChatId);

for await (const { snippet, authorDetails } of chat.messages()) {
  const author = authorDetails.displayName;

  switch (snippet.type) {
    case "textMessageEvent":
      console.log(`${author}: ${snippet.textMessageDetails?.messageText}`);
      break;
    case "superChatEvent": {
      const paid = snippet.superChatDetails;
      const comment = paid?.userComment ?? "";
      console.log(`${author} sent ${paid?.amountDisplayString}: ${comment}`);
      break;
    }
    case "superStickerEvent": {
      const amount = snippet.superStickerDetails?.amountDisplayString;
      console.log(`${author} sent a sticker worth ${amount}`);
      break;
    }
    case "newSponsorEvent": {
      const level = snippet.newSponsorDetails?.memberLevelName ?? "no level";
      console.log(`${author} joined as a member (${level})`);
      break;
    }
    case "memberMilestoneChatEvent": {
      const months = snippet.memberMilestoneChatDetails?.memberMonth;
      console.log(`${author}: member for ${months} months`);
      break;
    }
    case "membershipGiftingEvent": {
      const count = snippet.membershipGiftingDetails?.giftMembershipsCount;
      console.log(`${author} gifted ${count} memberships`);
      break;
    }
    default:
      if (snippet.displayMessage) console.log(snippet.displayMessage);
  }
}
```

YouTube calls members "sponsors" in this API: `newSponsorEvent` is a new member, `isChatSponsor` is "is a member".

Every details object is optional in the types, because it is only set for its own message type. `displayMessage` is the text to show for the message, whatever the type. It is absent on `tombstone` and `chatEndedEvent`, which are silent.

Amounts come as a display string and as micros. Divide by one million to get the amount:

```ts
function superChatAmount(message: ChatMessage) {
  const details = message.snippet.superChatDetails;
  if (!details?.amountMicros || !details.currency) return undefined;
  return {
    amount: Number(details.amountMicros) / 1_000_000,
    currency: details.currency,
  };
}
```

The author's role is on `authorDetails`:

```ts
const chat = yt.liveChat(liveChatId);

for await (const { snippet, authorDetails: author } of chat.messages()) {
  const text = snippet.displayMessage;

  if (author.isChatOwner || author.isChatModerator) console.log("staff:", text);
  else if (author.isChatSponsor) console.log("member:", text);
  else if (author.isVerified) console.log("verified:", text);
}
```

## What reading costs

Each request costs 5 units, and the loop makes one after each wait for as long as it runs. The wait is the one YouTube returns with each answer, or 5 seconds when the answer gives none.

With a wait of 5 seconds:

| Pace | Requests per hour | Units per hour | The 10,000 daily units last |
| --- | --- | --- | --- |
| 5 seconds | 720 | 3,600 | 2 h 46 min |
| `minInterval: "15s"` | 240 | 1,200 | 8 h 20 min |
| `minInterval: "30s"` | 120 | 600 | 16 h 40 min |
| `minInterval: "1m"` | 60 | 300 | The whole day: 7,200 units in 24 hours |

`minInterval` is a floor. When YouTube asks for a longer wait, the longer one wins. A slower pace does not skip messages: each request asks for up to 2,000 of them and continues from where the previous one stopped. They only reach you later.

Two chats read at once cost twice as much. [Quota](/basics/quota/) shows how to watch the count and how to refuse calls over a budget.

## When the loop ends

The loop ends without an error when:

- the answer says the broadcast went offline, or the API answers that the chat ended (`liveChatEnded`) or is disabled (`liveChatDisabled`);
- `signal` was aborted, or `stop()` was called.

Anything else throws out of the `for await`, after the client's own retries: quota exhausted, credentials refused, network down.

```ts
const chat = yt.liveChat(liveChatId);

try {
  for await (const message of chat.messages()) {
    console.log(message.snippet.displayMessage);
  }
  console.log("The chat is over.");
} catch (error) {
  if (!isYouTubeError(error, "QUOTA_EXCEEDED")) throw error;
  console.log("Out of quota until", yt.quota.resetsAt);
}
```

Chat reads never use the response cache, even when the client has one: a cached page would replay old messages as if they were new. If you call the raw `yt.liveChatMessages.list` yourself on a client with a cache, pass `{ cache: false }`.

## Sending and deleting

Writing needs OAuth with the `youtube` or `youtube.force-ssl` scope.

```ts
const chat = yt.liveChat(liveChatId);

const sent = await chat.send("Thanks for watching!"); // 20 units
console.log(sent.id, sent.snippet.publishedAt);

await chat.delete(messageId); // 20 units
```

`send` posts as the authenticated user and resolves to the message created. `delete` is for the channel owner and the moderators. The id of a message is `message.id`.

## Banning

`chat.ban()` takes the channel id of the user. With `duration` the ban is temporary. Without it, the ban is permanent. Quota: 200 units.

```ts
const chat = yt.liveChat(liveChatId);

for await (const message of chat.messages()) {
  if (!message.snippet.displayMessage?.includes("spam.example")) continue;

  await chat.delete(message.id); // 20 units
  const ban = await chat.ban(message.authorDetails.channelId, {
    duration: "5m",
  });
  console.log("Banned for 5 minutes, ban id", ban.id);
}
```

Keep the `id` of the ban: it is what `unban` takes. Quota: 200 units.

```ts
const chat = yt.liveChat(liveChatId);

const ban = await chat.ban(channelId); // permanent
await chat.unban(ban.id);
```

`duration` is a number of milliseconds or a string such as `"30s"`, `"5m"`, `"2h"`. It is sent in whole seconds, one at least.

## Moderators

```ts
const chat = yt.liveChat(liveChatId);

const moderators = await chat.moderators(); // 50 units per page

for (const moderator of moderators) {
  console.log(moderator.id, moderator.snippet.moderatorDetails?.displayName);
}

const added = await chat.addModerator(channelId); // 200 units
await chat.removeModerator(added.id); // 200 units
```

`moderators()` reads every page and resolves to one array. `addModerator` takes a channel id. `removeModerator` takes the id of the moderator resource, the one `addModerator` and `moderators()` return, not the channel id.

## Super Chat history

`superChatEvents.list` returns the Super Chats and Super Stickers your channel received during the last 30 days, without reading any chat. Quota: 1 unit per page. It needs OAuth.

```ts
for await (const event of yt.superChatEvents.list({ part: "snippet" })) {
  const { supporterDetails, displayString, createdAt } = event.snippet;
  const what = event.snippet.isSuperStickerEvent
    ? "(sticker)"
    : event.snippet.commentText;
  console.log(createdAt, supporterDetails?.displayName, displayString, what);
}
```

`amountMicros` and `currency` carry the amount in numbers, the same way as in the chat.

## One connection instead of polling

`mode: "stream"` reads the chat over one long-lived connection:

```ts
const chat = yt.liveChat(liveChatId);

for await (const message of chat.messages({ mode: "stream" })) {
  console.log(message.snippet.displayMessage);
}
```

:::caution
This is experimental. YouTube documents this method for gRPC only. The library goes through the HTTP mapping of the same method, which Google does not document. Prefer the default polling when you need something dependable.
:::

Quota: 5 units per connection. When the server closes the connection, the loop pauses, then reconnects from the last position. The pause is `minInterval`, and 1 second at least.

A connection is one request, and the client's `timeout` does not apply to it. A connection that drops is reopened from the last position, with a longer pause each time. After three drops in a row without a message, the loop throws a `YouTubeRequestError` with code `NETWORK`. Pass a `signal` to stop.

The method behind it is `yt.liveChatMessages.stream()`. Each value is a batch shaped like a `list` response. Pass its `nextPageToken` as `pageToken` to resume after a disconnect.

```ts
const batches = yt.liveChatMessages.stream({
  liveChatId,
  part: ["snippet", "authorDetails"],
});

for await (const batch of batches) {
  console.log(batch.items.length, "messages, resume at", batch.nextPageToken);
}
```

## Reference

### `LiveChat`

| Member | Cost | Auth | What it does |
| --- | --- | --- | --- |
| `yt.liveChatOf(video)` | 1 | API key | Opens the chat of a live video |
| `yt.liveChat(liveChatId)` | 0 | | Opens a chat from its id |
| `chat.id` | | | The live chat id |
| `chat.messages(options)` | 5 per request | API key | Yields messages as they arrive |
| `chat.listen(onMessage, options)` | 5 per request | API key | Same, with a callback. Returns `{ stop, done }` |
| `chat.send(text)` | 20 | OAuth | Sends a text message |
| `chat.delete(messageId)` | 20 | OAuth | Deletes a message |
| `chat.ban(channelId, { duration })` | 200 | OAuth | Bans a user, for good or for `duration` |
| `chat.unban(banId)` | 200 | OAuth | Lifts a ban |
| `chat.moderators()` | 50 per page | OAuth | Lists the moderators |
| `chat.addModerator(channelId)` | 200 | OAuth | Makes a user a moderator |
| `chat.removeModerator(moderatorId)` | 200 | OAuth | Removes a moderator |

In `"stream"` mode, `messages` and `listen` cost 5 units per connection.

`liveChatOf` and the methods from `send` down also take the [options of one call](/basics/configuration/) as their last argument. `ban` takes them next to `duration`.

The raw methods are there too: `yt.liveChatMessages` (`list`, `insert`, `delete`, `stream`, and `transition`, which closes a running poll for 20 units), `yt.liveChatBans`, `yt.liveChatModerators` and `yt.superChatEvents`.

### Values of `snippet.type`

| Type | Details in | What happened |
| --- | --- | --- |
| `textMessageEvent` | `textMessageDetails` | A viewer wrote a message: `messageText` |
| `superChatEvent` | `superChatDetails` | A Super Chat: `amountDisplayString`, `amountMicros`, `currency`, `tier`, `userComment` |
| `superStickerEvent` | `superStickerDetails` | A Super Sticker: the same amount fields and `tier`, with `superStickerMetadata` |
| `newSponsorEvent` | `newSponsorDetails` | A viewer became a member: `memberLevelName`, `isUpgrade` |
| `memberMilestoneChatEvent` | `memberMilestoneChatDetails` | A member's milestone message: `memberMonth`, `memberLevelName`, `userComment` |
| `membershipGiftingEvent` | `membershipGiftingDetails` | A viewer bought gift memberships: `giftMembershipsCount`, `giftMembershipsLevelName` |
| `giftMembershipReceivedEvent` | `giftMembershipReceivedDetails` | A viewer received a gift membership: `memberLevelName`, `gifterChannelId`, `associatedMembershipGiftingMessageId` |
| `giftEvent` | `giftDetails` | A virtual gift sent to support the creator |
| `pollEvent` | `pollDetails` | A poll: `status`, and `metadata` with the question and the options |
| `userBannedEvent` | `userBannedDetails` | A moderator banned a user: `bannedUserDetails`, `banType`, `banDurationSeconds` |
| `messageDeletedEvent` | `messageDeletedDetails` | A message was deleted. The details are deprecated |
| `messageRetractedEvent` | `messageRetractedDetails` | An author retracted a message. The details are deprecated |
| `sponsorOnlyModeStartedEvent` | | Members-only mode was turned on |
| `sponsorOnlyModeEndedEvent` | | Members-only mode was turned off |
| `chatEndedEvent` | | The chat ended. Silent: no `displayMessage` |
| `tombstone` | | Silent: no `displayMessage` |
| `fanFundingEvent` | `fanFundingEventDetails` | The details are deprecated |
| `invalidType` | | Not a valid message type |

Fields of `snippet` that are always there: `type`, `liveChatId`, `publishedAt`, `hasDisplayContent`. `authorChannelId` is not always filled: read the author from `authorDetails`.

### `authorDetails`

`channelId`, `channelUrl`, `displayName`, `profileImageUrl`, and four flags: `isChatOwner`, `isChatModerator`, `isChatSponsor`, `isVerified`. All are always present.

## Limits and errors

| Situation | What you get |
| --- | --- |
| A write with an API key only | `YouTubeAuthError`, code `MISSING_CREDENTIALS`, thrown before anything is sent. No quota spent |
| A write with a token known to have neither `youtube` nor `youtube.force-ssl` | `YouTubeAuthError`, code `INSUFFICIENT_SCOPE`, thrown before anything is sent |
| `liveChatOf` on a video that is not live | `YouTubeArgumentError` |
| The chat ended or is disabled while reading | The loop ends, no error |
| Quota used up | `YouTubeApiError`, code `QUOTA_EXCEEDED` |

Listing moderators and the Super Chat history also accept the `youtube.readonly` scope.

On the other calls, the chat-specific values of `error.reason` are `liveChatNotFound`, `liveChatEnded` and `liveChatDisabled`.

Moderation is expensive: a ban costs 200 units, so 50 bans use a full day of the default quota. Count them before you automate.

## See also

- [Broadcasts and streams](/live/broadcasts/) to create the broadcast the chat belongs to.
- [A live chat bot](/recipes/live-chat-bot/) for a complete program.
- [Quota](/basics/quota/) to track what a long reading session spends.
- [Errors](/basics/errors/) for `error.code` and `error.reason`.
