import { describe, expect, it } from "vitest";
import {
  VideoCategories,
  bestThumbnail,
  channelPlaylistId,
  formatCount,
  formatDuration,
  isChannelId,
  isPlaylistId,
  isVideoId,
  parseChannelRef,
  parseDuration,
  parseUrl,
  playlistIdFrom,
  urls,
  videoIdFrom,
} from "../src/index.js";
import { toMs } from "../src/core/time.js";
import { child, parseXml, textOf } from "../src/utils/xml.js";
import { CHANNEL_ID, VIDEO_ID } from "./helpers.js";

describe("parseUrl", () => {
  it.each([
    [`https://www.youtube.com/watch?v=${VIDEO_ID}`, { type: "video", videoId: VIDEO_ID, format: "watch" }],
    [`https://youtu.be/${VIDEO_ID}?t=42`, { type: "video", videoId: VIDEO_ID, format: "watch", start: 42 }],
    [`youtube.com/watch?v=${VIDEO_ID}&t=1h2m3s`, { type: "video", videoId: VIDEO_ID, format: "watch", start: 3723 }],
    [`https://m.youtube.com/watch?v=${VIDEO_ID}&list=PLBCF2DAC6FFB574DE&index=2`, { type: "video", videoId: VIDEO_ID, format: "watch", playlistId: "PLBCF2DAC6FFB574DE" }],
    [`https://music.youtube.com/watch?v=${VIDEO_ID}`, { type: "video", videoId: VIDEO_ID, format: "watch" }],
    [`https://www.youtube.com/shorts/${VIDEO_ID}`, { type: "video", videoId: VIDEO_ID, format: "short" }],
    [`https://www.youtube.com/live/${VIDEO_ID}?feature=share`, { type: "video", videoId: VIDEO_ID, format: "live" }],
    [`https://www.youtube.com/embed/${VIDEO_ID}?start=10`, { type: "video", videoId: VIDEO_ID, format: "embed", start: 10 }],
    [`https://www.youtube-nocookie.com/embed/${VIDEO_ID}`, { type: "video", videoId: VIDEO_ID, format: "embed" }],
    ["https://www.youtube.com/playlist?list=PLBCF2DAC6FFB574DE", { type: "playlist", playlistId: "PLBCF2DAC6FFB574DE" }],
    ["https://www.youtube.com/embed/videoseries?list=PLBCF2DAC6FFB574DE", { type: "playlist", playlistId: "PLBCF2DAC6FFB574DE" }],
    [`https://www.youtube.com/channel/${CHANNEL_ID}/videos`, { type: "channel", channelId: CHANNEL_ID }],
    ["https://www.youtube.com/@GoogleDevelopers", { type: "channel", handle: "@GoogleDevelopers" }],
    ["https://www.youtube.com/@GoogleDevelopers/streams", { type: "channel", handle: "@GoogleDevelopers" }],
    ["https://www.youtube.com/user/GoogleDevelopers", { type: "channel", username: "GoogleDevelopers" }],
    ["https://www.youtube.com/c/GoogleDevelopers", { type: "channel", customUrl: "GoogleDevelopers" }],
    ["https://www.youtube.com/GoogleDevelopers", { type: "channel", customUrl: "GoogleDevelopers" }],
  ])("%s", (input, expected) => {
    expect(parseUrl(input)).toEqual(expected);
  });

  it.each(["https://vimeo.com/123", "not a url at all", "https://www.youtube.com/watch?v=short", "https://www.youtube.com/feed/subscriptions", "https://www.youtube.com/", "https://www.youtube.com/channel/nope", ""])(
    "rejects %s",
    (input) => {
      expect(parseUrl(input)).toBeNull();
    },
  );
});

