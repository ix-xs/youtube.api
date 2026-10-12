---
title: Uploads
description: Upload a video from a file, a Blob or a stream, with progress, retries and resume. The same media parameter sends thumbnails, banners, playlist images, watermarks and caption files.
sidebar:
  order: 8
---

```ts
import { fileMedia } from "@ix-xs/youtube.api/node";

const video = await yt.videos.insert({
  body: {
    snippet: { title: "Holiday 2026", description: "Uploaded from code", categoryId: "22" },
    status: { privacyStatus: "private", selfDeclaredMadeForKids: false },
  },
  media: await fileMedia("./holiday.mp4", {
    onProgress: ({ percent }) => console.log(`${percent}%`),
  }),
});

console.log(`https://youtu.be/${video.id}`);
```

`videos.insert` costs 1 call from its own quota bucket, which holds 100 calls a day by default. It needs OAuth with one of `youtube.upload`, `youtube`, `youtube.force-ssl` or `youtubepartner`. [Scripts and devices](/auth/scripts-and-devices/) shows how a script gets those tokens.

:::caution
Videos uploaded by an unverified API project are locked as private until the project passes an audit. Setting `privacyStatus: "public"` does not change that.
:::

## Describing the video

`body` is the video resource: any subset of it, checked by the compiler. `part` is optional and defaults to the parts present in `body`.

```ts
const video = await yt.videos.insert({
  body: {
    snippet: {
      title: "Holiday 2026",
      description: "Two weeks on the coast.",
      tags: ["travel", "coast"],
      categoryId: VideoCategories.TravelAndEvents,
    },
    status: {
      privacyStatus: "private",
      publishAt: "2026-12-01T15:00:00Z", // scheduled publication. Only valid on a private video
      selfDeclaredMadeForKids: false,
    },
  },
  media: file,
  notifySubscribers: false,
});
```

The parameters next to `body` and `media`:

| Parameter | Default | Meaning |
| --- | --- | --- |
| `notifySubscribers` | `true` | Notify the channel's subscribers about the new video |
| `autoLevels` | | Apply auto-levels to the upload |
| `stabilize` | | Apply stabilization to the upload |
| `part` | Parts of `body` | Parts the request writes and the response returns |
| `onBehalfOfContentOwner`, `onBehalfOfContentOwnerChannel` | | For YouTube content partners only |

Without `part`, the result has a known `id` and every part optional. With an explicit `part`, it is narrowed as in any other call:

```ts
const video = await yt.videos.insert({
  part: ["snippet", "status"],
  body: { snippet: { title: "Holiday 2026" }, status: { privacyStatus: "private" } },
  media: file,
});

video.status.uploadStatus; // typed, because status was requested
```

## Choosing the media

`media` takes the bytes in whatever form you have them.

| Form | Size known | MIME type when you give none |
| --- | --- | --- |
| A `File` or a `Blob` | Yes | Its `type`, or `application/octet-stream` when that is empty |
| A `Uint8Array` or an `ArrayBuffer` | Yes | `application/octet-stream` |
| A `ReadableStream` or an async iterable of byte chunks | No | `application/octet-stream` |
| A string | Yes | `text/plain; charset=UTF-8`. It is sent as UTF-8 text, which suits caption files |
| `{ body, ...options }` | As its `body` | The `mimeType` option |

The object form wraps any of the others and adds options:

```ts
await yt.videos.insert({
  body: { snippet: { title: "Holiday 2026" }, status: { privacyStatus: "private" } },
  media: {
    body: file,
    mimeType: "video/mp4",
    chunkSize: 16 * 1024 * 1024,
    onProgress: ({ uploaded, total }) => console.log(uploaded, "of", total),
  },
});
```

A stream is for bytes that are not on disk, such as a download you pass along. It is read once, in order, and never held whole in memory:

```ts
const source = await fetch("https://example.com/exports/holiday.mp4");

