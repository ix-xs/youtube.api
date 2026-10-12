// Defects found while the documentation was being written against the code.
// One test each, so none of them comes back.

import { afterEach, describe, expect, it, vi } from "vitest";
import { OAuth2, Watcher, YouTube, YouTubeArgumentError, YouTubeUploadError, isPlaylistId, oEmbed, parseChannelRef, parseDuration, websub } from "../src/index.js";
import { CHANNEL_ID, type Call, VIDEO_ID, apiError, client, json, list, mockFetch } from "./helpers.js";

const PLAYLIST = "PLBCF2DAC6FFB574DE";
const param = (call: Call, name: string) => call.url.searchParams.get(name);
const resource = (call: Call) => call.url.pathname.split("/").pop();

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("helpers and pages", () => {
  it("asks for a full page when a helper is awaited, and leaves raw lists alone", async () => {
    const { yt, calls } = client(() => list([]));
    await yt.playlists.items(PLAYLIST);
    await yt.channels.uploads(CHANNEL_ID);
    await yt.search.videos("lofi");
    await yt.playlistItems.list({ part: "id", playlistId: PLAYLIST });
    expect(calls.map((call) => param(call, "maxResults"))).toEqual(["50", "50", "50", null]);
  });

  it("counts videos, not playlist items, towards the limit of playlists.videos", async () => {
    const { yt } = client((call) => {
      if (resource(call) === "playlistItems") {
        return param(call, "pageToken")
          ? list(["ddddddddddd", "eeeeeeeeeee"].map((videoId) => ({ contentDetails: { videoId } })))
          : list(["aaaaaaaaaaa", "bbbbbbbbbbb", "aaaaaaaaaaa", "ccccccccccc"].map((videoId) => ({ contentDetails: { videoId } })), { nextPageToken: "T2" });
      }
      // "bbbbbbbbbbb" was deleted.
      return list(param(call, "id")!.split(",").filter((id) => id !== "bbbbbbbbbbb").map((id) => ({ id })));
    });
    const seen: string[] = [];
    for await (const video of yt.playlists.videos(PLAYLIST, { part: "id", limit: 4 })) seen.push(video.id);
    // The repeat is kept in its place, the deleted video does not use up the limit.
    expect(seen).toEqual(["aaaaaaaaaaa", "aaaaaaaaaaa", "ccccccccccc", "ddddddddddd"]);
  });

  it("describes a merged page by its own content, and stops chunked pages at the limit", async () => {
    const ids = Array.from({ length: 120 }, (_, index) => `v${String(index).padStart(10, "0")}`);
    const { yt, calls } = client((call) => list(param(call, "id")!.split(",").map((id) => ({ id })), { pageInfo: { totalResults: 50, resultsPerPage: 50 } }));
    const page = await yt.videos.list({ part: "id", id: ids });
    expect(page.totalResults).toBe(120);
    calls.length = 0;
    const pages = [];
    for await (const chunk of yt.videos.list({ part: "id", id: ids }).pages({ limit: 60 })) pages.push(chunk);
    expect(pages).toHaveLength(2);
    expect(calls).toHaveLength(2);
  });

  it("omits the query of a search helper when it is empty", async () => {
    const { yt, calls } = client(list([]));
    await yt.search.live("", { channelId: CHANNEL_ID });
    expect(calls[0]!.url.searchParams.has("q")).toBe(false);
    expect(param(calls[0]!, "eventType")).toBe("live");
  });
});

describe("channel references", () => {
  it("remembers a handle however it is written", async () => {
    const { yt, calls } = client(() => list([{ id: CHANNEL_ID }]));
    await yt.channels.resolveId("@GoogleDevelopers");
    await yt.channels.resolveId("https://www.youtube.com/@googledevelopers/videos");
    await yt.channels.resolveId("GoogleDevelopers");
    expect(calls).toHaveLength(1);
  });

  it("reads a bare name with a dot as a handle, and a bare domain as a URL", () => {
    expect(parseChannelRef("some.name")).toEqual({ by: "handle", value: "@some.name" });
    expect(parseChannelRef("youtube.com/@some.name")).toEqual({ by: "handle", value: "@some.name" });
    expect(() => parseChannelRef("youtube.com")).toThrow(YouTubeArgumentError);
  });

  it("does not take a bare prefix for a playlist id", () => {
    expect(isPlaylistId("PL")).toBe(false);
    expect(isPlaylistId("UU")).toBe(false);
    expect(isPlaylistId("WL")).toBe(true);
    expect(isPlaylistId(PLAYLIST)).toBe(true);
    expect(isPlaylistId("UU_x5XG1OV2P6uZZ5FSM9Ttw")).toBe(true);
  });
});

