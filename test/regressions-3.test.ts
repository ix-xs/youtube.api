// Defects found when the documentation was read back against the code.
// One test each, so none of them comes back.

import { describe, expect, it } from "vitest";
import { OAuth2, YouTubeArgumentError, YouTubeAuthError, YouTubeUploadError, oEmbed } from "../src/index.js";
import { retryAfterSeconds } from "../src/core/rest.js";
import { type Call, VIDEO_ID, apiError, client, json, mockFetch } from "./helpers.js";

const MIB = 1024 * 1024;
const SESSION = "https://upload.example/session/3";
const isProbe = (call: Call) => /^bytes \*\//.test(call.headers.get("content-range") ?? "");
const opened = () => new Response(null, { status: 200, headers: { location: SESSION } });

describe("oauth", () => {
  it("wraps a failing token store on revoke, after telling the listeners", async () => {
    const { fetch } = mockFetch(new Response("{}"));
    const oauth = new OAuth2({
      clientId: "client",
      fetch,
      tokens: { accessToken: "a", refreshToken: "r" },
      onTokens: () => {
        throw new Error("disk full");
      },
    });
    const heard: unknown[] = [];
    oauth.onTokens((tokens) => heard.push(tokens));
    const error = await oauth.revoke().catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(YouTubeAuthError);
    expect(error).toMatchObject({ code: "OAUTH_ERROR", message: expect.stringContaining("disk full") });
    expect(heard).toEqual([{}]);
    expect(oauth.tokens).toEqual({});
  });

  it("hands the signal of a device wait to the token request", async () => {
    const controller = new AbortController();
    const signals: unknown[] = [];
    const fetch = ((_input: unknown, init: RequestInit = {}) => {
      signals.push(init.signal);
      // The request is out when the caller gives up.
      controller.abort();
      return Promise.reject(new DOMException("Aborted", "AbortError"));
    }) as unknown as typeof globalThis.fetch;
    const oauth = new OAuth2({ clientId: "client", fetch });
    const waiting = oauth.pollDeviceToken({ deviceCode: "d", userCode: "u", verificationUrl: "v", expiresIn: 600, interval: 0 }, { signal: controller.signal });
    await expect(waiting).rejects.toMatchObject({ code: "ABORTED" });
    expect(signals).toEqual([controller.signal]);
  });
});

