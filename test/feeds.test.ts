import { describe, expect, it } from "vitest";
import { Watcher, type WatchedVideo, YouTubeArgumentError, feedUrl, fetchFeed, oEmbed, parseFeed, websub } from "../src/index.js";
import { CHANNEL_ID, apiError, client, json, list, mockFetch } from "./helpers.js";

const entry = (videoId: string, title: string, published: string, short = false) => `
 <entry>
  <id>yt:video:${videoId}</id>
  <yt:videoId>${videoId}</yt:videoId>
  <yt:channelId>${CHANNEL_ID}</yt:channelId>
  <title>${title}</title>
  <link rel="alternate" href="https://www.youtube.com/${short ? "shorts/" : "watch?v="}${videoId}"/>
  <author>
   <name>Google for Developers</name>
   <uri>https://www.youtube.com/channel/${CHANNEL_ID}</uri>
  </author>
  <published>${published}</published>
  <updated>${published}</updated>
  <media:group>
   <media:title>${title}</media:title>
   <media:content url="https://www.youtube.com/v/${videoId}?version=3" type="application/x-shockwave-flash" width="640" height="390"/>
   <media:thumbnail url="https://i1.ytimg.com/vi/${videoId}/hqdefault.jpg" width="480" height="360"/>
   <media:description>Line one
Line two &amp; more</media:description>
   <media:community>
    <media:starRating count="321" average="5.00" min="1" max="5"/>
    <media:statistics views="12345"/>
   </media:community>
  </media:group>
 </entry>`;

const feedXml = (entries: string) => `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns:yt="http://www.youtube.com/xml/schemas/2015" xmlns:media="http://search.yahoo.com/mrss/" xmlns="http://www.w3.org/2005/Atom">
 <link rel="self" href="http://www.youtube.com/feeds/videos.xml?channel_id=${CHANNEL_ID}"/>
 <id>yt:channel:_x5XG1OV2P6uZZ5FSM9Ttw</id>
 <yt:channelId>_x5XG1OV2P6uZZ5FSM9Ttw</yt:channelId>
 <title>Google for Developers</title>
 <link rel="alternate" href="https://www.youtube.com/channel/${CHANNEL_ID}"/>
 <author>
  <name>Google for Developers</name>
  <uri>https://www.youtube.com/channel/${CHANNEL_ID}</uri>
 </author>
 <published>2007-08-23T00:34:43+00:00</published>${entries}
</feed>`;

describe("feeds", () => {
  it("parses a channel feed", () => {
    const feed = parseFeed(feedXml(entry("aaaaaaaaaaa", "Tom &amp; Jerry &#8211; &lt;live&gt;", "2026-10-01T10:00:00+00:00") + entry("bbbbbbbbbbb", "A Short", "2026-09-30T10:00:00+00:00", true)));
    expect(feed).toMatchObject({ title: "Google for Developers", channelId: CHANNEL_ID, playlistId: undefined, url: `https://www.youtube.com/channel/${CHANNEL_ID}` });
    expect(feed.entries).toHaveLength(2);
    expect(feed.entries[0]).toEqual({
      videoId: "aaaaaaaaaaa",
      channelId: CHANNEL_ID,
      title: `Tom & Jerry ${String.fromCharCode(0x2013)} <live>`,
      url: "https://www.youtube.com/watch?v=aaaaaaaaaaa",
      isShort: false,
      author: { name: "Google for Developers", url: `https://www.youtube.com/channel/${CHANNEL_ID}` },
      publishedAt: "2026-10-01T10:00:00+00:00",
      updatedAt: "2026-10-01T10:00:00+00:00",
      description: "Line one\nLine two & more",
      thumbnail: { url: "https://i1.ytimg.com/vi/aaaaaaaaaaa/hqdefault.jpg", width: 480, height: 360 },
      views: 12345,
      likes: 321,
    });
    expect(feed.entries[1]).toMatchObject({ isShort: true, url: "https://www.youtube.com/shorts/bbbbbbbbbbb" });
    expect(() => parseFeed("<html></html>")).toThrow(YouTubeArgumentError);
  });

  it("builds feed URLs from ids only", () => {
    expect(feedUrl(CHANNEL_ID)).toBe(`https://www.youtube.com/feeds/videos.xml?channel_id=${CHANNEL_ID}`);
    expect(feedUrl("PLBCF2DAC6FFB574DE")).toBe("https://www.youtube.com/feeds/videos.xml?playlist_id=PLBCF2DAC6FFB574DE");
    expect(() => feedUrl("@GoogleDevelopers")).toThrow(/resolveId/);
  });

  it("fetches a feed and names an outage for what it is", async () => {
    const ok = mockFetch(new Response(feedXml(entry("aaaaaaaaaaa", "One", "2026-10-01T10:00:00+00:00"))));
    expect((await fetchFeed(CHANNEL_ID, { fetch: ok.fetch })).entries).toHaveLength(1);
    const down = mockFetch(new Response("<html>404</html>", { status: 404 }));
    await expect(fetchFeed(CHANNEL_ID, { fetch: down.fetch })).rejects.toMatchObject({ code: "FEED_UNAVAILABLE" });
    const broken = mockFetch(() => {
      throw new TypeError("fetch failed");
    });
    await expect(fetchFeed(CHANNEL_ID, { fetch: broken.fetch })).rejects.toMatchObject({ code: "FEED_UNAVAILABLE" });
  });

  it("reads oEmbed data and returns null for a missing video", async () => {
    const found = mockFetch(json({ title: "Never Gonna Give You Up", author_name: "Rick Astley", author_url: "https://www.youtube.com/@RickAstleyYT", type: "video", html: "<iframe></iframe>", width: 200, height: 113, thumbnail_url: "https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg", thumbnail_width: 480, thumbnail_height: 360 }));
    const info = await oEmbed("dQw4w9WgXcQ", { fetch: found.fetch, maxWidth: 640 });
    expect(info).toMatchObject({ title: "Never Gonna Give You Up", authorName: "Rick Astley", type: "video", thumbnailWidth: 480 });
    expect(found.calls[0]!.url.searchParams.get("url")).toBe("https://www.youtube.com/watch?v=dQw4w9WgXcQ");
    expect(found.calls[0]!.url.searchParams.get("maxwidth")).toBe("640");
    const missing = mockFetch(new Response("Bad Request", { status: 400 }));
    await expect(oEmbed("https://youtu.be/aaaaaaaaaaa", { fetch: missing.fetch })).resolves.toBeNull();
  });
});

