// One test per defect found after the first pass, so none of them comes back.

import { describe, expect, it } from "vitest";
import { type CacheStore, OAuth2, Watcher, YouTube, YouTubeAuthError, parseUrl, videoIdFrom, websub } from "../src/index.js";
import { parseXml } from "../src/utils/xml.js";
import { CHANNEL_ID, VIDEO_ID, apiError, client, json, list, mockFetch } from "./helpers.js";

describe("cache", () => {
  it("keeps two users apart even when their tokens end the same way", async () => {
    const tail = ".".repeat(20);
    const { yt, calls } = client((call) => list([{ id: call.headers.get("authorization") }]), { cache: true });
    const a = await yt.as(`ya29.userA${tail}`).channels.list({ part: "id", mine: true });
    const b = await yt.as(`ya29.userB${tail}`).channels.list({ part: "id", mine: true });
    expect(calls).toHaveLength(2);
    expect(a.items[0]?.id).toBe(`Bearer ya29.userA${tail}`);
    expect(b.items[0]?.id).toBe(`Bearer ya29.userB${tail}`);
  });

  it("never hands any part of a token to the cache store", async () => {
    const keys: string[] = [];
    const store: CacheStore = {
      get: (key) => void keys.push(key),
      set: (key) => void keys.push(key),
      delete: () => {},
    };
    const { yt } = client(list([]), { cache: { store }, accessToken: "ya29.very-secret-token" });
    await yt.channels.list({ part: "id", mine: true });
    expect(keys.length).toBeGreaterThan(0);
    expect(keys.some((key) => key.includes("secret") || key.includes("ya29"))).toBe(false);
  });

  it("serves a cached read even when the budget is spent", async () => {
    const { yt, calls } = client(() => list([{ id: VIDEO_ID }]), { cache: true, quota: { enforce: true, limits: { default: 1 } } });
    await yt.videos.list({ part: "id", id: VIDEO_ID });
    await expect(yt.videos.list({ part: "id", id: VIDEO_ID })).resolves.toBeDefined();
    expect(calls).toHaveLength(1);
  });

  it("survives a store that throws, without retrying or double charging", async () => {
    const store: CacheStore = {
      get: () => {
        throw new Error("redis is down");
      },
      set: () => {
        throw new Error("redis is down");
      },
      delete: () => {},
    };
    const { yt, calls } = client(() => list([{ id: VIDEO_ID }]), { cache: { store } });
    const errors: unknown[] = [];
    yt.on("error", (error) => errors.push(error));
    const page = await yt.videos.list({ part: "id", id: VIDEO_ID });
    expect(page.items).toHaveLength(1);
    expect(calls).toHaveLength(1);
    expect(yt.quota.used).toBe(1);
    expect(errors).toHaveLength(2);
  });

  it("asks again when a 304 arrives for an entry that is gone", async () => {
    let stored: unknown;
    const store: CacheStore = {
      // Stale on the first read, gone on the second.
      get: () => {
        const entry = stored as { value: unknown; etag: string; expires: number } | undefined;
        stored = undefined;
        return entry;
      },
      set: () => {},
      delete: () => {},
    };
    stored = { value: list([]), etag: '"v1"', expires: 0 };
    const { yt, calls } = client((call) => (call.headers.has("if-none-match") ? new Response(null, { status: 304 }) : list([{ id: VIDEO_ID }])), { cache: { store } });
    const page = await yt.videos.list({ part: "id", id: VIDEO_ID });
    expect(page.items).toHaveLength(1);
    expect(calls).toHaveLength(2);
  });
});

describe("quota budget", () => {
  it("holds for calls fired in parallel", async () => {
    const { yt, calls } = client(
      async () => {
        await new Promise((resolve) => setTimeout(resolve, 5));
        return list([]);
      },
      { quota: { enforce: true, limits: { default: 2 } } },
    );
    const results = await Promise.allSettled(["a", "b", "c", "d", "e"].map((letter) => yt.videos.list({ part: "id", id: letter.repeat(11) }).page()));
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(2);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(3);
    expect(calls).toHaveLength(2);
    expect(yt.quota.used).toBe(2);
  });

  it("gives the reservation back when a call fails", async () => {
    const { yt } = client([apiError(500, "internalError"), list([])], { retry: false, quota: { enforce: true, limits: { default: 1 } } });
    await expect(yt.videos.list({ part: "id", id: VIDEO_ID })).rejects.toBeDefined();
    await expect(yt.videos.list({ part: "id", id: VIDEO_ID })).resolves.toBeDefined();
  });
});