describe("ids", () => {
  it("recognises the kinds of id", () => {
    expect(isVideoId(VIDEO_ID)).toBe(true);
    expect(isVideoId("too-short")).toBe(false);
    expect(isChannelId(CHANNEL_ID)).toBe(true);
    expect(isChannelId(`UU${CHANNEL_ID.slice(2)}`)).toBe(false);
    expect(isPlaylistId("PLBCF2DAC6FFB574DE")).toBe(true);
    expect(isPlaylistId("WL")).toBe(true);
    expect(isPlaylistId(VIDEO_ID)).toBe(false);
  });

  it("extracts ids from ids and URLs", () => {
    expect(videoIdFrom(` ${VIDEO_ID} `)).toBe(VIDEO_ID);
    expect(videoIdFrom(`https://youtu.be/${VIDEO_ID}`)).toBe(VIDEO_ID);
    expect(videoIdFrom("https://www.youtube.com/playlist?list=PLBCF2DAC6FFB574DE")).toBeNull();
    expect(playlistIdFrom("PLBCF2DAC6FFB574DE")).toBe("PLBCF2DAC6FFB574DE");
    expect(playlistIdFrom(`https://www.youtube.com/watch?v=${VIDEO_ID}&list=PLBCF2DAC6FFB574DE`)).toBe("PLBCF2DAC6FFB574DE");
    expect(playlistIdFrom(`https://youtu.be/${VIDEO_ID}`)).toBeNull();
  });

  it("reads channel references", () => {
    expect(parseChannelRef(CHANNEL_ID)).toEqual({ by: "id", value: CHANNEL_ID });
    expect(parseChannelRef("@GoogleDevelopers")).toEqual({ by: "handle", value: "@GoogleDevelopers" });
    expect(parseChannelRef("GoogleDevelopers")).toEqual({ by: "handle", value: "@GoogleDevelopers" });
    expect(parseChannelRef("youtube.com/user/Google")).toEqual({ by: "username", value: "Google" });
    expect(parseChannelRef("https://www.youtube.com/c/Google")).toEqual({ by: "custom", value: "Google" });
    expect(() => parseChannelRef(`https://youtu.be/${VIDEO_ID}`)).toThrow(/not a channel URL/);
  });

  it("derives the auto-generated playlists of a channel", () => {
    expect(channelPlaylistId(CHANNEL_ID)).toBe("UU_x5XG1OV2P6uZZ5FSM9Ttw");
    expect(channelPlaylistId(CHANNEL_ID, "videos")).toBe("UULF_x5XG1OV2P6uZZ5FSM9Ttw");
    expect(channelPlaylistId(CHANNEL_ID, "live")).toBe("UULV_x5XG1OV2P6uZZ5FSM9Ttw");
    expect(() => channelPlaylistId("@handle")).toThrow(/not a channel id/);
  });

  it("builds URLs", () => {
    expect(urls.video(VIDEO_ID)).toBe(`https://www.youtube.com/watch?v=${VIDEO_ID}`);
    expect(urls.video(VIDEO_ID, { start: 42.9, playlistId: "PL1" })).toBe(`https://www.youtube.com/watch?v=${VIDEO_ID}&list=PL1&t=42s`);
    expect(urls.video(VIDEO_ID, { short: true, start: 5 })).toBe(`https://youtu.be/${VIDEO_ID}?t=5s`);
    expect(urls.short(VIDEO_ID)).toBe(`https://www.youtube.com/shorts/${VIDEO_ID}`);
    expect(urls.channel("@GoogleDevelopers")).toBe("https://www.youtube.com/@GoogleDevelopers");
    expect(urls.channel(CHANNEL_ID)).toBe(`https://www.youtube.com/channel/${CHANNEL_ID}`);
    expect(urls.playlist("PL1")).toBe("https://www.youtube.com/playlist?list=PL1");
    expect(urls.embed(VIDEO_ID, { noCookie: true, autoplay: true, mute: true, loop: true, controls: false, start: 3 })).toBe(
      `https://www.youtube-nocookie.com/embed/${VIDEO_ID}?start=3&autoplay=1&mute=1&controls=0&loop=1&playlist=${VIDEO_ID}`,
    );
    expect(urls.thumbnail(VIDEO_ID, "maxres")).toBe(`https://i.ytimg.com/vi/${VIDEO_ID}/maxresdefault.jpg`);
    expect(parseUrl(urls.video(VIDEO_ID, { start: 42 }))).toMatchObject({ videoId: VIDEO_ID, start: 42 });
  });
});

