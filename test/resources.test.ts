import { describe, expect, it } from "vitest";
import { YouTubeArgumentError } from "../src/index.js";
import { CHANNEL_ID, type Call, VIDEO_ID, apiError, client, json, list } from "./helpers.js";

const param = (call: Call, name: string) => call.url.searchParams.get(name);
const resource = (call: Call) => call.url.pathname.split("/").pop();

describe("yt.channels", () => {
  it("finds a channel from a handle, a URL, an id or a legacy URL", async () => {
    const { yt, calls } = client(() => list([{ id: CHANNEL_ID, snippet: { title: "Google for Developers" } }]));
    await yt.channels.get("@GoogleDevelopers");
    await yt.channels.get("https://www.youtube.com/@GoogleDevelopers/videos");
    await yt.channels.get(CHANNEL_ID);
    await yt.channels.get(`https://youtube.com/channel/${CHANNEL_ID}`);
    await yt.channels.get("https://www.youtube.com/user/GoogleDevelopers");
    expect(calls.map((call) => param(call, "forHandle") ?? param(call, "id") ?? `user:${param(call, "forUsername")}`)).toEqual([
      "@GoogleDevelopers",
      "@GoogleDevelopers",
      CHANNEL_ID,
      CHANNEL_ID,
      "user:GoogleDevelopers",
    ]);
    expect(param(calls[0]!, "part")).toBe("snippet,contentDetails,statistics");
  });

  it("tries a bare name as a handle, then as a username", async () => {
    const { yt, calls } = client([list([]), list([{ id: CHANNEL_ID }])]);
    const channel = await yt.channels.get("GoogleDevelopers", { part: "id" });
    expect(channel?.id).toBe(CHANNEL_ID);
    expect(param(calls[0]!, "forHandle")).toBe("@GoogleDevelopers");
    expect(param(calls[1]!, "forUsername")).toBe("GoogleDevelopers");
  });

  it("resolves to null when nothing matches and rejects nonsense", async () => {
    const { yt } = client(() => list([]));
    await expect(yt.channels.get("@nobody")).resolves.toBeNull();
    await expect(yt.channels.get("https://example.com/whatever")).rejects.toBeInstanceOf(YouTubeArgumentError);
    await expect(yt.channels.get("")).rejects.toBeInstanceOf(YouTubeArgumentError);
  });

  it("resolves ids for free and remembers handles", async () => {
    const { yt, calls } = client(() => list([{ id: CHANNEL_ID }]));
    expect(await yt.channels.resolveId(CHANNEL_ID)).toBe(CHANNEL_ID);
    expect(calls).toHaveLength(0);
    expect(await yt.channels.resolveId("@GoogleDevelopers")).toBe(CHANNEL_ID);
    expect(await yt.channels.resolveId("@googledevelopers")).toBe(CHANNEL_ID);
    expect(calls).toHaveLength(1);
    expect(param(calls[0]!, "part")).toBe("id");
  });

  it("lists uploads through the uploads playlist, resolving the handle only when needed", async () => {
    const { yt, calls } = client((call) => (resource(call) === "channels" ? list([{ id: CHANNEL_ID }]) : list([{ id: "item", contentDetails: { videoId: VIDEO_ID } }])));
    const request = yt.channels.uploads("@GoogleDevelopers");
    expect(calls).toHaveLength(0);
    const page = await request;
    expect(page.items[0]?.contentDetails.videoId).toBe(VIDEO_ID);
    expect(resource(calls[1]!)).toBe("playlistItems");
    expect(param(calls[1]!, "playlistId")).toBe("UU_x5XG1OV2P6uZZ5FSM9Ttw");

    await yt.channels.uploads(CHANNEL_ID, { kind: "shorts", part: "id" }).take(3);
    expect(param(calls[2]!, "playlistId")).toBe("UUSH_x5XG1OV2P6uZZ5FSM9Ttw");
    expect(param(calls[2]!, "maxResults")).toBe("3");
    expect(yt.quota.used).toBe(3);
  });

  it("returns the latest videos as full resources, in upload order", async () => {
    const { yt, calls } = client((call) => {
      if (resource(call) === "playlistItems") return list([{ contentDetails: { videoId: "bbbbbbbbbbb" } }, { contentDetails: { videoId: "aaaaaaaaaaa" } }]);
      return list([{ id: "aaaaaaaaaaa" }, { id: "bbbbbbbbbbb" }]);
    });
    const videos = await yt.channels.latestVideos(CHANNEL_ID, { limit: 2 });
    expect(videos.map((video) => video.id)).toEqual(["bbbbbbbbbbb", "aaaaaaaaaaa"]);
    expect(param(calls[0]!, "part")).toBe("contentDetails");
    expect(param(calls[1]!, "part")).toBe("snippet,contentDetails,statistics");
    expect((await yt.channels.latestVideo(CHANNEL_ID))?.id).toBe("bbbbbbbbbbb");
  });

  it("treats a channel without uploads as empty", async () => {
    const { yt } = client(apiError(404, "playlistNotFound"));
    await expect(yt.channels.latestVideos(CHANNEL_ID)).resolves.toEqual([]);
    await expect(yt.channels.latestVideo(CHANNEL_ID)).resolves.toBeNull();
  });

  it("fetches the authenticated user's channel", async () => {
    const { yt, calls } = client(list([{ id: CHANNEL_ID }]), { accessToken: "t" });
    expect((await yt.channels.mine({ part: "id" }))?.id).toBe(CHANNEL_ID);
    expect(param(calls[0]!, "mine")).toBe("true");
  });
});