describe("uploads", () => {
  it("counts an overloaded status probe as one more failed attempt", async () => {
    let chunks = 0;
    let probes = 0;
    const { yt } = client(
      (call) => {
        if (call.url.href !== SESSION) return opened();
        if (isProbe(call)) return ++probes === 1 ? apiError(503, "backendError") : new Response(null, { status: 308 });
        return ++chunks === 1 ? apiError(503, "backendError") : json({ id: VIDEO_ID, kind: "youtube#video", etag: "e" });
      },
      { accessToken: "token", retry: { attempts: 3, delay: 1 } },
    );
    const video = await yt.videos.insert({ body: {}, media: { body: new Uint8Array(6 * MIB), mimeType: "video/mp4" } });
    expect(video.id).toBe(VIDEO_ID);
    expect(probes).toBe(1);
    expect(chunks).toBe(2);
  });

  it("gives no session back when the server lost bytes it had confirmed", async () => {
    let chunks = 0;
    const { yt } = client(
      (call) => {
        if (call.url.href !== SESSION) return opened();
        // The first chunk is confirmed, then the server steps back behind it.
        return new Response(null, { status: 308, headers: ++chunks === 1 ? { range: `bytes=0-${2 * MIB - 1}` } : { range: "bytes=0-99" } });
      },
      { accessToken: "token" },
    );
    const error = (await yt.videos
      .insert({ body: {}, media: { body: new Uint8Array(6 * MIB), mimeType: "video/mp4", chunkSize: 2 * MIB } })
      .catch((caught: unknown) => caught)) as YouTubeUploadError;
    expect(error).toBeInstanceOf(YouTubeUploadError);
    expect(error.message).toMatch(/lost bytes/);
    expect(error.sessionUri).toBeUndefined();
  });

  it("says a resumed session is unavailable instead of reading a 503 as the result", async () => {
    const { yt } = client(apiError(503, "backendError"), { accessToken: "token" });
    const error = (await yt.videos
      .insert({ body: {}, media: { body: new Uint8Array(6 * MIB), mimeType: "video/mp4", resumeUri: SESSION } })
      .catch((caught: unknown) => caught)) as YouTubeUploadError;
    expect(error).toBeInstanceOf(YouTubeUploadError);
    expect(error.sessionUri).toBe(SESSION);
  });

  it("counts the unit a rejected upload still costs", async () => {
    const { yt } = client(apiError(403, "forbidden"), { accessToken: "token" });
    await expect(yt.thumbnails.set({ videoId: VIDEO_ID, media: new Blob([new Uint8Array(10)], { type: "image/png" }) })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(yt.quota.used).toBe(1);
  });
});

/** A response whose body sends `text`, then breaks. */
function breaking(text: string): Response {
  let sent = false;
  return new Response(
    new ReadableStream<Uint8Array>({
      pull(controller) {
        if (sent) return controller.error(new TypeError("terminated"));
        sent = true;
        controller.enqueue(new TextEncoder().encode(text));
      },
    }),
  );
}

describe("bodies that break and answers that are not what they should be", () => {
  it("wraps a report download that drops half way", async () => {
    const { yt } = client(() => breaking("date,views"), { accessToken: "token" });
    await expect(yt.reporting.download("https://youtubereporting.googleapis.com/v1/media/x?alt=media")).rejects.toMatchObject({ name: "YouTubeRequestError", code: "NETWORK" });
  });

  it("refuses a report address that is not one, without a native error", async () => {
    const { yt, calls } = client({}, { accessToken: "token" });
    await expect(yt.reporting.download("not a url")).rejects.toBeInstanceOf(YouTubeArgumentError);
    await expect(yt.reporting.download("https://youtubereporting.googleapis.com:8443/v1/media/x")).rejects.toBeInstanceOf(YouTubeArgumentError);
    expect(calls).toHaveLength(0);
  });

  it("says so when oEmbed answers something that is not JSON", async () => {
    const { fetch } = mockFetch(() => new Response("<html>busy</html>"));
    await expect(oEmbed(VIDEO_ID, { fetch })).rejects.toMatchObject({ code: "PARSE_ERROR" });
  });

  it("reopens a chat stream that drops, from the last token", async () => {
    const message = (id: string) => ({ id, snippet: { type: "textMessageEvent", displayMessage: id }, authorDetails: { displayName: "Jo" } });
    const { yt, calls } = client(
      [
        () => breaking(JSON.stringify({ nextPageToken: "t1", items: [message("old")] })),
        () => new Response(JSON.stringify({ nextPageToken: "t2", items: [message("new")], offlineAt: "2026-01-01T00:00:00Z" })),
      ],
      { accessToken: "token" },
    );
    const seen: string[] = [];
    for await (const item of yt.liveChat("chat1").messages({ mode: "stream", history: true })) seen.push(item.id);
    expect(seen).toEqual(["old", "new"]);
    expect(calls.map((call) => call.url.searchParams.get("pageToken"))).toEqual([null, "t1"]);
  });

  it("gives up on a chat stream that keeps dropping", async () => {
    const { yt, calls } = client(() => breaking(""), { accessToken: "token" });
    const reading = (async () => {
      for await (const _ of yt.liveChat("chat1").messages({ mode: "stream" })) void _;
    })();
    await expect(reading).rejects.toMatchObject({ code: "NETWORK" });
    expect(calls).toHaveLength(4);
  }, 15_000);
});

describe("watcher", () => {
  it("reports a reference that cannot name a channel once, not every round", async () => {
    const { yt, calls } = client({});
    const watcher = yt.watch("https://www.youtube.com/watch?v=dQw4w9WgXcQ");
    const errors: unknown[] = [];
    watcher.on("error", (event) => errors.push(event.error));
    await watcher.check();
    await watcher.check();
    await watcher.check();
    expect(errors).toHaveLength(1);
    expect(calls).toHaveLength(0);
  });
});

describe("Retry-After", () => {
  it("reads a number of seconds and a date alike", () => {
    const now = Date.parse("2026-10-12T10:00:00Z");
    expect(retryAfterSeconds("30", now)).toBe(30);
    expect(retryAfterSeconds("Mon, 12 Oct 2026 10:00:45 GMT", now)).toBe(45);
    expect(retryAfterSeconds("Mon, 12 Oct 2026 09:00:00 GMT", now)).toBeUndefined();
    expect(retryAfterSeconds("soon", now)).toBeUndefined();
    expect(retryAfterSeconds(null, now)).toBeUndefined();
  });
});