await yt.videos.insert({
  body: { snippet: { title: "Holiday 2026" }, status: { privacyStatus: "private" } },
  media: {
    body: source.body!,
    mimeType: "video/mp4",
    size: Number(source.headers.get("content-length")) || undefined,
  },
});
```

`size` only applies to streams, and only so that progress can show a percentage. The stream is read to its end whatever the number says.

## Uploading a file from disk

`fileMedia()` from `@ix-xs/youtube.api/node` opens a file as a `Blob` without reading it into memory. It returns the object form of `media`.

```ts
import { fileMedia } from "@ix-xs/youtube.api/node";

const media = await fileMedia("./holiday.mp4");
const tuned = await fileMedia("./holiday.bin", { mimeType: "video/mp4", chunkSize: 32 * 1024 * 1024 });
```

The MIME type comes from the extension unless you pass `mimeType`:

| Extensions | MIME type |
| --- | --- |
| `.mp4`, `.m4v`, `.mov`, `.webm`, `.mkv`, `.avi`, `.wmv`, `.flv`, `.mpg`, `.mpeg`, `.3gp` | The matching `video/...` type |
| `.jpg`, `.jpeg`, `.png` | `image/jpeg`, `image/png` |
| `.srt`, `.vtt`, `.ttml`, `.sbv` | `application/x-subrip`, `text/vtt`, `application/ttml+xml`, `text/plain` |
| Anything else | `application/octet-stream` |

It also takes `chunkSize`, `resumeUri` and `onProgress`, described below.

## What happens under the hood

Before anything is sent, the media is checked against what the method accepts. A MIME type the method refuses, an empty body, or a known size above the limit throws a `YouTubeArgumentError`. No quota is spent.

Then one of two things happens:

- **One request**, when the size is known and at most 5 MiB. The metadata and the bytes travel together.
- **A resumable session** otherwise, which is always the case for a stream. The client opens a session with the metadata, then sends the bytes in chunks. Each chunk is confirmed by the server before the next one leaves.

A chunk is 8 MiB by default. `chunkSize` changes it. The value is rounded to a multiple of 256 KiB, with 256 KiB as the minimum. One chunk is in memory at a time, so a 40 GiB file uploads with the memory of a single chunk.

A larger chunk means fewer requests. A smaller one means finer progress and less to send again after a failure.

## Showing progress

`onProgress` is called when the session opens and after each confirmed chunk. A single-request upload calls it once, when it is done.

```ts
await yt.videos.insert({
  body: { snippet: { title: "Holiday 2026" }, status: { privacyStatus: "private" } },
  media: await fileMedia("./holiday.mp4", {
    onProgress: ({ uploaded, total, percent }) => {
      const megabytes = (bytes: number) => (bytes / 1024 / 1024).toFixed(1);
      process.stdout.write(`\r${megabytes(uploaded)} / ${megabytes(total ?? 0)} MiB (${percent ?? 0}%)`);
    },
  }),
});
```

| Field | Type | Meaning |
| --- | --- | --- |
| `uploaded` | `number` | Bytes confirmed by the server |
| `total` | `number \| undefined` | Total size in bytes, when known |
| `percent` | `number \| undefined` | 0 to 100 with one decimal, when the total is known |
| `sessionUri` | `string \| undefined` | The resumable session. `undefined` for a single-request upload |

Progress counts confirmed bytes, not sent bytes. With the default chunk, a 20 MiB file reports four times: once at 0, then after each of its three chunks. Lower `chunkSize` for a smoother bar.

## Retries, timeouts and cancelling

Inside a resumable session, a network failure or a server error on a chunk is not fatal. The client waits, asks the server how many bytes it holds, and carries on from there. The wait grows with each failure in a row, following the [retry policy](/basics/configuration/) of the client. A confirmed chunk resets the count.

The upload gives up after more failures in a row than `retry.attempts` allows, 3 by default. It then throws a `YouTubeUploadError`. Pass `retry` in the request options to change the policy for one upload:

```ts
await yt.videos.insert(
  { body: { snippet: { title: "Holiday 2026" } }, media: file },
  { retry: { attempts: 8, maxDelay: "2m" } },
);
```

A single-request upload is not retried, and neither is the request that opens a session. For a small file that matters, retry the call yourself.

The client's `timeout` does not apply to uploads. To bound or cancel one, pass a `signal`:

```ts
const controller = new AbortController();
const cancelButton = document.querySelector("button#cancel")!;
cancelButton.addEventListener("click", () => controller.abort());