describe("yt.videos", () => {
  it("gets a video from any URL form", async () => {
    const { yt, calls } = client(() => list([{ id: VIDEO_ID }]));
    for (const input of [VIDEO_ID, `https://youtu.be/${VIDEO_ID}?t=4`, `https://www.youtube.com/watch?v=${VIDEO_ID}&list=PL1`, `https://www.youtube.com/shorts/${VIDEO_ID}`]) {
      expect((await yt.videos.get(input, { part: "id" }))?.id).toBe(VIDEO_ID);
    }
    expect(calls.every((call) => param(call, "id") === VIDEO_ID)).toBe(true);
    await expect(yt.videos.get("not a video")).rejects.toBeInstanceOf(YouTubeArgumentError);
  });

  it("resolves to null for a missing video", async () => {
    const { yt } = client(list([]));
    await expect(yt.videos.get(VIDEO_ID)).resolves.toBeNull();
  });

  it("gets many videos in the order asked, without duplicates or holes", async () => {
    const { yt, calls } = client(list([{ id: "ccccccccccc" }, { id: "aaaaaaaaaaa" }]));
    const videos = await yt.videos.getMany(["aaaaaaaaaaa", "bbbbbbbbbbb", "https://youtu.be/ccccccccccc", "aaaaaaaaaaa"], { part: "id" });
    expect(videos.map((video) => video.id)).toEqual(["aaaaaaaaaaa", "ccccccccccc"]);
    expect(param(calls[0]!, "id")).toBe("aaaaaaaaaaa,bbbbbbbbbbb,ccccccccccc");
    await expect(yt.videos.getMany([])).resolves.toEqual([]);
    expect(calls).toHaveLength(1);
  });

  it("lists the popular chart", async () => {
    const { yt, calls } = client(list([]));
    await yt.videos.popular({ regionCode: "FR", videoCategoryId: "10", part: "id" });
    expect(Object.fromEntries(calls[0]!.url.searchParams)).toEqual({ part: "id", chart: "mostPopular", regionCode: "FR", videoCategoryId: "10" });
  });

  it("rates videos", async () => {
    const { yt, calls } = client([new Response(null, { status: 204 }), new Response(null, { status: 204 }), new Response(null, { status: 204 }), list([{ videoId: VIDEO_ID, rating: "like" }])], { accessToken: "t" });
    await yt.videos.like(`https://youtu.be/${VIDEO_ID}`);
    await yt.videos.dislike(VIDEO_ID);
    await yt.videos.unrate(VIDEO_ID);
    expect(calls.slice(0, 3).map((call) => param(call, "rating"))).toEqual(["like", "dislike", "none"]);
    expect(await yt.videos.ratingOf(VIDEO_ID)).toBe("like");
  });
});

