---
title: Captions
description: List the caption tracks of your videos, download them as text, and upload, update or delete tracks. Every call needs OAuth, and most of them are expensive.
sidebar:
  order: 7
---

```ts
const { items } = await yt.captions.list({ part: "snippet", videoId });

for (const track of items) {
  console.log(track.id, track.snippet.language, track.snippet.name, track.snippet.trackKind);
}
```

That call costs 50 quota units. The caption methods are among the most expensive of the API:

| Call | Quota |
| --- | --- |
| `yt.captions.list` | 50 |
| `yt.captions.download` | 200 |
| `yt.captions.insert` | 400 |
| `yt.captions.update` | 450 |
| `yt.captions.delete` | 50 |

With the default 10,000 units a day, that is 25 uploads, or 40 rounds of listing a video and downloading one track.

## What you need

All five methods need OAuth. An API key is never enough, not even to list the tracks of a public video: the call is refused before it is sent, with a `YouTubeAuthError` whose code is `MISSING_CREDENTIALS`.

The scope is `youtube.force-ssl`. Content partners can use `youtubepartner` instead. The broader-looking `youtube` scope does not cover captions. [Scopes](/auth/scopes/) has the full table.

## Listing the tracks of a video

`captions.list` returns every track of a video in one response. There are no pages to walk.

```ts
const { items } = await yt.captions.list({ part: "snippet", videoId });

const english = items.find((track) => track.snippet.language === "en");
const published = items.filter((track) => !track.snippet.isDraft);
```

The snippet says what each track is:

- `language` is a BCP-47 tag such as `en` or `pt-BR`. `name` is the label viewers see in the player.
- `trackKind` is `"standard"`, `"ASR"` (automatic speech recognition) or `"forced"`.
- `status` is `"serving"`, `"syncing"` or `"failed"`. When it is `"failed"`, `failureReason` says why.
- `isDraft` is true for a track that is not publicly visible.

The text of a track is not in the list. Fetch it with `download`.

To look at specific tracks, pass their ids next to the video:

```ts
const { items } = await yt.captions.list({ part: "snippet", videoId, id: [captionId] });
```

## Downloading a track

`captions.download` returns the track as a string. It costs 200 units.

```ts
const original = await yt.captions.download({ id: captionId });
const vtt = await yt.captions.download({ id: captionId, tfmt: "vtt" });
```

Without `tfmt` you get the track in its original format. With it, YouTube converts the track. The accepted values are `"sbv"`, `"scc"`, `"srt"`, `"ttml"` and `"vtt"`.

`tlang` asks for a machine translation into another language:

```ts
const french = await yt.captions.download({ id: captionId, tfmt: "srt", tlang: "fr" });
```

Finding a track and saving it to disk, for 250 units in total:

```ts
import { writeFile } from "node:fs/promises";

const { items } = await yt.captions.list({ part: "snippet", videoId });
const english = items.find((track) => track.snippet.language === "en");

if (english) {
  const srt = await yt.captions.download({ id: english.id, tfmt: "srt" });
  await writeFile("./captions.en.srt", srt);
}
```

