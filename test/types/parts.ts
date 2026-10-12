// Type-level tests, checked by `npm run test:types`. Nothing here runs: the
// file only has to compile. `@ts-expect-error` lines must fail to compile.

import type { Channel, ListRequest, Page, PlaylistItem, SearchResult, ThumbnailDetails, Video, VideoResource, VideoSearchResult, YouTube } from "../../src/index.js";

declare const yt: YouTube;

type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
declare function assert<T extends true>(): T;

export async function listNarrowsToTheRequestedParts() {
  const { items } = await yt.videos.list({ part: ["snippet", "statistics"], id: "x" });
  const video = items[0]!;

  assert<Equal<typeof video.id, string>>();
  assert<Equal<typeof video.etag, string>>();
  assert<Equal<typeof video.snippet.title, string>>();
  assert<Equal<typeof video.snippet.thumbnails, ThumbnailDetails>>();
  // A field the API can leave out stays optional.
  assert<Equal<typeof video.snippet.tags, string[] | undefined>>();
  assert<Equal<typeof video.statistics.viewCount, string>>();
  assert<Equal<typeof video.statistics.likeCount, string | undefined>>();

  // @ts-expect-error contentDetails was not requested
  video.contentDetails;
  // @ts-expect-error neither was status
  video.status;
}

export async function aSinglePartWorksAsAString() {
  const video = (await yt.videos.list({ part: "contentDetails", id: "x" }).first())!;
  assert<Equal<typeof video.contentDetails.duration, string>>();
  // @ts-expect-error snippet was not requested
  video.snippet;
}

export async function partsThatMayBeMissingStayOptional() {
  const video = (await yt.videos.list({ part: ["liveStreamingDetails", "snippet"], id: "x" }).first())!;
  // Only live videos have it, even when asked for.
  assert<Equal<undefined extends typeof video.liveStreamingDetails ? true : false, true>>();
  assert<Equal<typeof video.snippet.channelId, string>>();
  // @ts-expect-error possibly undefined
  video.liveStreamingDetails.activeLiveChatId;
}

export function partNamesAreChecked() {
  // @ts-expect-error "snipet" is not a part of a video
  yt.videos.list({ part: "snipet", id: "x" });
  // @ts-expect-error `part` is required on reads
  yt.videos.list({ id: "x" });
  // @ts-expect-error auditDetails is a channel part, not a video part
  yt.videos.list({ part: ["snippet", "auditDetails"], id: "x" });
  // @ts-expect-error not a known search order
  yt.search.list({ part: "snippet", q: "x", order: "newest" });
  // @ts-expect-error `rating` only takes like, dislike or none
  yt.videos.rate({ id: "x", rating: "love" });
}

export async function theBareTypesAreTheFullResources() {
  assert<Equal<Video, VideoResource>>();
  const loose: Video = {};
  // Any narrowed video can be passed where a plain Video is expected.
  const narrowed = (await yt.videos.list({ part: "snippet", id: "x" }).first())!;
  const accepted: Video = narrowed;
  const channel: Channel = (await yt.channels.list({ part: ["snippet", "statistics"], id: "x" }).first())!;
  return [loose, accepted, channel];
}

export async function helpersHaveSensibleDefaults() {
  const video = await yt.videos.get("x");
  assert<Equal<typeof video, Video<"snippet" | "contentDetails" | "statistics"> | null>>();
  if (video) {
    assert<Equal<typeof video.contentDetails.duration, string>>();
    // @ts-expect-error status is not among the default parts
    video.status;
  }

  const slim = await yt.videos.get("x", { part: "status" });
  if (slim) {
    assert<Equal<typeof slim.status.privacyStatus, "public" | "unlisted" | "private">>();
    // @ts-expect-error only status was requested
    slim.snippet;
  }

  const channel = await yt.channels.get("@x");
  if (channel) assert<Equal<typeof channel.contentDetails.relatedPlaylists.uploads, string>>();

  const latest = await yt.channels.latestVideos("@x", { part: ["snippet", "liveStreamingDetails"], limit: 3 });
  assert<Equal<typeof latest, Video<"snippet" | "liveStreamingDetails">[]>>();

  const uploads = yt.channels.uploads("@x");
  assert<Equal<Awaited<ReturnType<typeof uploads.all>>, PlaylistItem<"snippet" | "contentDetails">[]>>();
  for await (const item of uploads) assert<Equal<typeof item.contentDetails.videoId, string>>();

  for await (const result of yt.search.videos("x")) {
    assert<Equal<typeof result, VideoSearchResult>>();
    assert<Equal<typeof result.id.videoId, string>>();
    assert<Equal<typeof result.snippet.title, string>>();
  }
}