describe("yt.playlists", () => {
  it("reads a playlist and its items from a URL", async () => {
    const { yt, calls } = client((call) => (resource(call) === "playlists" ? list([{ id: "PL123" }]) : list([{ id: "i1" }])));
    expect((await yt.playlists.get("https://www.youtube.com/playlist?list=PL123", { part: "id" }))?.id).toBe("PL123");
    await yt.playlists.items(`https://www.youtube.com/watch?v=${VIDEO_ID}&list=PL123`).first();
    expect(param(calls[1]!, "playlistId")).toBe("PL123");
    await expect(yt.playlists.get(`https://youtu.be/${VIDEO_ID}`)).rejects.toBeInstanceOf(YouTubeArgumentError);
  });

  it("walks the videos of a playlist as full resources", async () => {
    const { yt, calls } = client((call) => {
      if (resource(call) === "playlistItems") {
        return param(call, "pageToken")
          ? list([{ contentDetails: { videoId: "ccccccccccc" } }])
          : list([{ contentDetails: { videoId: "aaaaaaaaaaa" } }, { contentDetails: { videoId: "bbbbbbbbbbb" } }], { nextPageToken: "T2" });
      }
      // "bbbbbbbbbbb" is private: the API leaves it out.
      return list(param(call, "id")!.split(",").filter((id) => id !== "bbbbbbbbbbb").map((id) => ({ id })));
    });
    const seen: string[] = [];
    for await (const video of yt.playlists.videos("PL123", { part: "id" })) seen.push(video.id);
    expect(seen).toEqual(["aaaaaaaaaaa", "ccccccccccc"]);
    expect(calls.map(resource)).toEqual(["playlistItems", "videos", "playlistItems", "videos"]);

    const limited: string[] = [];
    for await (const video of yt.playlists.videos("PL123", { part: "id", limit: 1 })) limited.push(video.id);
    expect(limited).toEqual(["aaaaaaaaaaa"]);
  });

  it("creates playlists and edits their content", async () => {
    const { yt, calls } = client(
      (call) => {
        if (call.method === "GET") return list([{ id: "item1" }, { id: "item2" }]);
        if (call.method === "DELETE") return new Response(null, { status: 204 });
        return json({ id: "new" });
      },
      { accessToken: "t" },
    );
    await yt.playlists.create({ title: "Mix", description: "d", privacy: "unlisted" });
    expect(calls[0]!.body).toEqual({ snippet: { title: "Mix", description: "d" }, status: { privacyStatus: "unlisted" } });

    await yt.playlists.add("PL123", `https://youtu.be/${VIDEO_ID}`, { position: 0 });
    expect(resource(calls[1]!)).toBe("playlistItems");
    expect(calls[1]!.body).toEqual({ snippet: { playlistId: "PL123", resourceId: { kind: "youtube#video", videoId: VIDEO_ID }, position: 0 } });

    expect(await yt.playlists.removeVideo("PL123", VIDEO_ID)).toBe(2);
    expect(Object.fromEntries(calls[2]!.url.searchParams)).toMatchObject({ playlistId: "PL123", videoId: VIDEO_ID });
    expect(calls.slice(3).map((call) => `${call.method} ${param(call, "id")}`)).toEqual(["DELETE item1", "DELETE item2"]);
  });
});

describe("search, comments and subscriptions", () => {
  it("searches by result type", async () => {
    const { yt, calls } = client(() => list([{ id: { kind: "youtube#video", videoId: VIDEO_ID }, snippet: { title: "t" } }]));
    const [result] = await yt.search.videos("lofi", { order: "viewCount", videoDuration: "long" }).take(1);
    expect(result?.id.videoId).toBe(VIDEO_ID);
    expect(Object.fromEntries(calls[0]!.url.searchParams)).toEqual({ part: "snippet", q: "lofi", type: "video", order: "viewCount", videoDuration: "long", maxResults: "1" });
    await yt.search.channels("google");
    await yt.search.playlists("course");
    await yt.search.live("speedrun", { channelId: CHANNEL_ID });
    expect(calls.slice(1).map((call) => param(call, "type"))).toEqual(["channel", "playlist", "video"]);
    expect(param(calls[3]!, "eventType")).toBe("live");
    expect(yt.quota.usage).toEqual({ "search.list": 4 });
  });

  it("reads and writes comments", async () => {
    const { yt, calls } = client((call) => (call.method === "GET" ? list([]) : json({ id: "c1" })), { accessToken: "t" });
    await yt.commentThreads.forVideo(`https://youtu.be/${VIDEO_ID}`, { order: "relevance", part: ["snippet", "replies"] });
    expect(Object.fromEntries(calls[0]!.url.searchParams)).toEqual({ part: "snippet,replies", videoId: VIDEO_ID, order: "relevance" });
    await yt.commentThreads.post(VIDEO_ID, "Nice");
    expect(calls[1]!.body).toEqual({ snippet: { videoId: VIDEO_ID, topLevelComment: { snippet: { textOriginal: "Nice" } } } });
    await yt.comments.replies("thread1").all();
    expect(Object.fromEntries(calls[2]!.url.searchParams)).toEqual({ part: "snippet", parentId: "thread1", maxResults: "100" });
    await yt.comments.reply("thread1", "Thanks");
    expect(calls[3]!.body).toEqual({ snippet: { parentId: "thread1", textOriginal: "Thanks" } });
    await yt.comments.edit("c1", "Edited");
    expect(calls[4]!.method).toBe("PUT");
    expect(calls[4]!.body).toEqual({ id: "c1", snippet: { textOriginal: "Edited" } });
  });

  it("subscribes and unsubscribes by channel", async () => {
    const { yt, calls } = client(
      (call) => {
        if (call.method === "POST") return json({ id: "sub1" });
        if (call.method === "DELETE") return new Response(null, { status: 204 });
        return list(param(call, "forChannelId") === CHANNEL_ID ? [{ id: "sub1" }] : []);
      },
      { accessToken: "t" },
    );
    await yt.subscriptions.subscribe(CHANNEL_ID);
    expect(calls[0]!.body).toEqual({ snippet: { resourceId: { kind: "youtube#channel", channelId: CHANNEL_ID } } });
    expect(await yt.subscriptions.unsubscribe(CHANNEL_ID)).toBe(true);
    expect(`${calls[2]!.method} ${param(calls[2]!, "id")}`).toBe("DELETE sub1");
    expect(await yt.subscriptions.unsubscribe("UCaaaaaaaaaaaaaaaaaaaaaa")).toBe(false);
  });
});