try {
  await yt.videos.insert({ body: { snippet: { title: "Holiday 2026" } }, media: file }, { signal: controller.signal });
} catch (error) {
  if (!isYouTubeError(error, "ABORTED")) throw error;
  console.log("Upload cancelled");
}
```

An aborted upload throws a `YouTubeRequestError` with the code `ABORTED`.

## Resuming after a crash

A resumable session outlives your process. It stays valid for about a week. Keep its URI, and a later run continues where the upload stopped instead of starting over.

The URI is in every progress report. Store it as soon as it appears, pass it back as `resumeUri`:

```ts
import { fileMedia } from "@ix-xs/youtube.api/node";

const saved: string | undefined = await db.uploads.get("holiday");

const video = await yt.videos.insert({
  body: { snippet: { title: "Holiday 2026" }, status: { privacyStatus: "private" } },
  media: await fileMedia("./holiday.mp4", {
    resumeUri: saved,
    onProgress: ({ sessionUri }) => {
      if (sessionUri && sessionUri !== saved) void db.uploads.set("holiday", sessionUri);
    },
  }),
});

await db.uploads.delete("holiday");
```

With a `resumeUri`, the client first asks the server how far the upload went, skips that many bytes of the media, and sends the rest. If the server already has everything, the call returns the video at once. Pass the same file: the bytes are not compared.

The metadata was sent when the session was opened. On a resume, `body` is still required by the type but is not sent again.

The URI is also on the error when a session gives up, along with the number of confirmed bytes:

```ts
try {
  await yt.videos.insert({ body: { snippet: { title: "Holiday 2026" } }, media: await fileMedia("./holiday.mp4") });
} catch (error) {
  if (error instanceof YouTubeUploadError && error.sessionUri) {
    console.log(`Stopped after ${error.uploaded} bytes`);
    await db.uploads.set("holiday", error.sessionUri);
  } else {
    throw error;
  }
}
```

A session that has expired cannot be resumed. The call then throws a `YouTubeUploadError` whose message says so. Drop the stored URI and upload again without `resumeUri`.

Resuming works best with a file or a `Blob`, where skipping is free. A stream can only be resumed if you can produce it again from its first byte: the client reads and discards what the server already has.

## After the upload

`videos.insert` returns when YouTube has the file. Processing comes after. Read `status` to follow it, for 1 unit per call:

```ts
const uploaded = await yt.videos.get(videoId, { part: "status" });

switch (uploaded?.status.uploadStatus) {
  case "processed":
    console.log("Ready");
    break;
  case "failed":
    console.log("Processing failed:", uploaded.status.failureReason);
    break;
  case "rejected":
    console.log("Rejected:", uploaded.status.rejectionReason);
    break;
}
```

To change the title, the description or the privacy later, use `videos.update`: see [Updating a video](/resources/videos/#updating-a-video).

## Setting a thumbnail

`thumbnails.set` uploads a custom thumbnail for a video. JPEG or PNG, 50 MiB at most. 50 units.

```ts
import { fileMedia } from "@ix-xs/youtube.api/node";

await yt.thumbnails.set({ videoId, media: await fileMedia("./cover.png") });
```

## Uploading captions

`captions.insert` and `captions.update` take a caption file through the same `media` parameter, as text or as a file. They cost 400 and 450 units. [Captions](/resources/captions/) covers them.

```ts
await yt.captions.insert({
  body: { snippet: { videoId, language: "en", name: "English" } },
  media: { body: srtText, mimeType: "application/x-subrip" },
});
```

## Changing the channel banner

A banner takes two steps. `channelBanners.insert` uploads the image and returns a URL. The banner only goes live once that URL is saved to `brandingSettings.image.bannerExternalUrl` with `channels.update`.

`channels.update` replaces the whole part it receives, so read the branding settings first and send them back with the new URL:

```ts
const { url } = await yt.channelBanners.insert({ media: image });