export async function listRequestsAreAwaitableAndIterable() {
  const request = yt.search.list({ part: "snippet", q: "x" });
  assert<Equal<typeof request extends ListRequest<SearchResult<"snippet">, unknown> ? true : false, true>>();
  const page = await request;
  assert<Equal<typeof page extends Page<SearchResult<"snippet">, unknown> ? true : false, true>>();
  assert<Equal<typeof page.nextPageToken, string | undefined>>();
  assert<Equal<typeof page.raw.regionCode, string | undefined>>();
  const first = await request.first();
  assert<Equal<typeof first, SearchResult<"snippet"> | undefined>>();
}

export async function writesReturnWhatTheyWrote() {
  const playlist = await yt.playlists.insert({ part: ["snippet", "status"], body: { snippet: { title: "x" } } });
  assert<Equal<typeof playlist.snippet.title, string>>();
  // Without `part` the type is the full resource: every part optional.
  const loose = await yt.playlists.insert({ body: { snippet: { title: "x" } } });
  assert<Equal<undefined extends typeof loose.snippet ? true : false, true>>();
  // Bodies are deeply partial and still checked.
  // @ts-expect-error privacyStatus only takes public, unlisted or private
  await yt.playlists.insert({ body: { status: { privacyStatus: "secret" } } });
  assert<Equal<Awaited<ReturnType<typeof yt.videos.delete>>, void>>();
  assert<Equal<Awaited<ReturnType<typeof yt.captions.download>>, string>>();
}

export async function analyticsRowsFollowTheQuery() {
  const report = await yt.analytics.query({ startDate: "2026-01-01", endDate: "2026-01-31", metrics: ["views", "likes"], dimensions: "day" });
  const row = report.rows[0]!;
  assert<Equal<typeof row.views, number>>();
  assert<Equal<typeof row.likes, number>>();
  assert<Equal<typeof row.day, string>>();
  // @ts-expect-error comments was not requested
  row.comments;
}

export function durationsAreChecked() {
  yt.watch("@x", { interval: "5m" });
  yt.watch("@x", { interval: 60_000 });
  // @ts-expect-error not a duration
  yt.watch("@x", { interval: "five minutes" });
}

export async function aResourceWithOnePartIsNarrowedToo() {
  const member = (await yt.members.list({ part: "snippet" }).first())!;
  // Asking for the only part there is must not fall back on "everything optional".
  assert<Equal<undefined extends typeof member.snippet ? true : false, false>>();
  assert<Equal<typeof member.etag, string>>();

  const reason = (await yt.videoAbuseReportReasons.list({ part: ["id", "snippet"] }).first())!;
  assert<Equal<typeof reason.snippet.label, string>>();
}

export async function nestedCommentsCarryTheirSnippet() {
  for await (const thread of yt.commentThreads.forVideo("x", { part: ["snippet", "replies"] })) {
    assert<Equal<typeof thread.snippet.topLevelComment.snippet.textDisplay, string>>();
    assert<Equal<typeof thread.snippet.topLevelComment.snippet.textOriginal, string | undefined>>();
    const reply = thread.replies?.comments[0];
    assert<Equal<typeof reply extends undefined ? never : NonNullable<typeof reply>["snippet"]["authorDisplayName"], string>>();
  }
}

export async function analyticsSortStaysWithinTheQuery() {
  await yt.analytics.query({ startDate: "2026-01-01", endDate: "2026-01-31", metrics: ["views"], dimensions: "day", sort: "-views" });
  // @ts-expect-error likes is not among the metrics of this query
  await yt.analytics.query({ startDate: "2026-01-01", endDate: "2026-01-31", metrics: ["views"], sort: "-likes" });
}
