---
title: Comments
description: Read the comments of a video with their replies, post, reply, edit and delete, and moderate the comments on your own videos.
sidebar:
  order: 5
---

```ts
const threads = await yt.commentThreads
  .forVideo(videoId, { order: "relevance" })
  .take(20);

for (const thread of threads) {
  const comment = thread.snippet.topLevelComment.snippet;
  console.log(comment.authorDisplayName, comment.textDisplay);
}
```

## Threads and comments

The API has two resources, and so does the client:

- A comment thread is a top-level comment together with what is known about its replies. `yt.commentThreads` lists the threads of a video or a channel, and posts new ones.
- A comment is one message, top-level or reply. `yt.comments` lists replies, and replies, edits, deletes and moderates.

The id of a thread is also the id of its top-level comment.

## Reading the comments of a video

`yt.commentThreads.forVideo` takes a video id or URL. It works with an API key and costs 1 quota unit per page of up to 100 threads.

```ts
const url = "https://youtu.be/dQw4w9WgXcQ";
const threads = yt.commentThreads.forVideo(url, { textFormat: "plainText" });

for await (const thread of threads) {
  console.log(thread.snippet.topLevelComment.snippet.textDisplay);
}
```

That loop walks every thread of the video, 100 per call. A video with 10,000 top-level comments costs 100 units. Use `take` when you only need the first ones.

| Option | Values | What it does |
| --- | --- | --- |
| `order` | `"time"`, `"relevance"` | Sort order |
| `searchTerms` | Text | Only threads that match these words |
| `textFormat` | `"html"` (default), `"plainText"` | Format of `textDisplay` |
| `moderationStatus` | `"published"` (default), `"heldForReview"`, `"likelySpam"` | Only threads in this moderation status. The last two are only visible to the owner of the channel or video |
| `maxResults` | 1-100 | Size of a page. Left out, the helper asks for 100 |
| `part` | `"snippet"` (default), `"replies"`, `"id"` | Parts to fetch |

```ts
const mentions = await yt.commentThreads
  .forVideo(videoId, { searchTerms: "subtitles", order: "time" })
  .take(50);
```

## The shape of a thread

```ts
const thread = await yt.commentThreads.forVideo(videoId).first();

if (thread) {
  thread.id; // string, also the id of the top-level comment
  thread.snippet.totalReplyCount; // number
  thread.snippet.canReply; // boolean
  thread.snippet.videoId; // string | undefined

  const top = thread.snippet.topLevelComment;
  top.id; // string
  top.snippet.textDisplay; // string
  top.snippet.likeCount; // number
}
```

A comment nested in a thread, `topLevelComment` or an inline reply, is typed with its `snippet`. No `?.` is needed to read it.

Inside the snippet of a comment:

| Field | Type | Notes |
| --- | --- | --- |
| `textDisplay` | `string` | The text as displayed, in HTML or plain text depending on `textFormat`. It can differ from what was typed: links to videos become titles, for example |
| `textOriginal` | `string \| undefined` | The raw text as posted or last edited. Only guaranteed when you are the author |
| `authorDisplayName`, `authorProfileImageUrl`, `authorChannelUrl` | `string` | The author |
| `authorChannelId` | `{ value?: string } \| undefined` | The author's channel id, under `value` |
| `likeCount` | `number` | A number, unlike the counts of videos and channels |
| `publishedAt`, `updatedAt` | `string` | ISO 8601 dates |
| `viewerRating` | `"none" \| "like" \| "dislike"` | How the authenticated user rated the comment |
| `parentId` | `string \| undefined` | Id of the top-level comment. Only set on replies |
| `videoId`, `channelId` | `string \| undefined` | What the comment is about |
| `moderationStatus` | `"published" \| "heldForReview" \| "likelySpam" \| "rejected" \| undefined` | Not set when the comment was fetched by id |
| `imageUrl` | `string \| undefined` | Only when the comment has an image or a GIF. The link expires after six hours |

## Reading replies

Ask for the `replies` part and each thread comes with up to five replies inline. The part is optional in the type, because a thread without replies has none.

```ts
const threads = await yt.commentThreads
  .forVideo(videoId, { part: ["snippet", "replies"] })
  .take(20);

for (const thread of threads) {
  const inline = thread.replies?.comments ?? [];
  const { totalReplyCount } = thread.snippet;

  console.log(totalReplyCount, "replies,", inline.length, "inline");

  for (const reply of inline) console.log("  ", reply.snippet.textDisplay);
}
```