const channel = await yt.channels.mine({ part: "brandingSettings" });

if (channel && url) {
  const branding = channel.brandingSettings;

  await yt.channels.update({
    body: {
      id: channel.id,
      brandingSettings: { ...branding, image: { ...branding.image, bannerExternalUrl: url } },
    },
  });
}
```

That is 50 units for the upload, 1 for the read and 50 for the update. The image is JPEG or PNG, 6 MiB at most.

## Setting a playlist image

`playlistImages.insert` sets a custom thumbnail on a playlist, and `playlistImages.update` replaces it. JPEG or PNG, 50 MiB at most. 50 units each.

```ts
const created = await yt.playlistImages.insert({
  body: { snippet: { playlistId, type: "hero", width: 1080, height: 1080 } },
  media: image,
});

await yt.playlistImages.update({
  body: { id: created.id, snippet: { playlistId, type: "hero" } },
  media: image,
});
```

`media` is optional on `update`. Reading and removing the image are plain calls:

```ts
const { items } = await yt.playlistImages.list({ part: "snippet", parent: playlistId }); // 1 unit

for (const item of items) await yt.playlistImages.delete({ id: item.id }); // 50 units each
```

## Setting a watermark

`watermarks.set` uploads an image shown over every video of a channel. `body` says when it appears. JPEG or PNG, 10 MiB at most. 50 units.

```ts
await yt.watermarks.set({
  channelId,
  body: {
    timing: { type: "offsetFromStart", offsetMs: "15000" },
    position: { type: "corner", cornerPosition: "topRight" },
  },
  media: image,
});

await yt.watermarks.unset({ channelId }); // 50 units
```

`offsetMs` is a string because it is a 64-bit integer. `watermarks.unset` does not accept the `youtube.upload` scope: it needs `youtube`, `youtube.force-ssl` or `youtubepartner`.

## Uploading from the browser

A `File` from an `<input type="file">` is a `Blob`, so it goes straight into `media`. It carries its own MIME type and size.

```ts
const input = document.querySelector<HTMLInputElement>("input[type=file]")!;
const bar = document.querySelector("progress")!;