:::caution
`download` only works on videos you can edit. See [Other people's videos](#other-peoples-videos).
:::

## Uploading a track

`captions.insert` adds a track to one of your videos. It costs 400 units. The body names the video, the language and the label. `media` is the caption file, and it must carry its own timing.

Pass the file as text, with its MIME type:

```ts
const track = await yt.captions.insert({
  body: { snippet: { videoId, language: "en", name: "English" } },
  media: { body: srtText, mimeType: "application/x-subrip" },
});

console.log(track.id);
```

Or from disk in Node.js. `fileMedia()` picks the MIME type from the extension: `.srt`, `.vtt`, `.ttml` and `.sbv` are known.

```ts
import { fileMedia } from "@ix-xs/youtube.api/node";

await yt.captions.insert({
  body: { snippet: { videoId, language: "fr", name: "Français" } },
  media: await fileMedia("./captions.fr.vtt"),
});
```

A bare string also works as `media`. It is then sent as `text/plain`, so naming the format with `mimeType` is the safer habit. No MIME type is refused before sending for this method, and the file can be up to 100 MiB. [Uploads](/resources/uploads/) describes everything `media` accepts.

Two things you can set at upload time:

- `isDraft: true` in the snippet keeps the track hidden from viewers until you publish it with `update`.
- `sync: true`, next to `body` and `media`, asks YouTube to synchronize the track with the audio of the video. The track's `isAutoSynced` field then reads true. When it is false, YouTube uses the time codes of your file.

```ts
await yt.captions.insert({
  body: { snippet: { videoId, language: "en", name: "English", isDraft: true } },
  media: { body: srtText, mimeType: "application/x-subrip" },
  sync: true,
});
```

### Checking that the file was accepted

A successful `insert` means YouTube received the file, not that it could read it. Ask for the snippet back and look at `status`:

```ts
const track = await yt.captions.insert({
  part: "snippet",
  body: { snippet: { videoId, language: "en", name: "English" } },
  media: { body: srtText, mimeType: "application/x-subrip" },
});

if (track.snippet.status === "failed") {
  console.error("YouTube could not process the file:", track.snippet.failureReason);
}
```

`failureReason` is `"unknownFormat"`, `"unsupportedFormat"` or `"processingFailed"`. A track that is still `"syncing"` can be checked again later with `captions.list`, for 50 units.

## Updating a track

`captions.update` changes the draft status of a track, replaces its file, or both. It costs 450 units.

Publishing a draft:

```ts
await yt.captions.update({ body: { id: captionId, snippet: { isDraft: false } } });
```

Replacing the file and publishing in one call:

```ts
await yt.captions.update({
  body: { id: captionId, snippet: { isDraft: false } },
  media: { body: srtText, mimeType: "application/x-subrip" },
});
```

`media` is optional here, and `sync` is accepted as on `insert`.

## Deleting a track

```ts
await yt.captions.delete({ id: captionId });
```

50 units. The promise resolves with nothing.

## Other people's videos

This API does not give you the captions of a video you do not manage. `download` only works on videos you can edit, and `insert` adds tracks to your own videos. No method returns the caption text of someone else's video, whatever the scope of the token.

A refused call throws a `YouTubeApiError`. Handle it where a user can type any video id:

```ts
try {
  const text = await yt.captions.download({ id: captionId, tfmt: "vtt" });
  console.log(text);
} catch (error) {
  if (error instanceof YouTubeApiError) {
    console.error(`Captions not available (${error.status} ${error.reason ?? ""})`);
  } else {
    throw error;
  }
}
```

A refused call is still billed, at least one unit.

## Reference

### Methods

| Method | Quota | Returns |
| --- | --- | --- |
| `yt.captions.list({ part, videoId, id? })` | 50 | The tracks, in `items` |
| `yt.captions.download({ id, tfmt?, tlang? })` | 200 | `string` |
| `yt.captions.insert({ body, media, part?, sync? })` | 400 | The created track |
| `yt.captions.update({ body, media?, part?, sync? })` | 450 | The updated track |
| `yt.captions.delete({ id })` | 50 | `void` |

All of them accept `onBehalfOfContentOwner`, for YouTube content partners. All need OAuth with `youtube.force-ssl` or `youtubepartner`.

### Parts

A caption has two parts: `id` and `snippet`. `snippet` is always returned when requested.

### Fields of `snippet`

| Field | Type | Meaning |
| --- | --- | --- |
| `videoId` | `string` | The video the track belongs to |
| `language` | `string` | BCP-47 language tag |
| `name` | `string` | Label shown to viewers during playback |
| `trackKind` | `"standard" \| "ASR" \| "forced"` | Type of the track |
| `status` | `"serving" \| "syncing" \| "failed"` | State of the track |
| `failureReason` | `"unknownFormat" \| "unsupportedFormat" \| "processingFailed"` | Why processing failed. Only when `status` is `"failed"` |
| `lastUpdated` | `string` | ISO 8601 date and time of the last update |
| `isDraft` | `boolean` | A draft is not publicly visible |
| `isAutoSynced` | `boolean` | YouTube synchronized the track to the audio, on request |
| `isCC` | `boolean` | Closed captions for the deaf and hard of hearing |
| `isEasyReader` | `boolean` | Written at a third-grade level, for language learners |
| `isLarge` | `boolean` | Uses large text for the vision-impaired |
| `audioTrackType` | `"unknown" \| "primary" \| "commentary" \| "descriptive"` | Type of audio track the captions go with |

`videoId`, `language`, `name`, `trackKind`, `status` and `lastUpdated` are always present. The others are optional.

### Errors

| Error | When |
| --- | --- |
| `YouTubeAuthError`, code `MISSING_CREDENTIALS` | The client only has an API key |
| `YouTubeAuthError`, code `INSUFFICIENT_SCOPE` | The token has neither `youtube.force-ssl` nor `youtubepartner`. Raised before sending when the client knows the scopes of the token |
| `YouTubeApiError`, reason `captionNotFound` | No track has this id |
| `YouTubeApiError`, code `QUOTA_EXCEEDED` | The project is out of quota for the day |
| `YouTubeArgumentError` | The caption file is empty, or larger than 100 MiB |

## See also

- [Uploads](/resources/uploads/): the `media` parameter, files, progress.
- [Scopes](/auth/scopes/): why captions need `youtube.force-ssl`.
- [Quota](/basics/quota/): budgeting for calls that cost hundreds of units.
- [Videos](/resources/videos/): `contentDetails.caption` is `"true"` or `"false"`, and tells for 1 unit whether a video has captions at all.