describe("request pipeline", () => {
  it("does not replay a write on a 503", async () => {
    const { yt, calls } = client(apiError(503, "backendError"), { accessToken: "t" });
    await expect(yt.commentThreads.post(VIDEO_ID, "once")).rejects.toMatchObject({ status: 503 });
    expect(calls).toHaveLength(1);
  });

  it("replays a write that was rate limited", async () => {
    const { yt, calls } = client([apiError(403, "rateLimitExceeded"), json({ id: "c1" })], { accessToken: "t" });
    await expect(yt.commentThreads.post(VIDEO_ID, "once")).resolves.toMatchObject({ id: "c1" });
    expect(calls).toHaveLength(2);
  });

  it("falls back on the API key while an OAuth client has no usable token", async () => {
    const { fetch, calls } = mockFetch(() => list([]));
    const yt = new YouTube({ apiKey: "key", oauth: { clientId: "client" }, fetch });
    await yt.videos.list({ part: "id", id: VIDEO_ID });
    expect(calls[0]!.headers.get("x-goog-api-key")).toBe("key");
    await expect(yt.channels.list({ part: "id", mine: true })).rejects.toMatchObject({ code: "MISSING_CREDENTIALS" });

    const expired = new YouTube({ apiKey: "key", oauth: { clientId: "client", tokens: { accessToken: "old", expiresAt: 1 } }, fetch });
    await expired.videos.list({ part: "id", id: VIDEO_ID });
    expect(calls[1]!.headers.get("x-goog-api-key")).toBe("key");
  });

  it("calls a custom fetch as a plain function", async () => {
    const seen: unknown[] = [];
    function strictFetch(this: unknown) {
      seen.push(this);
      return Promise.resolve(json(list([])));
    }
    const yt = new YouTube({ apiKey: "key", fetch: strictFetch as unknown as typeof fetch });
    await yt.videos.list({ part: "id", id: VIDEO_ID });
    const oauth = new OAuth2({ clientId: "client", fetch: strictFetch as unknown as typeof fetch, tokens: { refreshToken: "r" } });
    await oauth.refresh().catch(() => {});
    expect(seen).toEqual([undefined, undefined]);
  });
});

describe("pagination", () => {
  it("stops pages() at the limit", async () => {
    const { yt, calls } = client(() => list([{ id: "a" }, { id: "b" }], { nextPageToken: "more" }));
    const pages = [];
    for await (const page of yt.playlistItems.list({ part: "id", playlistId: "PL1" }).pages({ limit: 3 })) pages.push(page);
    expect(pages).toHaveLength(2);
    expect(calls).toHaveLength(2);
  });
});

describe("OAuth", () => {
  it("writes whole error messages", async () => {
    const { fetch } = mockFetch(json({ error: "invalid_client", error_description: "Bad Request" }, 400), json({ error: "invalid_client", error_description: "Unauthorized." }, 401));
    const oauth = new OAuth2({ clientId: "client", fetch, tokens: { refreshToken: "r" } });
    await expect(oauth.refresh()).rejects.toThrow("Could not refresh the access token: Bad Request.");
    await expect(oauth.refresh()).rejects.toThrow("Could not refresh the access token: Unauthorized.");
  });

  it("turns a failing onTokens into an error of the call, not an unhandled rejection", async () => {
    const { fetch } = mockFetch(json({ access_token: "a", expires_in: 3600 }));
    const oauth = new OAuth2({
      clientId: "client",
      fetch,
      tokens: { refreshToken: "r" },
      onTokens: async () => {
        throw new Error("disk full");
      },
    });
    const error = await oauth.refresh().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(YouTubeAuthError);
    expect((error as Error).message).toContain("disk full");
  });

  it("does not mix a refresh in flight with tokens set meanwhile", async () => {
    let release: () => void = () => {};
    const { fetch } = mockFetch(async () => {
      await new Promise<void>((resolve) => (release = resolve));
      return json({ access_token: "for-alice", expires_in: 3600 });
    });
    const oauth = new OAuth2({ clientId: "client", fetch, tokens: { refreshToken: "alice-refresh" } });
    const pending = oauth.refresh();
    await new Promise((resolve) => setTimeout(resolve, 1));
    oauth.setTokens({ accessToken: "for-bob", refreshToken: "bob-refresh", expiresAt: Date.now() + 3_600_000 });
    release();
    await pending;
    expect(oauth.tokens).toMatchObject({ accessToken: "for-bob", refreshToken: "bob-refresh" });
  });
});

describe("uploads", () => {
  it("refuses to continue when the server steps back behind bytes it confirmed", async () => {
    const SESSION = "https://upload.example/session/9";
    let puts = 0;
    const { yt } = client(
      (call) => {
        if (call.url.href !== SESSION) return new Response(null, { status: 200, headers: { location: SESSION } });
        puts++;
        // The first chunk is confirmed, then the server forgets everything.
        return new Response(null, { status: 308, headers: puts === 1 ? { range: `bytes=0-${256 * 1024 - 1}` } : {} });
      },
      { accessToken: "t" },
    );
    async function* source() {
      for (let index = 0; index < 4; index++) yield new Uint8Array(256 * 1024);
    }
    await expect(yt.videos.insert({ body: {}, media: { body: source(), mimeType: "video/mp4", chunkSize: 256 * 1024 } })).rejects.toMatchObject({ code: "UPLOAD_FAILED" });
    expect(puts).toBe(2);
  });

  it("reads a stream to its end even when a smaller size was declared", async () => {
    let received = 0;
    const SESSION = "https://upload.example/session/10";
    const { yt } = client(
      (call) => {
        if (call.url.href !== SESSION) return new Response(null, { status: 200, headers: { location: SESSION } });
        const range = /^bytes (\d+)-(\d+)\/(\d+|\*)$/.exec(call.headers.get("content-range")!)!;
        received = Number(range[2]) + 1;
        return range[3] === "*" ? new Response(null, { status: 308, headers: { range: `bytes=0-${received - 1}` } }) : json({ id: VIDEO_ID });
      },
      { accessToken: "t" },
    );
    async function* source() {
      yield new Uint8Array(300 * 1024);
    }
    await yt.videos.insert({ body: {}, media: { body: source(), mimeType: "video/mp4", size: 1024, chunkSize: 256 * 1024 } });
    expect(received).toBe(300 * 1024);
  });
});