input.addEventListener("change", async () => {
  const picked = input.files?.[0];
  if (!picked) return;

  const video = await yt.videos.insert({
    body: { snippet: { title: picked.name }, status: { privacyStatus: "private" } },
    media: {
      body: picked,
      onProgress: ({ percent }) => {
        bar.value = percent ?? 0;
      },
    },
  });

  console.log("Uploaded", video.id);
});
```

The bytes go from the browser to YouTube, in chunks read from the file as needed. The client in the page needs a token of the user: see [Runtimes](/reference/runtimes/) for what that means in a browser.

## Errors

```ts
try {
  await yt.videos.insert({ body: { snippet: { title: "Holiday 2026" } }, media: file });
} catch (error) {
  if (error instanceof YouTubeArgumentError) {
    // Refused before sending: wrong MIME type, empty or oversized media.
  } else if (error instanceof YouTubeUploadError) {
    // The transfer gave up. error.sessionUri may allow a resume.
  } else if (error instanceof YouTubeApiError && error.reason === "uploadLimitExceeded") {
    // YouTube refuses more uploads from this channel for now.
  } else if (isYouTubeError(error, "QUOTA_EXCEEDED")) {
    // The videos.insert bucket of the project is empty until yt.quota.resetsAt.
  } else {
    throw error;
  }
}
```

| Error | Code | When |
| --- | --- | --- |
| `YouTubeArgumentError` | `INVALID_ARGUMENT` | The MIME type is not accepted, the media is empty, a known size is over the limit, or the body is not a supported form. Nothing was sent |
| `YouTubeUploadError` | `UPLOAD_FAILED` | The transfer failed: no session could be opened, too many failures in a row, or the session expired. Carries `sessionUri` and `uploaded` |
| `YouTubeApiError` | By status | The API refused the upload. `reason` says why: `uploadLimitExceeded`, `invalidTitle`, `invalidDescription`, `invalidTags`, `invalidCategoryId`, `invalidVideoMetadata` |
| `YouTubeApiError` | `QUOTA_EXCEEDED` | The project used its uploads for the day |
| `YouTubeQuotaBudgetError` | `QUOTA_BUDGET_EXCEEDED` | With `quota.enforce`, the local count says the bucket is empty. Nothing was sent |
| `YouTubeRequestError` | `ABORTED` | The `signal` was aborted |

The MIME check reads the type you gave or the one the media carries. A message such as this one means the type is wrong, not the file:

```ts
await yt.thumbnails.set({ videoId, media: { body: image, mimeType: "image/webp" } });
// YouTubeArgumentError: thumbnails.set does not accept "image/webp".
// Accepted types: image/jpeg, image/png, application/octet-stream. Set `media.mimeType`.
```

A size limit can only be checked before sending when the size is known. For a stream, the API is the one that refuses.

## Reference

### Methods that take `media`

| Method | Accepted types | Limit | Quota |
| --- | --- | --- | --- |
| `yt.videos.insert` | `video/*`, `application/octet-stream` | 256 GiB | 1 call, `videos.insert` bucket |
| `yt.thumbnails.set` | `image/jpeg`, `image/png`, `application/octet-stream` | 50 MiB | 50 |
| `yt.captions.insert` | Any | 100 MiB | 400 |
| `yt.captions.update` | Any | 100 MiB | 450 |
| `yt.channelBanners.insert` | `image/jpeg`, `image/png`, `application/octet-stream` | 6 MiB | 50 |
| `yt.playlistImages.insert` | `image/jpeg`, `image/png`, `application/octet-stream` | 50 MiB | 50 |
| `yt.playlistImages.update` | `image/jpeg`, `image/png`, `application/octet-stream` | 50 MiB | 50 |
| `yt.watermarks.set` | `image/jpeg`, `image/png`, `application/octet-stream` | 10 MiB | 50 |

All of them need OAuth. The same numbers are available in code as `METHODS["thumbnails.set"].upload`, with `accept` and `maxSize` in bytes. [Quota](/basics/quota/#buckets) explains the `videos.insert` bucket.

### The object form of `media`

| Option | Default | Meaning |
| --- | --- | --- |
| `body` | Required | The bytes: a `Blob`, a `Uint8Array`, an `ArrayBuffer`, a `ReadableStream`, an async iterable of bytes or a string |
| `mimeType` | From the body | MIME type sent to the API |
| `size` | | Total size in bytes of a stream, for the progress percentage only |
| `chunkSize` | 8 MiB | Bytes per request in a resumable session. Rounded to a multiple of 256 KiB |
| `onProgress` | | Called with an `UploadProgress` after each confirmed chunk |
| `resumeUri` | | Session URI of an interrupted upload, to carry on where it stopped |

### `fileMedia(path, options)`

Returns `Promise<MediaOptions>`. Options: `mimeType`, `chunkSize`, `resumeUri`, `onProgress`, with the meanings above. Node.js only.

### Types

| Type | What it is |
| --- | --- |
| `MediaInput` | What `media` accepts: a `MediaBody` or a `MediaOptions` |
| `MediaBody` | The bytes alone |
| `MediaOptions` | The object form |
| `UploadProgress` | What `onProgress` receives |
| `YouTubeUploadError` | `sessionUri: string \| undefined`, `uploaded: number` |

## See also

- [Captions](/resources/captions/): caption tracks, the other file upload.
- [Videos](/resources/videos/): reading and updating what you uploaded.
- [Upload from a script](/recipes/upload-from-a-script/): a complete program, from consent to the video URL.
- [Quota](/basics/quota/): the `videos.insert` bucket and how to watch it.