For all the replies of a thread, use `yt.comments.replies` with the thread id. It costs 1 unit per page of up to 100 replies.

```ts
const threads = await yt.commentThreads.forVideo(videoId).take(20);

for (const thread of threads) {
  // Nothing to fetch, nothing to pay.
  if (thread.snippet.totalReplyCount === 0) continue;

  const replies = yt.comments.replies(thread.id, { textFormat: "plainText" });

  for await (const reply of replies) {
    console.log(reply.snippet.authorDisplayName, reply.snippet.textDisplay);
  }
}
```

For a full export, request `replies` with the threads, and call `yt.comments.replies` only for the threads whose `totalReplyCount` is larger than what came inline. [Export comments](/recipes/export-comments/) is the recipe.

## Posting a comment

`yt.commentThreads.post` posts a top-level comment on a video. It needs OAuth and costs 50 units.

```ts
const thread = await yt.commentThreads.post(
  videoId,
  "Thanks for the walkthrough, the part on generics helped.",
);

console.log(thread.id, thread.snippet.topLevelComment.snippet.textDisplay);
```

## Replying to a comment

`yt.comments.reply` takes the id of the top-level comment, which is the id of the thread. It needs OAuth and costs 50 units.

```ts
const thread = await yt.commentThreads
  .forVideo(videoId, { order: "time" })
  .first();

if (thread) {
  const reply = await yt.comments.reply(thread.id, "Thanks!");
  console.log(reply.id, reply.snippet.parentId);
}
```

YouTube has one level of replies. To answer a reply, reply to its thread: the id to use is the `snippet.parentId` of that reply.

## Editing and deleting

`yt.comments.edit` replaces the text of one of your comments. `yt.comments.delete` deletes a comment. Each needs OAuth and costs 50 units.

```ts
const edited = await yt.comments.edit(
  commentId,
  "Thanks! (edited: fixed the link)",
);

console.log(edited.snippet.textOriginal, edited.snippet.updatedAt);

await yt.comments.delete({ id: commentId });
```

## Moderating comments

`yt.comments.setModerationStatus` publishes, holds for review or rejects comments on your channel or your videos. It takes one id or a list, and costs 50 units per call.

```ts
const held = await yt.commentThreads
  .forVideo(videoId, { moderationStatus: "heldForReview" })
  .take(50);

for (const thread of held) {
  console.log(thread.id, thread.snippet.topLevelComment.snippet.textOriginal);
}

// Approve them all in one call.
await yt.comments.setModerationStatus({
  id: held.map((thread) => thread.id),
  moderationStatus: "published",
});
```

`banAuthor: true` also adds the author to the ban list, so their future comments are rejected automatically. It is only valid together with `"rejected"`.

```ts
await yt.comments.setModerationStatus({
  id: commentId,
  moderationStatus: "rejected",
  banAuthor: true,
});
```

The statuses you can set are `"published"`, `"heldForReview"` and `"rejected"`. `"likelySpam"` is a status to filter on, not one to set, and the type refuses it:

```ts
await yt.comments.setModerationStatus({
  id: commentId,
  // @ts-expect-error "likelySpam" can be read, not set
  moderationStatus: "likelySpam",
});
```

`yt.comments.markAsSpam` is deprecated: YouTube no longer supports it. Reject the comment with `setModerationStatus` instead.

## Reading the comments of a whole channel

The raw `yt.commentThreads.list` takes other filters than a video. `allThreadsRelatedToChannelId` returns the threads of every video of a channel, and the comments on the channel itself. It costs 1 unit per page of up to 100, like the rest.

```ts
const recent = await yt.commentThreads
  .list({
    part: "snippet",
    allThreadsRelatedToChannelId: channelId,
    order: "time",
  })
  .take(100);

for (const thread of recent) {
  const top = thread.snippet.topLevelComment;
  console.log(thread.snippet.videoId, top.snippet.textDisplay);
}
```

| Filter of `commentThreads.list` | Returns |
| --- | --- |
| `videoId` | The threads of a video. What `forVideo` uses |
| `allThreadsRelatedToChannelId` | The threads of all the videos of a channel, plus the channel's own comments |
| `channelId` | The threads about the channel itself, without those left on its videos |
| `id` | The threads with these ids |