describe("live chat and watcher with a cache", () => {
  it("never replays cached chat pages", async () => {
    let served = 0;
    const message = (id: string) => ({ id, snippet: { type: "textMessageEvent", displayMessage: id }, authorDetails: {} });
    const { yt, calls } = client(() => list([message(`m${served++}`)], { nextPageToken: "T", pollingIntervalMillis: 1, ...(served % 2 === 0 ? { offlineAt: "now" } : {}) }), { cache: true });
    const first: string[] = [];
    for await (const chatMessage of yt.liveChat("chat1").messages({ history: true })) first.push(chatMessage.id);
    const second: string[] = [];
    for await (const chatMessage of yt.liveChat("chat1").messages({ history: true })) second.push(chatMessage.id);
    expect(first).toEqual(["m0", "m1"]);
    expect(second).toEqual(["m2", "m3"]);
    expect(calls).toHaveLength(4);
  });

  it("keeps the other channels on the free feed when one feed fails", async () => {
    const good = ["UCaaaaaaaaaaaaaaaaaaaaaa", "UCbbbbbbbbbbbbbbbbbbbbbb"];
    const feed = `<feed xmlns="http://www.w3.org/2005/Atom"><title>t</title></feed>`;
    const { yt, calls } = client((call) => {
      if (call.url.hostname !== "www.youtube.com") return list([]);
      return call.url.searchParams.get("channel_id") === CHANNEL_ID ? new Response("gone", { status: 404 }) : new Response(feed);
    });
    const watcher = yt.watch([CHANNEL_ID, ...good]);
    await watcher.check();
    await watcher.check();
    const feedCalls = calls.filter((call) => call.url.hostname === "www.youtube.com").map((call) => call.url.searchParams.get("channel_id"));
    const apiCalls = calls.filter((call) => call.url.hostname !== "www.youtube.com");
    // Round one: three feeds. Round two: the two that work.
    expect(feedCalls.sort()).toEqual([CHANNEL_ID, ...good, ...good].sort());
    expect(apiCalls).toHaveLength(2);
    expect(watcher).toBeInstanceOf(Watcher);
  });
});

describe("hostile input", () => {
  it("parses XML in linear time", () => {
    for (const input of ["<!--".repeat(50_000), "<a ".repeat(50_000), "<a>".repeat(50_000), `<a ${"b".repeat(200_000)}>`, "<![CDATA[".repeat(50_000), "&".repeat(200_000)]) {
      const started = performance.now();
      expect(() => parseXml(input)).not.toThrow();
      expect(performance.now() - started).toBeLessThan(500);
    }
  });

  it("ignores character references that are not characters", () => {
    expect(parseXml("<a>&#x110000;&#0;&#xD800;&#65;</a>").children[0]?.text).toBe("&#x110000;&#0;&#xD800;A");
    expect(websub.parse("<feed><entry><yt:videoId>aaaaaaaaaaa</yt:videoId><title>&#x110000;</title></entry></feed>")).toHaveLength(1);
  });

  it("refuses oversized WebSub bodies", async () => {
    const result = await websub.receive(new Request("https://app.example/hook", { method: "POST", body: "x".repeat(1024 * 1024 + 1) }));
    expect(result.response.status).toBe(413);
    expect(result.notifications).toEqual([]);
  });

  it("treats a URL with a broken escape as not a YouTube link", () => {
    expect(parseUrl("https://youtu.be/%zz")).toBeNull();
    expect(videoIdFrom("https://www.youtube.com/shorts/%E0%A4%A")).toBeNull();
  });

  it("only sends the token to the Reporting host over HTTPS", () => {
    const { yt } = client(list([]), { accessToken: "t" });
    expect(() => yt.reporting.downloadResponse("http://youtubereporting.googleapis.com/v1/media/x?alt=media")).toThrow(/Refusing/);
  });
});

describe("analytics dates", () => {
  it("sends the day shown on the caller's calendar", async () => {
    const { yt, calls } = client({ columnHeaders: [] }, { accessToken: "t" });
    await yt.analytics.query({ startDate: new Date(2026, 0, 1), endDate: new Date(2026, 0, 31, 23, 59), metrics: "views" });
    expect(calls[0]!.url.searchParams.get("startDate")).toBe("2026-01-01");
    expect(calls[0]!.url.searchParams.get("endDate")).toBe("2026-01-31");
  });
});