describe("formatting", () => {
  it("parses ISO 8601 durations", () => {
    expect(parseDuration("PT1H2M3S")).toBe(3723);
    expect(parseDuration("PT45S")).toBe(45);
    expect(parseDuration("PT4M")).toBe(240);
    expect(parseDuration("P1DT2H")).toBe(93_600);
    expect(parseDuration("P0D")).toBe(0);
    expect(() => parseDuration("4:13")).toThrow(/ISO 8601/);
    expect(() => parseDuration("PT")).toThrow();
  });

  it("formats durations", () => {
    expect(formatDuration("PT1H2M3S")).toBe("1:02:03");
    expect(formatDuration(253)).toBe("4:13");
    expect(formatDuration(45)).toBe("0:45");
    expect(formatDuration(0)).toBe("0:00");
    expect(formatDuration("PT4M13S", "short")).toBe("4m 13s");
    expect(formatDuration(3600, "short")).toBe("1h");
    expect(formatDuration(0, "short")).toBe("0s");
  });

  it("formats counts", () => {
    expect(formatCount("1234567")).toBe("1.2M");
    expect(formatCount(999)).toBe("999");
    expect(formatCount(34_100)).toBe("34.1K");
    expect(() => formatCount("many")).toThrow();
  });

  it("picks the largest thumbnail", () => {
    const thumbnails = { default: { url: "d", width: 120, height: 90 }, maxres: { url: "x", width: 1280, height: 720 }, high: { url: "h", width: 480, height: 360 } };
    expect(bestThumbnail(thumbnails)?.url).toBe("x");
    expect(bestThumbnail({ medium: { url: "m" }, high: { url: "h" } })?.url).toBe("h");
    expect(bestThumbnail({})).toBeUndefined();
    expect(bestThumbnail(undefined)).toBeUndefined();
  });

  it("names the video categories", () => {
    expect(VideoCategories.Music).toBe("10");
    expect(VideoCategories.Gaming).toBe("20");
  });

  it("converts durations to milliseconds", () => {
    expect(toMs(1500)).toBe(1500);
    expect(toMs("250ms")).toBe(250);
    expect(toMs("30s")).toBe(30_000);
    expect(toMs("5m")).toBe(300_000);
    expect(toMs("1.5h")).toBe(5_400_000);
    expect(toMs("2d")).toBe(172_800_000);
    expect(() => toMs("soon" as never)).toThrow(/Invalid duration/);
    expect(() => toMs(-1)).toThrow();
  });
});

describe("xml", () => {
  it("reads elements, attributes, entities and CDATA", () => {
    const root = parseXml(`<?xml version="1.0"?><!-- note --><a x="1 &amp; 2" y='z'><b>one &lt; two &#233; &#x1F600;</b><c/><d><![CDATA[<raw> & kept]]></d><ns:e>tail</ns:e></a>`);
    const a = child(root, "a")!;
    expect(a.attributes).toEqual({ x: "1 & 2", y: "z" });
    expect(textOf(a, "b")).toBe("one < two é \u{1F600}");
    expect(child(a, "c")).toMatchObject({ name: "c", children: [] });
    expect(textOf(a, "d")).toBe("<raw> & kept");
    expect(textOf(a, "ns:e")).toBe("tail");
    expect(textOf(a, "missing")).toBeUndefined();
  });

  it("does not throw on broken input", () => {
    expect(() => parseXml("<a><b>unclosed</a></c> stray < text")).not.toThrow();
    expect(parseXml("").children).toEqual([]);
  });
});
