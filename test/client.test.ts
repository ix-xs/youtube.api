import { afterEach, describe, expect, it, vi } from "vitest";
import { METHODS, YouTube, YouTubeApiError, YouTubeAuthError, YouTubeRequestError, isYouTubeError, quotaCost } from "../src/index.js";
import { VIDEO_ID, apiError, client, json, list, mockFetch } from "./helpers.js";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("request building", () => {
  it("sends the key as a header, never in the URL", async () => {
    const { yt, calls } = client(list([]));
    await yt.videos.list({ part: "snippet", id: VIDEO_ID });
    expect(calls[0]!.headers.get("x-goog-api-key")).toBe("test-key");
    expect(calls[0]!.url.search).not.toContain("test-key");
    expect(calls[0]!.url.origin + calls[0]!.url.pathname).toBe("https://youtube.googleapis.com/youtube/v3/videos");
  });

  it("joins lists with commas and serializes booleans, numbers and dates", async () => {
    const { yt, calls } = client(list([]));
    await yt.search.list({
      part: "snippet",
      q: "cats & dogs",
      type: ["video", "channel"],
      maxResults: 25,
      forMine: false,
      publishedAfter: new Date("2026-01-02T03:04:05Z"),
    });
    const params = calls[0]!.url.searchParams;
    expect(params.get("type")).toBe("video,channel");
    expect(params.get("q")).toBe("cats & dogs");
    expect(params.get("maxResults")).toBe("25");
    expect(params.get("forMine")).toBe("false");
    expect(params.get("publishedAfter")).toBe("2026-01-02T03:04:05.000Z");
  });

  it("leaves undefined parameters out", async () => {
    const { yt, calls } = client(list([]));
    await yt.videos.list({ part: ["snippet", "statistics"], id: VIDEO_ID, hl: undefined });
    expect([...calls[0]!.url.searchParams.keys()].sort()).toEqual(["id", "part"]);
    expect(calls[0]!.url.searchParams.get("part")).toBe("snippet,statistics");
  });

  it("passes `fields`, `quotaUser` and extra headers", async () => {
    const { yt, calls } = client(list([]), { quotaUser: "user-1", headers: { "x-app": "demo" } });
    await yt.videos.list({ part: "id", id: VIDEO_ID }, { fields: "items(id)", headers: { "x-call": "1" } });
    expect(calls[0]!.url.searchParams.get("fields")).toBe("items(id)");
    expect(calls[0]!.url.searchParams.get("quotaUser")).toBe("user-1");
    expect(calls[0]!.headers.get("x-app")).toBe("demo");
    expect(calls[0]!.headers.get("x-call")).toBe("1");
  });

  it("sends a JSON body on writes and fills `part` from it", async () => {
    const { yt, calls } = client({ id: "PL1" }, { accessToken: "token" });
    await yt.playlists.insert({ body: { snippet: { title: "Mix" }, status: { privacyStatus: "private" } } });
    expect(calls[0]!.method).toBe("POST");
    expect(calls[0]!.url.searchParams.get("part")).toBe("snippet,status");
    expect(calls[0]!.body).toEqual({ snippet: { title: "Mix" }, status: { privacyStatus: "private" } });
    expect(calls[0]!.headers.get("content-type")).toBe("application/json");
  });

  it("keeps an explicit `part` on writes and never invents one for bodies that are not resources", async () => {
    const { yt, calls } = client([{ id: "x" }, new Response(null, { status: 204 })], { accessToken: "token" });
    await yt.videos.update({ part: "status", body: { id: VIDEO_ID, snippet: { title: "t" }, status: { privacyStatus: "public" } } });
    expect(calls[0]!.url.searchParams.get("part")).toBe("status");
    await yt.videos.reportAbuse({ body: { videoId: VIDEO_ID, reasonId: "S" } });
    expect(calls[1]!.url.searchParams.has("part")).toBe(false);
  });

  it("resolves to undefined for methods without a response body", async () => {
    const { yt, calls } = client(new Response(null, { status: 204 }), { accessToken: "token" });
    await expect(yt.videos.rate({ id: VIDEO_ID, rating: "like" })).resolves.toBeUndefined();
    expect(calls[0]!.url.pathname).toBe("/youtube/v3/videos/rate");
  });

  it("fills path parameters of the Reporting API", async () => {
    const { yt, calls } = client({ id: "r1" }, { accessToken: "token" });
    await yt.reporting.reports.get({ jobId: "job/1", reportId: "r1" });
    expect(calls[0]!.url.href).toBe("https://youtubereporting.googleapis.com/v1/jobs/job%2F1/reports/r1");
  });

  it("honours a custom base URL", async () => {
    const { yt, calls } = client(list([]), { baseUrl: "https://proxy.example/yt" });
    await yt.videos.list({ part: "id", id: VIDEO_ID });
    expect(calls[0]!.url.href.startsWith("https://proxy.example/yt/youtube/v3/videos?")).toBe(true);
  });

  it("returns text for caption downloads", async () => {
    const { yt } = client(new Response("WEBVTT\n"), { accessToken: "token" });
    await expect(yt.captions.download({ id: "cap", tfmt: "vtt" })).resolves.toBe("WEBVTT\n");
  });
});