describe("credentials", () => {
  const tokens = (scope: string) => ({ accessToken: "access", refreshToken: "refresh", expiresAt: Date.now() + 3_600_000, scope });

  it("sends a public read with the key when the token lacks the scope for it", async () => {
    const { fetch, calls } = mockFetch(() => list([]));
    const yt = new YouTube({ apiKey: "key", fetch, oauth: { clientId: "client", tokens: tokens("https://www.googleapis.com/auth/yt-analytics.readonly") } });
    await yt.commentThreads.forVideo(VIDEO_ID);
    expect(calls[0]!.headers.get("x-goog-api-key")).toBe("key");
    expect(calls[0]!.headers.has("authorization")).toBe(false);
    await expect(yt.commentThreads.post(VIDEO_ID, "hi")).rejects.toMatchObject({ code: "INSUFFICIENT_SCOPE" });
  });

  it("reads YOUTUBE_API_KEY next to OAuth, and refuses what is not options", async () => {
    vi.stubEnv("YOUTUBE_API_KEY", "env-key");
    const { fetch, calls } = mockFetch(list([]));
    await new YouTube({ fetch, oauth: { clientId: "client" } }).videos.list({ part: "id", id: VIDEO_ID });
    expect(calls[0]!.headers.get("x-goog-api-key")).toBe("env-key");
    expect(() => new YouTube(null as never)).toThrow(YouTubeArgumentError);
    expect(() => new YouTube(42 as never)).toThrow(YouTubeArgumentError);
  });

  it("only sends the content owner to methods that take it", async () => {
    const { yt, calls } = client(() => ({ items: [], columnHeaders: [] }), { accessToken: "t", onBehalfOfContentOwner: "owner" });
    await yt.videos.list({ part: "id", id: VIDEO_ID });
    await yt.i18nLanguages.list({ part: "snippet" });
    await yt.analytics.query({ startDate: "2026-01-01", endDate: "2026-01-02", metrics: "views" });
    await yt.reporting.jobs.list();
    expect(calls.map((call) => param(call, "onBehalfOfContentOwner"))).toEqual(["owner", null, null, "owner"]);
  });

  it("keeps a user's cache across a token refresh", async () => {
    let served = 0;
    const { fetch, calls } = mockFetch((call) => {
      if (call.url.hostname === "oauth2.googleapis.com") return json({ access_token: `access-${++served}`, expires_in: 3600 });
      return list([{ id: CHANNEL_ID }]);
    });
    const oauth = new OAuth2({ clientId: "client", fetch, tokens: { accessToken: "access-0", refreshToken: "refresh", expiresAt: Date.now() + 3_600_000 } });
    const yt = new YouTube({ fetch, oauth, cache: true });
    await yt.channels.list({ part: "id", mine: true });
    await oauth.refresh();
    await yt.channels.list({ part: "id", mine: true });
    expect(calls.filter((call) => call.url.hostname === "youtube.googleapis.com")).toHaveLength(1);
  });

  it("lets a derived client carry its own quota user", async () => {
    const { yt, calls } = client(() => list([]), { quotaUser: "base" });
    await yt.as("token", { quotaUser: "user-42" }).videos.list({ part: "id", id: VIDEO_ID });
    await yt.videos.list({ part: "id", id: VIDEO_ID });
    expect(calls.map((call) => param(call, "quotaUser"))).toEqual(["user-42", "base"]);
  });

  it("tells the token store about a revocation, and wraps an aborted device wait", async () => {
    const { fetch } = mockFetch(new Response("{}"));
    const saved: unknown[] = [];
    const oauth = new OAuth2({ clientId: "client", fetch, tokens: { accessToken: "a", refreshToken: "r" }, onTokens: (stored) => void saved.push(stored) });
    await oauth.revoke();
    expect(saved).toEqual([{}]);

    const controller = new AbortController();
    const waiting = oauth.pollDeviceToken({ deviceCode: "d", userCode: "u", verificationUrl: "v", expiresIn: 600, interval: 5 }, { signal: controller.signal });
    controller.abort();
    await expect(waiting).rejects.toMatchObject({ code: "ABORTED" });
  });
});

describe("events", () => {
  it("routes a rejecting async listener to the error event", async () => {
    const { yt } = client(list([]));
    const errors: unknown[] = [];
    yt.on("error", (error) => errors.push(error));
    yt.on("response", async () => {
      throw new Error("listener failed");
    });
    await yt.videos.list({ part: "id", id: VIDEO_ID });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(errors).toHaveLength(1);
    expect((errors[0] as Error).message).toBe("listener failed");
  });
});