describe("websub", () => {
  const notification = `<?xml version='1.0' encoding='UTF-8'?>
<feed xmlns:yt="http://www.youtube.com/xml/schemas/2015" xmlns="http://www.w3.org/2005/Atom">
  <link rel="hub" href="https://pubsubhubbub.appspot.com"/>
  <link rel="self" href="https://www.youtube.com/xml/feeds/videos.xml?channel_id=${CHANNEL_ID}"/>
  <title>YouTube video feed</title>
  <updated>2026-10-01T10:00:05.123+00:00</updated>
  <entry>
    <id>yt:video:aaaaaaaaaaa</id>
    <yt:videoId>aaaaaaaaaaa</yt:videoId>
    <yt:channelId>${CHANNEL_ID}</yt:channelId>
    <title>Video title</title>
    <link rel="alternate" href="https://www.youtube.com/watch?v=aaaaaaaaaaa"/>
    <author>
      <name>Channel title</name>
      <uri>https://www.youtube.com/channel/${CHANNEL_ID}</uri>
    </author>
    <published>2026-10-01T10:00:00+00:00</published>
    <updated>2026-10-01T10:00:05.123+00:00</updated>
  </entry>
</feed>`;
  const deletion = `<?xml version='1.0' encoding='UTF-8'?>
<feed xmlns:at="http://purl.org/atompub/tombstones/1.0" xmlns="http://www.w3.org/2005/Atom">
  <at:deleted-entry ref="yt:video:bbbbbbbbbbb" when="2026-10-02T08:00:00+00:00">
    <link href="https://www.youtube.com/watch?v=bbbbbbbbbbb"/>
    <at:by><name>Channel title</name><uri>https://www.youtube.com/channel/${CHANNEL_ID}</uri></at:by>
  </at:deleted-entry>
</feed>`;

  async function sign(body: string, secret: string, hash: "SHA-1" | "SHA-256" = "SHA-1"): Promise<string> {
    const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash }, false, ["sign"]);
    const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body));
    return `${hash === "SHA-1" ? "sha1" : "sha256"}=${[...new Uint8Array(signature)].map((byte) => byte.toString(16).padStart(2, "0")).join("")}`;
  }

  it("subscribes and unsubscribes at the hub", async () => {
    const { fetch, calls } = mockFetch(new Response(null, { status: 202 }));
    await websub.subscribe({ channelId: CHANNEL_ID, callbackUrl: "https://app.example/hook", secret: "s3cret", lease: "1d", fetch });
    expect(calls[0]!.url.href).toBe("https://pubsubhubbub.appspot.com/subscribe");
    expect(Object.fromEntries(new URLSearchParams(String(calls[0]!.init.body)))).toEqual({
      "hub.mode": "subscribe",
      "hub.topic": `https://www.youtube.com/xml/feeds/videos.xml?channel_id=${CHANNEL_ID}`,
      "hub.callback": "https://app.example/hook",
      "hub.verify": "async",
      "hub.lease_seconds": "86400",
      "hub.secret": "s3cret",
    });
    await websub.unsubscribe({ channelId: CHANNEL_ID, callbackUrl: "https://app.example/hook", fetch });
    expect(new URLSearchParams(String(calls[1]!.init.body)).get("hub.mode")).toBe("unsubscribe");
    await expect(websub.subscribe({ channelId: "@handle", callbackUrl: "https://app.example/hook", fetch })).rejects.toThrow(/not a channel id/);
    const refused = mockFetch(new Response("Invalid callback", { status: 400 }));
    await expect(websub.subscribe({ channelId: CHANNEL_ID, callbackUrl: "nope", fetch: refused.fetch })).rejects.toThrow(/400: Invalid callback/);
  });

  it("answers the hub's confirmation", async () => {
    const topic = encodeURIComponent(websub.topicUrl(CHANNEL_ID));
    const request = new Request(`https://app.example/hook?hub.mode=subscribe&hub.topic=${topic}&hub.challenge=abc123&hub.lease_seconds=432000`);
    const result = await websub.receive(request);
    expect(result.response.status).toBe(200);
    expect(await result.response.text()).toBe("abc123");
    expect(result.confirmation).toEqual({ mode: "subscribe", topic: websub.topicUrl(CHANNEL_ID), channelId: CHANNEL_ID, leaseSeconds: 432000 });

    const refused = await websub.receive(request.clone(), { confirm: ({ channelId }) => channelId !== CHANNEL_ID });
    expect(refused.response.status).toBe(404);
    expect((await websub.receive(new Request("https://app.example/hook"))).response.status).toBe(400);
    expect((await websub.receive(new Request("https://app.example/hook", { method: "PUT" }))).response.status).toBe(405);
  });

  it("parses uploads and deletions", async () => {
    const upload = await websub.receive(new Request("https://app.example/hook", { method: "POST", body: notification }));
    expect(upload.response.status).toBe(204);
    expect(upload.notifications).toEqual([
      {
        type: "video",
        videoId: "aaaaaaaaaaa",
        channelId: CHANNEL_ID,
        title: "Video title",
        url: "https://www.youtube.com/watch?v=aaaaaaaaaaa",
        author: { name: "Channel title", url: `https://www.youtube.com/channel/${CHANNEL_ID}` },
        publishedAt: "2026-10-01T10:00:00+00:00",
        updatedAt: "2026-10-01T10:00:05.123+00:00",
      },
    ]);
    expect(websub.parse(deletion)).toEqual([{ type: "deleted", videoId: "bbbbbbbbbbb", channelId: CHANNEL_ID, deletedAt: "2026-10-02T08:00:00+00:00" }]);
    expect(websub.parse("not xml at all")).toEqual([]);
  });

  it("drops notifications whose signature is missing or wrong", async () => {
    const post = (headers: Record<string, string>) => websub.receive(new Request("https://app.example/hook", { method: "POST", body: notification, headers }), { secret: "s3cret" });
    const valid = await post({ "x-hub-signature": await sign(notification, "s3cret") });
    expect(valid.verified).toBe(true);
    expect(valid.notifications).toHaveLength(1);
    expect((await post({ "x-hub-signature-256": await sign(notification, "s3cret", "SHA-256") })).notifications).toHaveLength(1);

    const forgeries: Array<Record<string, string>> = [{}, { "x-hub-signature": await sign(notification, "other") }, { "x-hub-signature": "sha1=zz" }];
    for (const headers of forgeries) {
      const forged = await post(headers);
      expect(forged).toMatchObject({ verified: false, notifications: [] });
      expect(forged.response.status).toBe(202);
    }
    expect(await websub.verify("body", await sign("body", "k"), "k")).toBe(true);
    expect(await websub.verify("body!", await sign("body", "k"), "k")).toBe(false);
  });
});