`yt.comments.list` fetches comments by `id`, or the replies of a comment with `parentId`, which is what `yt.comments.replies` uses.

```ts
const { items } = await yt.comments.list({
  part: "snippet",
  id: [commentId],
  textFormat: "plainText",
});
```

Awaited without `maxResults`, the two raw `list` methods return the API's default page of 20, where `forVideo` and `replies` ask for 100.

## What it costs

| Call | Quota |
| --- | --- |
| Reading threads or replies | 1 unit per page of up to 100 |
| Posting, replying, editing, deleting | 50 units each |
| Setting a moderation status | 50 units per call, whatever the number of ids |

Reads are cheap and writes are not: 200 replies in a day use the whole default budget of 10,000 units.

## Scope and credentials

Reading works with an API key. Every write needs OAuth with the `youtube.force-ssl` scope, the only one the comment methods accept.

```ts
const { url } = await oauth.authUrl({ scopes: ["youtube.force-ssl"] });
```

The client checks before sending. A write with only an API key throws a `YouTubeAuthError` with the code `MISSING_CREDENTIALS`. A write with a token granted without the scope throws one with the code `INSUFFICIENT_SCOPE`. Neither costs quota.

A read with such a token goes out with the API key when the client has one. Without a key, it throws `INSUFFICIENT_SCOPE` too. [Scopes](/auth/scopes/) has the details.

## Handling errors

A call the API refuses throws a `YouTubeApiError`. The reasons worth a branch:

| `error.reason` | When |
| --- | --- |
| `commentsDisabled` | Comments are turned off on the video |
| `forbidden` | The request is not allowed with these credentials |
| `videoNotFound`, `commentThreadNotFound`, `commentNotFound` | The video, the thread or the comment was not found |

```ts
try {
  await yt.commentThreads.post(videoId, "Nice one");
} catch (error) {
  if (!(error instanceof YouTubeApiError)) throw error;

  if (error.reason === "commentsDisabled") {
    console.log("Comments are turned off on this video");
  } else if (error.reason === "forbidden") {
    console.log("Not allowed:", error.message);
  } else {
    throw error;
  }
}
```

## Reference

Helpers:

| Helper | What it does | Quota |
| --- | --- | --- |
| `yt.commentThreads.forVideo(video, options)` | The comment threads of a video | 1 per page of 100 |
| `yt.commentThreads.post(video, text)` | Posts a top-level comment. OAuth | 50 |
| `yt.comments.replies(parentId, { part, textFormat, maxResults })` | Every reply to a top-level comment | 1 per page of 100 |
| `yt.comments.reply(parentId, text)` | Replies to a comment. OAuth | 50 |
| `yt.comments.edit(commentId, text)` | Replaces the text of one of your comments. OAuth | 50 |

Raw methods:

| Method | Quota | Auth |
| --- | --- | --- |
| `yt.commentThreads.list` | 1 | Key, or OAuth to see private data |
| `yt.commentThreads.insert` | 50 | OAuth |
| `yt.comments.list` | 1 | Key, or OAuth to see private data |
| `yt.comments.insert` | 50 | OAuth |
| `yt.comments.update` | 50 | OAuth |
| `yt.comments.delete` | 50 | OAuth |
| `yt.comments.setModerationStatus` | 50 | OAuth |
| `yt.comments.markAsSpam` (deprecated) | 50 | OAuth |

Parts of a comment thread:

| Part | What it holds | Always returned when requested |
| --- | --- | --- |
| `snippet` | The top-level comment, `totalReplyCount`, `canReply`, `isPublic`, `videoId` | Yes |
| `replies` | Up to five replies, under `comments` | No |
| `id` | Nothing more: `kind`, `etag` and `id` are on every result | Yes |

Parts of a comment:

| Part | What it holds | Always returned when requested |
| --- | --- | --- |
| `snippet` | Text, author, like count, dates, `parentId` | Yes |
| `id` | Nothing more: `kind`, `etag` and `id` are on every result | Yes |

## See also

- [Export comments](/recipes/export-comments/) for a complete export script.
- [Lists](/basics/lists/) for `take`, `all` and iteration.
- [Scopes](/auth/scopes/) for `youtube.force-ssl` and the others.
- [Live chat](/live/live-chat/) for the messages of a live broadcast, which are not comments.