describe("credentials", () => {
  it("accepts an API key as the only argument", async () => {
    const { fetch, calls } = mockFetch(list([]));
    const yt = new YouTube("plain-key");
    // The shorthand has no room for a custom fetch, so go through `as` to check the key.
    const stub = vi.spyOn(globalThis, "fetch").mockImplementation(fetch);
    await yt.videos.list({ part: "id", id: VIDEO_ID });
    expect(calls[0]!.headers.get("x-goog-api-key")).toBe("plain-key");
    stub.mockRestore();
  });

  it("falls back on YOUTUBE_API_KEY", async () => {
    vi.stubEnv("YOUTUBE_API_KEY", "env-key");
    const { fetch, calls } = mockFetch(list([]));
    await new YouTube({ fetch }).videos.list({ part: "id", id: VIDEO_ID });
    expect(calls[0]!.headers.get("x-goog-api-key")).toBe("env-key");
  });

  it("fails before sending when there are no credentials", async () => {
    vi.stubEnv("YOUTUBE_API_KEY", "");
    const { fetch, calls } = mockFetch(list([]));
    const error = await new YouTube({ fetch }).videos.list({ part: "id", id: VIDEO_ID }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(YouTubeAuthError);
    expect((error as YouTubeAuthError).code).toBe("MISSING_CREDENTIALS");
    expect(calls).toHaveLength(0);
  });

  it("refuses a write with only an API key, without spending quota", async () => {
    const { yt, calls } = client(list([]));
    const error = await yt.videos.rate({ id: VIDEO_ID, rating: "like" }).catch((e: unknown) => e);
    expect(isYouTubeError(error, "MISSING_CREDENTIALS")).toBe(true);
    expect((error as YouTubeAuthError).scopes).toContain("youtube.force-ssl");
    expect((error as Error).message).toContain("videos.rate");
    expect(calls).toHaveLength(0);
    expect(yt.quota.used).toBe(0);
  });

  it("refuses user-specific reads with only an API key", async () => {
    const { yt, calls } = client(list([]));
    await expect(yt.channels.list({ part: "id", mine: true })).rejects.toMatchObject({ code: "MISSING_CREDENTIALS" });
    await expect(yt.captions.list({ part: "snippet", videoId: VIDEO_ID })).rejects.toMatchObject({ code: "MISSING_CREDENTIALS" });
    await expect(yt.analytics.query({ startDate: "2026-01-01", endDate: "2026-01-02", metrics: "views" })).rejects.toMatchObject({ code: "MISSING_CREDENTIALS" });
    expect(calls).toHaveLength(0);
  });

  it("prefers a token over the key when both are set", async () => {
    const { yt, calls } = client(list([]), { accessToken: () => "from-function" });
    await yt.videos.list({ part: "id", id: VIDEO_ID });
    expect(calls[0]!.headers.get("authorization")).toBe("Bearer from-function");
    expect(calls[0]!.headers.has("x-goog-api-key")).toBe(false);
  });

  it("uses a per-call access token", async () => {
    const { yt, calls } = client(list([]));
    await yt.channels.list({ part: "id", mine: true }, { accessToken: "one-off" });
    expect(calls[0]!.headers.get("authorization")).toBe("Bearer one-off");
  });

  it("derives a client for another user that shares the quota count", async () => {
    const { yt, calls } = client(list([]));
    const user = yt.as("user-token");
    await user.channels.list({ part: "id", mine: true });
    await yt.videos.list({ part: "id", id: VIDEO_ID });
    expect(calls[0]!.headers.get("authorization")).toBe("Bearer user-token");
    expect(calls[1]!.headers.get("x-goog-api-key")).toBe("test-key");
    expect(yt.quota.used).toBe(2);
    expect(user.quota).toBe(yt.quota);
  });
});

describe("errors", () => {
  it("maps an API error body", async () => {
    const { yt } = client(apiError(404, "videoNotFound", "The video cannot be found."), { accessToken: "t" });
    const error = (await yt.videos.rate({ id: VIDEO_ID, rating: "like" }).catch((e: unknown) => e)) as YouTubeApiError;
    expect(error).toBeInstanceOf(YouTubeApiError);
    expect(error).toMatchObject({ code: "NOT_FOUND", status: 404, reason: "videoNotFound", method: "videos.rate", isNotFound: true });
    expect(error.message).toBe("videos.rate: The video cannot be found.");
    expect(error.errors[0]).toMatchObject({ domain: "youtube", reason: "videoNotFound" });
  });

  it("recognises quota exhaustion and does not retry it", async () => {
    const { yt, calls } = client(apiError(403, "quotaExceeded"));
    const error = (await yt.videos.list({ part: "id", id: VIDEO_ID }).catch((e: unknown) => e)) as YouTubeApiError;
    expect(error.code).toBe("QUOTA_EXCEEDED");
    expect(error.isQuotaExceeded).toBe(true);
    expect(calls).toHaveLength(1);
  });

  it("reads the reason of an invalid key from the error details", async () => {
    const body = {
      error: {
        code: 400,
        message: "API key not valid. Please pass a valid API key.",
        errors: [{ message: "API key not valid.", domain: "global", reason: "badRequest" }],
        status: "INVALID_ARGUMENT",
        details: [{ "@type": "type.googleapis.com/google.rpc.ErrorInfo", reason: "API_KEY_INVALID", domain: "googleapis.com" }],
      },
    };
    const { yt } = client(json(body, 400));
    await expect(yt.videos.list({ part: "id", id: VIDEO_ID })).rejects.toMatchObject({ reason: "keyInvalid", apiStatus: "INVALID_ARGUMENT", status: 400 });
  });

  it("survives an error that is not JSON", async () => {
    const { yt } = client(new Response("<html>Bad gateway</html>", { status: 502, statusText: "Bad Gateway" }), { retry: false });
    await expect(yt.videos.list({ part: "id", id: VIDEO_ID })).rejects.toMatchObject({ code: "SERVER_ERROR", status: 502 });
  });

  it("retries rate limits and server errors, then succeeds", async () => {
    const { yt, calls } = client([apiError(403, "rateLimitExceeded"), apiError(503, "backendError"), list([{ id: VIDEO_ID }])]);
    const retries: number[] = [];
    yt.on("retry", (event) => retries.push(event.attempt));
    const page = await yt.videos.list({ part: "id", id: VIDEO_ID });
    expect(page.items).toHaveLength(1);
    expect(calls).toHaveLength(3);
    expect(retries).toEqual([1, 2]);
  });

  it("gives up after the configured number of retries", async () => {
    const { yt, calls } = client(apiError(500, "internalError"), { retry: { attempts: 2, delay: 1 } });
    await expect(yt.videos.list({ part: "id", id: VIDEO_ID })).rejects.toMatchObject({ code: "SERVER_ERROR" });
    expect(calls).toHaveLength(3);
  });

  it("does not replay a write on a plain 500", async () => {
    const { yt, calls } = client(apiError(500, "internalError"), { accessToken: "t" });
    await expect(yt.playlists.insert({ body: { snippet: { title: "x" } } })).rejects.toMatchObject({ status: 500 });
    expect(calls).toHaveLength(1);
  });

  it("waits for Retry-After", async () => {
    const { yt } = client([apiError(429, "rateLimitExceeded", "slow down", { "retry-after": "0.05" }), list([])]);
    const delays: number[] = [];
    yt.on("retry", (event) => delays.push(event.delay));
    await yt.videos.list({ part: "id", id: VIDEO_ID });
    expect(delays).toEqual([50]);
  });

  it("times out", async () => {
    const { yt } = client(
      (call) =>
        new Promise<Response>((_, reject) => {
          call.init.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
        }),
      { timeout: 20, retry: false },
    );
    const error = await yt.videos.list({ part: "id", id: VIDEO_ID }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(YouTubeRequestError);
    expect((error as YouTubeRequestError).code).toBe("TIMEOUT");
  });

  it("reports an abort as such", async () => {
    const controller = new AbortController();
    const { yt } = client((call) => new Promise<Response>((_, reject) => call.init.signal?.addEventListener("abort", () => reject(new Error("aborted")))));
    const pending = yt.videos.list({ part: "id", id: VIDEO_ID }, { signal: controller.signal }).page();
    setTimeout(() => controller.abort(), 5);
    await expect(pending).rejects.toMatchObject({ code: "ABORTED" });
  });

  it("wraps and retries network failures", async () => {
    let attempts = 0;
    const { yt } = client(() => {
      if (attempts++ === 0) throw new TypeError("fetch failed");
      return list([]);
    });
    await expect(yt.videos.list({ part: "id", id: VIDEO_ID })).resolves.toBeDefined();
    expect(attempts).toBe(2);
  });

  it("rejects invalid JSON with PARSE_ERROR", async () => {
    const { yt } = client(new Response("{oops"));
    await expect(yt.videos.list({ part: "id", id: VIDEO_ID })).rejects.toMatchObject({ code: "PARSE_ERROR" });
  });
});

describe("events and misc", () => {
  it("emits request and response events without leaking the key", async () => {
    const { yt } = client(list([]));
    const seen: string[] = [];
    yt.on("request", (event) => seen.push(`request ${event.method} ${event.url}`));
    yt.on("response", (event) => seen.push(`response ${event.method} ${event.status} ${event.cost}`));
    await yt.videos.list({ part: "id", id: VIDEO_ID });
    expect(seen).toEqual([`request videos.list https://youtube.googleapis.com/youtube/v3/videos?part=id&id=${VIDEO_ID}`, "response videos.list 200 1"]);
  });

  it("calls a method by name", async () => {
    const { yt, calls } = client(list([]));
    await yt.request("videoCategories.list", { part: "snippet", regionCode: "FR" });
    expect(calls[0]!.url.pathname).toBe("/youtube/v3/videoCategories");
  });

  it("knows what methods cost", () => {
    expect(quotaCost("videos.list")).toEqual({ cost: 1, bucket: "default" });
    expect(quotaCost("captions.insert")).toEqual({ cost: 400, bucket: "default" });
    expect(quotaCost("search.list")).toEqual({ cost: 1, bucket: "search.list" });
  });

  it("exposes every method of the table on the client", () => {
    const yt = new YouTube("key") as unknown as Record<string, Record<string, unknown>>;
    const handwritten = new Set(["liveChatMessages.stream", "analytics.reports.query", "reporting.media.download"]);
    for (const id of Object.keys(METHODS)) {
      if (handwritten.has(id)) continue;
      const path = id.replace("reporting.jobs.reports.", "reporting.reports.").split(".");
      const method = path.pop()!;
      const resource = path.reduce<Record<string, unknown>>((node, key) => node[key] as Record<string, unknown>, yt);
      expect(typeof resource?.[method], id).toBe("function");
    }
    expect(Object.keys(METHODS).length).toBeGreaterThanOrEqual(98);
  });
});
