---
title: Upload from a script
description: A command-line script that uploads a video file with a progress display, sets its thumbnail and adds it to a playlist. An interrupted upload carries on where it stopped.
sidebar:
  order: 2
---

## What you get

One command that signs you in through the browser the first time, then uploads a file to your channel as a private video. If the connection drops or you stop the script, running the same command again resumes the upload instead of starting over.

## What it needs

| | |
| --- | --- |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | An OAuth client of type **Desktop app**, see [Credentials](/start/credentials/) |
| A browser on the same machine | For the consent page, on the first run only. Without one, use the device flow of [Scripts and devices](/auth/scripts-and-devices/) |

Quota per run:

| Step | Cost |
| --- | --- |
| `yt.videos.insert` | 1 call of the `videos.insert` bucket, which holds 100 a day by default |
| `yt.thumbnails.set`, with `--thumbnail` | 50 units |
| `yt.playlists.add`, with `--playlist` | 50 units |

:::caution
Videos uploaded through an unverified API project are locked as private until the project passes an audit. The upload itself works and the video stays private. The [FAQ](/help/faq/#how-do-i-get-more-quota) links to the form that requests the audit.
:::

## The program

```ts title="upload.ts"
import { rmSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import { parseArgs } from "node:util";
import {
  OAuth2,
  VideoCategories,
  YouTube,
  YouTubeUploadError,
  urls,
} from "@ix-xs/youtube.api";
import { authorize, fileMedia, tokenFile } from "@ix-xs/youtube.api/node";

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    title: { type: "string" },
    description: { type: "string", default: "" },
    thumbnail: { type: "string" },
    playlist: { type: "string" },
    restart: { type: "boolean", default: false },
  },
});
const [path] = positionals;
const clientId = process.env.GOOGLE_CLIENT_ID;
const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
if (!path || !clientId || !clientSecret) {
  console.error("Usage: upload.ts <video file> [options]");
  console.error("  --title <text>  --description <text>  --thumbnail <image>");
  console.error("  --playlist <id or URL>  --restart");
  console.error("GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET must be set.");
  process.exit(1);
}

// 1. Sign in. The browser opens on the first run, then the file has the tokens.
const SCOPE = "youtube";
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

// 2. Upload. The session of an interrupted run is kept next to the video.
const sessionFile = `${path}.upload-session`;
const resumeUri = values.restart
  ? undefined
  : await readFile(sessionFile, "utf8").catch(() => undefined);
let savedUri = resumeUri;
const megabytes = (bytes: number) => (bytes / 1_048_576).toFixed(1);
const verb = resumeUri ? "Resuming" : "Uploading";

const media = await fileMedia(path, {
  resumeUri,
  onProgress: ({ uploaded, total, percent, sessionUri }) => {
    if (sessionUri && sessionUri !== savedUri) {
      writeFileSync(sessionFile, (savedUri = sessionUri));
    }
    const done = (percent ?? 0).toFixed(1).padStart(5);
    const size = `${megabytes(uploaded)} of ${megabytes(total ?? 0)} MB`;
    process.stdout.write(`\r${verb} ${done}%  ${size}`);
  },
});

function explain(error: unknown): never {
  if (!(error instanceof YouTubeUploadError)) throw error;
  console.error(`\n${error.message}`);
  if (error.sessionUri) {
    console.error(`${megabytes(error.uploaded)} MB are stored on YouTube.`);
    console.error("Run the same command again to resume.");
  } else {
    // Nothing to resume: no session was opened, or the session expired.
    rmSync(sessionFile, { force: true });
    console.error("Run the same command again to start over.");
  }
  process.exit(1);
}

const video = await yt.videos
  .insert({
    body: {
      snippet: {
        title: values.title ?? basename(path),
        description: values.description,
        categoryId: VideoCategories.PeopleAndBlogs,
      },
      // Private first: check the result in YouTube Studio, then publish.
      status: { privacyStatus: "private", selfDeclaredMadeForKids: false },
    },
    media,
  })
  .catch(explain);

rmSync(sessionFile, { force: true });
console.log(`\nUploaded: ${urls.video(video.id)}`);

// 3. Thumbnail and playlist.
if (values.thumbnail) {
  const cover = await fileMedia(values.thumbnail);
  await yt.thumbnails.set({ videoId: video.id, media: cover });
  console.log("Thumbnail set.");
}
if (values.playlist) {
  await yt.playlists.add(values.playlist, video.id);
  console.log("Added to the playlist.");
}

const uploads = yt.quota.usage["videos.insert"] ?? 0;
console.log(`Spent: ${uploads} upload call, ${yt.quota.used} units.`);
```

## Run it

```bash
npm install @ix-xs/youtube.api

export GOOGLE_CLIENT_ID=...
export GOOGLE_CLIENT_SECRET=...
node upload.ts ./holiday.mp4 --title "Holiday 2026" \
  --thumbnail ./cover.png --playlist PLBCF2DAC6FFB574DE
```

Node.js 22.18 and newer run a `.ts` file as it is. On an older version, use `npx tsx upload.ts` with the same arguments.

The first run prints a consent URL and opens it. After you approve, the tokens are written to `./tokens.json` and later runs go straight to the upload. Keep that file out of version control: it gives access to the channel.

To see the resume at work, stop the script with Ctrl+C halfway through a large file and run the same command again.

## How it works

**The scope.** `youtube.upload` is enough to upload a video and set its thumbnail. `playlistItems.insert`, which adds a video to a playlist, does not accept it. So the script asks for `youtube`, which all three calls accept. The test on `grantedScopes` sends you through consent again when `tokens.json` was written by a script that asked for less.

**`fileMedia(path)`** opens the file without reading it into memory and takes the MIME type from the extension. A file of 5 MiB or less goes up in one request. Anything larger goes through a resumable session, in chunks of 8 MiB, and each confirmed chunk calls `onProgress`.

**Saving the session.** For a chunked upload, `onProgress` receives the `sessionUri` of the session. The script writes it to `<video>.upload-session` as soon as it appears, with a synchronous write so the file exists even if the process dies right after. On the next run that URI goes back in as `resumeUri`: the library asks YouTube how many bytes it holds and sends the rest. The title and the other metadata were given when the session was opened and are not sent again, so `--title` has no effect on a resumed run.

**When the upload fails.** A chunk that fails on a network error or a server error is retried with a growing pause, three times by default. After that, `yt.videos.insert` throws a `YouTubeUploadError` that carries the `sessionUri` and the number of bytes YouTube confirmed in `uploaded`. A session stays valid for about a week. Once it has expired, the error is still a `YouTubeUploadError`, and its `sessionUri` is `undefined`: the script deletes the saved one, and the next run starts from the first byte. `--restart` does the same on request, when you want to send the file again from the beginning.

**Other errors are rethrown.** A refusal from the API, such as an exhausted upload bucket or a rejected title, is a `YouTubeApiError`. `explain` lets it through with its stack.

**`.catch(explain)`.** `explain` never returns, so `video` keeps the type of a created video and `video.id` is a `string`.

**Three separate calls.** The upload, the thumbnail and the playlist are independent. If the thumbnail step fails, the video is already on the channel. Do not run the command again, which would upload a second copy: set the thumbnail by hand or with a one-line call to `yt.thumbnails.set`.

**The client timeout does not apply to uploads.** A large file can take as long as it needs.

## Going further

### Schedule the publication

A private video can carry the date it goes public:

```ts
import { fileMedia } from "@ix-xs/youtube.api/node";

await yt.videos.insert({
  body: {
    snippet: {
      title: "Holiday 2026",
      categoryId: VideoCategories.TravelAndEvents,
    },
    status: {
      privacyStatus: "private",
      publishAt: "2026-12-24T17:00:00Z",
      selfDeclaredMadeForKids: false,
    },
  },
  media: await fileMedia("./holiday.mp4"),
});
```

### Upload without notifying subscribers

`notifySubscribers` is a parameter of the call, next to `body` and `media`. It defaults to `true`.

```ts
import { fileMedia } from "@ix-xs/youtube.api/node";

await yt.videos.insert({
  notifySubscribers: false,
  body: {
    snippet: { title: "Test upload" },
    status: { privacyStatus: "private" },
  },
  media: await fileMedia("./test.mp4"),
});
```

### Add captions

`yt.captions.insert` takes a `.srt` or `.vtt` file the same way, for 400 units. See [Captions](/resources/captions/).

### More

- [Uploads](/resources/uploads/) for every option of `media`, streams, and uploads from the browser.
- [Videos](/resources/videos/#updating-a-video) to change the title or the privacy afterwards.
- [Scripts and devices](/auth/scripts-and-devices/) for a machine without a browser.