describe("Watcher", () => {
  const xml = (...videos: Array<[string, string]>) => feedXml(videos.map(([id, published]) => entry(id, `Video ${id}`, published)).join(""));

  it("reports only what was published after it started", async () => {
    const start = Date.parse("2026-10-01T12:00:00Z");
    let feed = xml(["aaaaaaaaaaa", "2026-10-01T11:00:00+00:00"]);
    const { fetch, calls } = mockFetch(() => new Response(feed));
    const watcher = new Watcher([CHANNEL_ID], { since: start, fetch });
    const seen: WatchedVideo[] = [];
    watcher.on("video", (video) => seen.push(video));

    expect(await watcher.check()).toEqual([]);
    feed = xml(["ccccccccccc", "2026-10-01T12:30:00+00:00"], ["bbbbbbbbbbb", "2026-10-01T12:10:00+00:00"], ["aaaaaaaaaaa", "2026-10-01T11:00:00+00:00"]);
    const found = await watcher.check();
    expect(found.map((video) => video.videoId)).toEqual(["bbbbbbbbbbb", "ccccccccccc"]);
    expect(found[0]).toMatchObject({ channelId: CHANNEL_ID, channelTitle: "Google for Developers", title: "Video bbbbbbbbbbb", source: "feed", isShort: false });
    expect(await watcher.check()).toEqual([]);
    expect(seen.map((video) => video.videoId)).toEqual(["bbbbbbbbbbb", "ccccccccccc"]);
    expect(calls).toHaveLength(3);
  });

  it("does not report an old video that slides back into the feed", async () => {
    let feed = xml(["bbbbbbbbbbb", "2026-10-01T11:00:00+00:00"]);
    const { fetch } = mockFetch(() => new Response(feed));
    const watcher = new Watcher([CHANNEL_ID], { since: "2026-10-01T12:00:00Z", fetch });
    await watcher.check();
    feed = xml(["aaaaaaaaaaa", "2026-09-01T11:00:00+00:00"]);
    expect(await watcher.check()).toEqual([]);
  });

  it("needs an API client for handles, and falls back on the API when the feed is down", async () => {
    expect(() => new Watcher(["@GoogleDevelopers"])).toThrow(/yt\.watch/);
    expect(() => new Watcher([CHANNEL_ID], { source: "api" })).toThrow(/API client/);

    const { yt, calls } = client((call) => {
      if (call.url.hostname === "www.youtube.com") return new Response("down", { status: 404 });
      if (call.url.pathname.endsWith("/channels")) return list([{ id: CHANNEL_ID }]);
      return list([
        { snippet: { title: "Fresh", channelTitle: "Google for Developers", publishedAt: "2026-10-01T12:30:00Z", thumbnails: { high: { url: "https://i.ytimg.com/h.jpg", width: 480 } } }, contentDetails: { videoId: "ccccccccccc", videoPublishedAt: "2026-10-01T12:30:00Z" } },
      ]);
    });
    const watcher = yt.watch("@GoogleDevelopers", { since: "2026-10-01T12:00:00Z" });
    const polls: string[] = [];
    watcher.on("poll", (event) => polls.push(`${event.source}:${event.found}`));
    const found = await watcher.check();
    expect(found).toMatchObject([{ videoId: "ccccccccccc", title: "Fresh", source: "api", thumbnail: "https://i.ytimg.com/h.jpg", url: "https://www.youtube.com/watch?v=ccccccccccc" }]);
    await watcher.check();
    expect(polls).toEqual(["api:1", "api:0"]);
    // One failed feed request, then the feed is left alone for a while.
    expect(calls.map((call) => call.url.pathname.split("/").pop())).toEqual(["channels", "videos.xml", "playlistItems", "playlistItems"]);
  });

  it("keeps going when a channel fails, and can add and remove channels", async () => {
    const { fetch } = mockFetch((call) => (call.url.searchParams.get("channel_id") === CHANNEL_ID ? new Response(xml(["aaaaaaaaaaa", "2026-10-01T12:30:00+00:00"])) : apiError(500, "boom")));
    const watcher = new Watcher([CHANNEL_ID, "UCaaaaaaaaaaaaaaaaaaaaaa"], { since: "2026-10-01T12:00:00Z", source: "feed", fetch });
    const errors: string[] = [];
    watcher.on("error", ({ channel }) => errors.push(channel));
    expect((await watcher.check()).map((video) => video.videoId)).toEqual(["aaaaaaaaaaa"]);
    expect(errors).toEqual(["UCaaaaaaaaaaaaaaaaaaaaaa"]);
    watcher.remove("UCaaaaaaaaaaaaaaaaaaaaaa").add("UCbbbbbbbbbbbbbbbbbbbbbb");
    expect(watcher.channels).toEqual([CHANNEL_ID, "UCbbbbbbbbbbbbbbbbbbbbbb"]);
  });

  it("polls on a timer and streams videos", async () => {
    let round = 0;
    const { fetch } = mockFetch(() => new Response(xml([`${"abcdefghij"}${round++}`, new Date(Date.now() + 60_000).toISOString()])));
    const watcher = new Watcher([CHANNEL_ID], { interval: 5, fetch });
    const ids: string[] = [];
    for await (const video of watcher) {
      ids.push(video.videoId);
      if (ids.length === 3) break;
    }
    expect(ids).toEqual(["abcdefghij0", "abcdefghij1", "abcdefghij2"]);
    expect(watcher.running).toBe(false);
  });
});