describe("analytics and reporting", () => {
  it("builds a report query and turns rows into objects", async () => {
    const { yt, calls } = client(
      {
        columnHeaders: [
          { name: "day", columnType: "DIMENSION", dataType: "STRING" },
          { name: "views", columnType: "METRIC", dataType: "INTEGER" },
          { name: "averageViewDuration", columnType: "METRIC", dataType: "INTEGER" },
        ],
        rows: [
          ["2026-01-01", 120, 95],
          ["2026-01-02", 80, 101],
        ],
      },
      { accessToken: "t" },
    );
    const report = await yt.analytics.query({
      startDate: "2026-01-01",
      endDate: new Date(2026, 0, 31),
      metrics: ["views", "averageViewDuration"],
      dimensions: "day",
      filters: { country: "FR", video: [VIDEO_ID, "aaaaaaaaaaa"] },
      sort: "-views",
      maxResults: 10,
    });
    expect(calls[0]!.url.origin + calls[0]!.url.pathname).toBe("https://youtubeanalytics.googleapis.com/v2/reports");
    expect(Object.fromEntries(calls[0]!.url.searchParams)).toEqual({
      ids: "channel==MINE",
      startDate: "2026-01-01",
      endDate: "2026-01-31",
      metrics: "views,averageViewDuration",
      dimensions: "day",
      filters: `country==FR;video==${VIDEO_ID},aaaaaaaaaaa`,
      sort: "-views",
      maxResults: "10",
    });
    expect(report.rows).toEqual([
      { day: "2026-01-01", views: 120, averageViewDuration: 95 },
      { day: "2026-01-02", views: 80, averageViewDuration: 101 },
    ]);
    expect(report.columns[0]).toEqual({ name: "day", type: "DIMENSION", dataType: "STRING" });
    await expect(yt.analytics.query({ startDate: "01/01/2026", endDate: "2026-01-02", metrics: "views" })).rejects.toThrow(/YYYY-MM-DD/);
  });

  it("handles an empty report and Analytics groups", async () => {
    const { yt, calls } = client([{ columnHeaders: [] }, { items: [{ id: "g1" }] }], { accessToken: "t" });
    expect((await yt.analytics.query({ startDate: "2026-01-01", endDate: "2026-01-02", metrics: "views" })).rows).toEqual([]);
    expect((await yt.analytics.groups.list({ mine: true })).items).toEqual([{ id: "g1" }]);
    expect(calls[1]!.url.pathname).toBe("/v2/groups");
  });

  it("downloads a report with the token, and only from Google", async () => {
    const { yt, calls } = client(new Response("date,views\n2026-01-01,5\n"), { accessToken: "secret-token" });
    const url = "https://youtubereporting.googleapis.com/v1/media/CHANNEL/abc/jobs/j1/reports/r1?alt=media";
    await expect(yt.reporting.download({ downloadUrl: url })).resolves.toBe("date,views\n2026-01-01,5\n");
    expect(calls[0]!.url.href).toBe(url);
    expect(calls[0]!.headers.get("authorization")).toBe("Bearer secret-token");
    expect(() => yt.reporting.downloadResponse("https://evil.example/steal")).toThrow(/Refusing/);
    expect(() => yt.reporting.downloadResponse({})).toThrow(/no download URL/);
    expect(calls).toHaveLength(1);
  });
});
