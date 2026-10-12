---
title: Export the comments of a video
description: A script that writes every comment and every reply of a video to a JSON Lines or CSV file, one row per comment. An API key is enough.
sidebar:
  order: 4
---

## What you get

A file with one row per comment: its id, its parent when it is a reply, the author, the text, the like count and the dates. The script writes to disk as it reads, so the comments of a video never have to fit in memory at once.

## What it needs

An API key in `YOUTUBE_API_KEY`, see [Credentials](/start/credentials/).

Quota: 1 unit per 100 threads, plus 1 unit per page of 100 replies for each thread that has more replies than it carries. A video with 5,000 threads, 40 of which have between 6 and 100 replies, costs 90 units.

## The program

```ts title="export-comments.ts"
import { once } from "node:events";
import { createWriteStream } from "node:fs";
import { finished } from "node:stream/promises";
import {
  YouTube,
  YouTubeApiError,
  videoIdFrom,
  type Comment,
} from "@ix-xs/youtube.api";

const [input, output = "comments.jsonl"] = process.argv.slice(2);
const videoId = input ? videoIdFrom(input) : null;
if (!videoId) {
  console.error("Usage: export-comments.ts <video URL or id> [output file]");
  console.error("The output file ends in .csv, or in anything else for JSON.");
  process.exit(1);
}

const yt = new YouTube(); // reads YOUTUBE_API_KEY
const csv = output.endsWith(".csv");
const out = createWriteStream(output);

const COLUMNS = [
  "id",
  "parentId",
  "author",
  "authorChannelId",
  "text",
  "likes",
  "publishedAt",
  "updatedAt",
] as const;
type Row = Record<(typeof COLUMNS)[number], string | number>;

/** Waits when the disk is slower than the API. */
async function write(line: string): Promise<void> {
  if (!out.write(`${line}\n`)) await once(out, "drain");
}

const quote = (value: string | number) =>
  `"${String(value).replaceAll('"', '""')}"`;
let rows = 0;

async function save({ id, snippet }: Comment<"snippet">): Promise<void> {
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
  const line = csv
    ? COLUMNS.map((column) => quote(row[column])).join(",")
    : JSON.stringify(row);
  await write(line);
  rows++;
}

if (csv) await write(COLUMNS.join(","));
let threads = 0;

try {
  const list = yt.commentThreads.forVideo(videoId, {
    part: ["snippet", "replies"],
    textFormat: "plainText",
  });
  for await (const thread of list) {
    threads++;
    await save(thread.snippet.topLevelComment);

    const inlined = thread.replies?.comments ?? [];
    if (thread.snippet.totalReplyCount > inlined.length) {
      // The thread holds more replies than it carries: read them all.
      const all = yt.comments.replies(thread.id, { textFormat: "plainText" });
      for await (const reply of all) await save(reply);
    } else {
      for (const reply of inlined) await save(reply);
    }
    if (threads % 500 === 0) {
      console.log(`${threads} threads, ${rows} comments...`);
    }
  }
  console.log(`Wrote ${rows} comments from ${threads} threads to ${output}.`);
  console.log(`Quota: ${yt.quota.used} units.`);
} catch (error) {
  if (!(error instanceof YouTubeApiError)) throw error;
  if (error.reason === "commentsDisabled") {
    console.error("Comments are turned off on this video.");
  } else if (error.isNotFound) {
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

Node.js 22.18 and newer run a `.ts` file as it is. On an older version, use `npx tsx export-comments.ts` with the same arguments.

The extension of the second argument picks the format. `.csv` writes a header and quoted cells. Anything else writes JSON Lines, one object per line:

```json
{"id":"Ugx...","parentId":"","author":"@someone","authorChannelId":"UC...","text":"First!","likes":12,"publishedAt":"2026-03-01T10:00:00Z","updatedAt":"2026-03-01T10:00:00Z"}
```

## How it works

**Threads, then replies.** A comment thread is a top-level comment with its replies. `yt.commentThreads.forVideo` lists the threads of a video. It asks for pages of 100, the most the API allows, whether you await it or walk it with `for await`. With the `replies` part, each thread carries up to five of its replies. `snippet.totalReplyCount` says how many there are in all.

**`yt.comments.replies(thread.id)`** lists every reply of a thread, also 100 per page. The id of a thread is also the id of its top-level comment, which is what `parentId` expects. The script only makes that call when the thread has more replies than it carries, and then takes all of them from that one source, so no reply is written twice.

**`replies` stays optional in the type.** A requested part is only required in the type when the API always returns it, and `replies` is not one of those. Hence `thread.replies?.comments ?? []`.

**`textFormat: "plainText"`.** The API returns comment text as HTML by default. Plain text is the better raw material for a file. It is passed to both calls so replies match their parents.

**`save` takes a `Comment<"snippet">`.** The top-level comment of a thread, a reply inside `replies.comments` and a reply from `yt.comments.replies` all have that type. Their `id` and `snippet` are required, so the function reads them without `?.`. One function handles the three.

**`textDisplay`, not `textOriginal`.** `textDisplay` is on every comment. `textOriginal` is optional in the type: the API description only guarantees it when the viewer is the author of the comment. `authorChannelId` is optional too, hence the `?.` on that one field.

**`commentsDisabled`** is the `reason` of the error when the owner turned comments off. It is worth its own message because it is a property of the video, not a failure. Everything else is rethrown with its stack. The rows written before a failure stay in the file.

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

### Sorted, and only the first threads

`order` takes `"time"` or `"relevance"`. Combine it with `take()` to stop early:

```ts
const latest = await yt.commentThreads
  .forVideo(videoId, { order: "time", textFormat: "plainText" })
  .take(200);

for (const thread of latest) {
  const { publishedAt, textDisplay } = thread.snippet.topLevelComment.snippet;
  console.log(publishedAt, textDisplay);
}
```

That is 2 units: two pages of 100. The API description says no more about `"time"` than "order by time": check on your own data which end the list starts from before you rely on it.

### More

- [Comments](/resources/comments/) for posting, replying and moderating.
- [Lists](/basics/lists/) for `take`, `all` and page by page reading.
- [Error codes](/reference/errors/#reasons) for the other reasons a comment call can fail with.