describe("watcher", () => {
  const entry = (id: string, published: string) =>
    `<entry><yt:videoId>${id}</yt:videoId><yt:channelId>${CHANNEL_ID}</yt:channelId><title>${id}</title><published>${published}</published></entry>`;
  const feed = (...entries: string[]) => new Response(`<feed xmlns="http://www.w3.org/2005/Atom"><title>t</title>${entries.join("")}</feed>`);

  it("gives a failing listener the documented error shape", async () => {
    const { fetch } = mockFetch(() => feed(entry("aaaaaaaaaaa", new Date(Date.now() + 60_000).toISOString())));
    const watcher = new Watcher([CHANNEL_ID], { fetch });
    const errors: Array<{ channel: string; error: unknown }> = [];
    watcher.on("error", (event) => errors.push(event));
    watcher.on("video", async () => {
      throw new Error("webhook down");
    });
    await watcher.check();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(errors).toHaveLength(1);
    expect(errors[0]!.channel).toBe("");
    expect((errors[0]!.error as Error).message).toBe("webhook down");
  });

  it("keeps channel ids that differ only by case apart", () => {
    const upper = "UCAAAAAAAAAAAAAAAAAAAAAA";
    const lower = "UCaaaaaaaaaaaaaaaaaaaaaa";
    const watcher = new Watcher([upper, lower]);
    expect(watcher.channels).toEqual([upper, lower]);
    watcher.remove(upper);
    expect(watcher.channels).toEqual([lower]);
  });

  it("does not report the recent past of a channel added later", async () => {
    const hourAgo = new Date(Date.now() - 3_600_000).toISOString();
    const { fetch } = mockFetch(() => feed(entry("aaaaaaaaaaa", hourAgo)));
    const watcher = new Watcher([], { since: Date.now() - 86_400_000, fetch });
    watcher.add(CHANNEL_ID);
    expect(await watcher.check()).toEqual([]);
  });

  it("reports an undated video once it knows what the channel already held", async () => {
    let body = entry("aaaaaaaaaaa", "");
    const { fetch } = mockFetch(() => feed(body));
    const watcher = new Watcher([CHANNEL_ID], { fetch });
    expect(await watcher.check()).toEqual([]);
    body = entry("bbbbbbbbbbb", "") + entry("aaaaaaaaaaa", "");
    expect((await watcher.check()).map((video) => video.videoId)).toEqual(["bbbbbbbbbbb"]);
  });
});

describe("webhooks and key-less endpoints", () => {
  it("stops reading an oversized body that declares no length", async () => {
    let pulled = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulled++;
        controller.enqueue(new Uint8Array(256 * 1024));
      },
    });
    const request = new Request("https://app.example/hook", { method: "POST", body, duplex: "half" } as RequestInit);
    const result = await websub.receive(request);
    expect(result.response.status).toBe(413);
    // 1 MiB is four chunks: the reader gives up right after, it does not drain the stream.
    expect(pulled).toBeLessThan(10);
  });

  it("names a refusal by the hub for what it is", async () => {
    const { fetch } = mockFetch(new Response("Invalid callback", { status: 400 }));
    await expect(websub.subscribe({ channelId: CHANNEL_ID, callbackUrl: "nope", fetch })).rejects.toMatchObject({ code: "HUB_ERROR" });
  });

  it("times out oEmbed even when a signal is passed", async () => {
    const hanging = ((_: unknown, init: RequestInit) => new Promise((_resolve, reject) => init.signal?.addEventListener("abort", () => reject(new Error("aborted"))))) as typeof fetch;
    await expect(oEmbed(VIDEO_ID, { fetch: hanging, timeout: 20, signal: new AbortController().signal })).rejects.toMatchObject({ code: "TIMEOUT" });
  });
});

describe("uploads and formats", () => {
  it("drops the session from the error when the session is gone", async () => {
    const SESSION = "https://upload.example/session/gone";
    const { yt } = client((call) => (call.url.href === SESSION ? new Response(null, { status: 404 }) : new Response(null, { status: 200, headers: { location: SESSION } })), { accessToken: "t" });
    const error = (await yt.videos.insert({ body: {}, media: { body: new Uint8Array(6 * 1024 * 1024), mimeType: "video/mp4" } }).catch((e: unknown) => e)) as YouTubeUploadError;
    expect(error).toBeInstanceOf(YouTubeUploadError);
    expect(error.sessionUri).toBeUndefined();
  });

  it("reads the duration format of batchGetStats", () => {
    expect(parseDuration("212s")).toBe(212);
    expect(parseDuration("3.5s")).toBe(3.5);
  });

  it("retries nothing it should not after a 4xx on a raw download", async () => {
    const { yt, calls } = client(apiError(403, "forbidden"), { accessToken: "t" });
    await expect(yt.reporting.download("https://youtubereporting.googleapis.com/v1/media/x?alt=media")).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(calls).toHaveLength(1);
    expect(yt.quota.usage.reporting).toBe(1);
  });
});

describe("watcher and unknown channels", () => {
  it("looks up a handle that matches nothing once, not every round", async () => {
    const { yt, calls } = client((call) => (call.url.hostname === "www.youtube.com" ? new Response("x", { status: 404 }) : list([])));
    const watcher = yt.watch("@nobody-at-all");
    const errors: unknown[] = [];
    watcher.on("error", (event) => errors.push(event.error));
    await watcher.check();
    const lookups = calls.length;
    await watcher.check();
    await watcher.check();
    expect(calls).toHaveLength(lookups);
    expect(errors).toHaveLength(1);
  });
});
