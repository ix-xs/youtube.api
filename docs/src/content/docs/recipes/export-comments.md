---
title: Export the comments of a video
description: A script that writes every comment and every reply of a video to a JSON Lines or CSV file, one row per comment. An API key is enough.
sidebar:
  order: 4
---

## What you get

A file with one row per comment: its id, its parent when it is a reply, the author, the text, the like count and the dates. The script streams to disk as it reads, so a video with hundreds of thousands of comments does not have to fit in memory.

## What it needs

An API key in `YOUTUBE_API_KEY`, see [Credentials](/start/credentials/).

Quota: 1 unit per 100 threads, plus 1 unit per page of 100 replies for each thread that has more replies than the five the API sends along. A video with 5,000 threads, 40 of which have between 6 and 100 replies, costs 90 units.

## The program

```ts title="export-comments.ts"
import { once } from "node:events";
import { createWriteStream } from "node:fs";
import { finished } from "node:stream/promises";
import { YouTube, YouTubeApiError, videoIdFrom, type Comment } from "@ix-xs/youtube.api";

const [input, output = "comments.jsonl"] = process.argv.slice(2);
const videoId = input ? videoIdFrom(input) : null;
if (!videoId) {
  console.error("Usage: export-comments.ts <video URL or id> [comments.jsonl | comments.csv]");
  process.exit(1);
}

const yt = new YouTube(); // reads YOUTUBE_API_KEY
const csv = output.endsWith(".csv");
const out = createWriteStream(output);

const COLUMNS = ["id", "parentId", "author", "authorChannelId", "text", "likes", "publishedAt", "updatedAt"] as const;
type Row = Record<(typeof COLUMNS)[number], string | number>;

/** Waits when the disk is slower than the API. */
async function write(line: string): Promise<void> {
  if (!out.write(`${line}\n`)) await once(out, "drain");
}

const quote = (value: string | number) => `"${String(value).replaceAll('"', '""')}"`;
let rows = 0;

async function save(comment: Comment): Promise<void> {
  const { id, snippet } = comment;
  if (!id || !snippet) return;
  const row: Row = {
    id,
    parentId: snippet.parentId ?? "",
    author: snippet.authorDisplayName,
    authorChannelId: snippet.authorChannelId?.value ?? "",
    text: snippet.textDisplay,
    likes: snippet.likeCount,
    publishedAt: snippet.publishedAt,
    updatedAt: snippet.updatedAt,
  };
  await write(csv ? COLUMNS.map((column) => quote(row[column])).join(",") : JSON.stringify(row));
  rows++;
}

if (csv) await write(COLUMNS.join(","));
let threads = 0;

try {
  const list = yt.commentThreads.forVideo(videoId, { part: ["snippet", "replies"], textFormat: "plainText" });
  for await (const thread of list) {
    threads++;
    await save(thread.snippet.topLevelComment);

    const inlined = thread.replies?.comments ?? [];
    if (thread.snippet.totalReplyCount > inlined.length) {
      // The thread holds more replies than it carries: read them all.
      for await (const reply of yt.comments.replies(thread.id, { textFormat: "plainText" })) await save(reply);
    } else {
      for (const reply of inlined) await save(reply);
    }
    if (threads % 500 === 0) console.log(`${threads} threads, ${rows} comments...`);
  }
  console.log(`Wrote ${rows} comments from ${threads} threads to ${output}. Quota: ${yt.quota.used} units.`);
} catch (error) {
  if (error instanceof YouTubeApiError && error.reason === "commentsDisabled") {
    console.error("Comments are turned off on this video.");
  } else if (error instanceof YouTubeApiError && error.isNotFound) {
    console.error("This video does not exist or is private.");
  } else {
    throw error;
  }
  process.exitCode = 1;
} finally {
  out.end();
  await finished(out);
}
```

## Run it

```bash
npm install @ix-xs/youtube.api

export YOUTUBE_API_KEY=...
node export-comments.ts https://youtu.be/dQw4w9WgXcQ comments.csv
```

Node.js 22.18 and newer run a `.ts` file as it is. On Node.js 20, use `npx tsx export-comments.ts` with the same arguments.

The extension of the second argument picks the format. `.csv` writes a header and quoted cells. Anything else writes JSON Lines, one object per line:

```json
{"id":"Ugx...","parentId":"","author":"@someone","authorChannelId":"UC...","text":"First!","likes":12,"publishedAt":"2026-03-01T10:00:00Z","updatedAt":"2026-03-01T10:00:00Z"}
```

## How it works

**Threads, then replies.** A comment thread is a top-level comment with its replies. `yt.commentThreads.forVideo` lists the threads of a video, 100 per page when you iterate. With the `replies` part, each thread carries up to five of its replies. `snippet.totalReplyCount` says how many there are in all.

**`yt.comments.replies(thread.id)`** lists every reply of a thread. The id of a thread is also the id of its top-level comment, which is what `parentId` expects. The script only makes that call when the thread has more replies than it carries, and then takes all of them from that one source, so no reply is written twice.

**`replies` stays optional in the type.** The API can leave the part out even when you ask for it, on a thread without replies for instance. Hence `thread.replies?.comments ?? []`.

**`textFormat: "plainText"`.** The API returns comment text as HTML by default. Plain text is the better raw material for a file. It is passed to both calls so replies match their parents.

**`save` takes a `Comment`.** A top-level comment inside a thread and a reply inside `replies.comments` are full comment resources whose `id` and `snippet` are optional in the type. A reply from `yt.comments.replies` is a `Comment<"snippet">`, which can be passed where a plain `Comment` is expected. One function handles the three.

**`commentsDisabled`** is the `reason` of the error when the owner turned comments off. It is worth its own message because it is a property of the video, not a failure. Everything else is rethrown with its stack.

**Backpressure.** `out.write()` returns `false` when its buffer is full. Waiting for `drain` keeps the script from reading faster than it writes.

## Going further

### Only comments that mention something

`searchTerms` filters the threads on the server, which also saves quota:

```ts
const threads = yt.commentThreads.forVideo(videoId, {
  part: ["snippet", "replies"],
  searchTerms: "timestamp",
  textFormat: "plainText",
});
```

### Newest first, and only the latest

`order: "time"` sorts the threads by date, newest first. `"relevance"` sorts them by relevance instead. Combine it with `take()` to stop early:

```ts
const latest = await yt.commentThreads.forVideo(videoId, { order: "time", textFormat: "plainText" }).take(200);

for (const thread of latest) {
  console.log(thread.snippet.topLevelComment.snippet?.publishedAt, thread.snippet.topLevelComment.snippet?.textDisplay);
}
```

That is 2 units: two pages of 100.

### More

- [Comments](/resources/comments/) for posting, replying and moderating.
- [Lists](/basics/lists/) for `take`, `all` and page by page reading.
- [Error codes](/reference/errors/#reasons) for the other reasons a comment call can fail with.
