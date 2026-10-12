import { describe, expect, it } from "vitest";
import { MemoryCache, YouTubeQuotaBudgetError, nextQuotaReset } from "../src/index.js";
import { VIDEO_ID, apiError, client, json, list } from "./helpers.js";

const ids = (count: number, prefix = "v") => Array.from({ length: count }, (_, index) => `${prefix}${String(index).padStart(10, "0")}`);

describe("pagination", () => {
  it("awaits to a single page", async () => {
    const { yt, calls } = client(list([{ id: "a" }, { id: "b" }], { nextPageToken: "T2", pageInfo: { totalResults: 7, resultsPerPage: 2 } }));
    const page = await yt.playlistItems.list({ part: "id", playlistId: "PL1" });
    expect(page.items.map((item) => item.id)).toEqual(["a", "b"]);
    expect(page).toMatchObject({ nextPageToken: "T2", totalResults: 7, resultsPerPage: 2, hasNext: true });
    expect([...page].length).toBe(2);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url.searchParams.has("maxResults")).toBe(false);
  });

  it("walks every page with the largest page size", async () => {
    const { yt, calls } = client((call) => {
      const token = call.url.searchParams.get("pageToken");
      if (!token) return list([{ id: "a" }, { id: "b" }], { nextPageToken: "T2" });
      if (token === "T2") return list([{ id: "c" }], { nextPageToken: "T3" });
      return list([{ id: "d" }]);
    });
    const seen: string[] = [];
    for await (const item of yt.playlistItems.list({ part: "id", playlistId: "PL1" })) seen.push(item.id);
    expect(seen).toEqual(["a", "b", "c", "d"]);
    expect(calls.map((call) => call.url.searchParams.get("pageToken"))).toEqual([null, "T2", "T3"]);
    expect(calls.every((call) => call.url.searchParams.get("maxResults") === "50")).toBe(true);
    expect(yt.quota.used).toBe(3);
  });

  it("stops at the limit and sizes the page to it", async () => {
    const { yt, calls } = client(() => list([{ id: "a" }, { id: "b" }, { id: "c" }], { nextPageToken: "more" }));
    const items = await yt.playlistItems.list({ part: "id", playlistId: "PL1" }).all({ limit: 5 });
    expect(items).toHaveLength(5);
    expect(calls).toHaveLength(2);
    expect(calls[0]!.url.searchParams.get("maxResults")).toBe("5");
    await expect(yt.playlistItems.list({ part: "id", playlistId: "PL1" }).take(0)).resolves.toEqual([]);
  });

  it("keeps the page size you chose", async () => {
    const { yt, calls } = client(list([]));
    await yt.playlistItems.list({ part: "id", playlistId: "PL1", maxResults: 7 }).all();
    expect(calls[0]!.url.searchParams.get("maxResults")).toBe("7");
  });

  it("fetches one item for first(), and none of the size games on lookups by id", async () => {
    const { yt, calls } = client(list([{ id: "a" }]));
    expect((await yt.playlistItems.list({ part: "id", playlistId: "PL1" }).first())?.id).toBe("a");
    expect(calls[0]!.url.searchParams.get("maxResults")).toBe("1");
    await yt.videos.list({ part: "id", id: VIDEO_ID }).first();
    expect(calls[1]!.url.searchParams.has("maxResults")).toBe(false);
  });

  it("pages manually with next()", async () => {
    const { yt } = client([list([{ id: "a" }], { nextPageToken: "T2" }), list([{ id: "b" }])]);
    const first = await yt.playlistItems.list({ part: "id", playlistId: "PL1" });
    const second = await first.next();
    expect(second?.items[0]?.id).toBe("b");
    expect(await second?.next()).toBeNull();
  });

  it("splits long id lists into calls of 50 and merges them", async () => {
    const wanted = ids(120);
    const { yt, calls } = client((call) => list(call.url.searchParams.get("id")!.split(",").map((id) => ({ id }))));
    const page = await yt.videos.list({ part: "id", id: [...wanted, wanted[0]!] });
    expect(calls).toHaveLength(3);
    expect(calls.map((call) => call.url.searchParams.get("id")!.split(",").length).sort()).toEqual([20, 50, 50]);
    expect(page.items.map((item) => item.id).sort()).toEqual(wanted);
    expect(page.hasNext).toBe(false);
    expect(yt.quota.used).toBe(3);
  });

  it("walks chunked id lists lazily", async () => {
    const { yt, calls } = client((call) => list(call.url.searchParams.get("id")!.split(",").map((id) => ({ id }))));
    const firstSixty = await yt.videos.list({ part: "id", id: ids(120) }).take(60);
    expect(firstSixty).toHaveLength(60);
    expect(calls).toHaveLength(2);
  });

  it("reads the item key of Reporting lists", async () => {
    const { yt } = client({ jobs: [{ id: "j1" }], nextPageToken: "" }, { accessToken: "t" });
    const jobs = await yt.reporting.jobs.list().all();
    expect(jobs).toEqual([{ id: "j1" }]);
  });

  it("behaves like a promise", async () => {
    const { yt } = client(apiError(404, "playlistNotFound"));
    let finished = false;
    const result = await yt.playlistItems
      .list({ part: "id", playlistId: "nope" })
      .catch((error: unknown) => (error as { code: string }).code)
      .finally(() => {
        finished = true;
      });
    expect(result).toBe("NOT_FOUND");
    expect(finished).toBe(true);
  });
});

describe("quota", () => {
  it("counts per bucket and per method", async () => {
    const { yt } = client(() => list([]), { accessToken: "t" });
    await yt.videos.list({ part: "id", id: VIDEO_ID });
    await yt.search.list({ part: "snippet", q: "x" });
    await yt.playlists.insert({ body: { snippet: { title: "x" } } });
    await yt.videos.batchGetStats({ id: [VIDEO_ID] });
    expect(yt.quota.used).toBe(51);
    expect(yt.quota.usage).toEqual({ default: 51, "search.list": 1, "videos.batchGetStats": 1 });
    expect(yt.quota.byMethod).toEqual({ "videos.list": 1, "search.list": 1, "playlists.insert": 50, "videos.batchGetStats": 1 });
    expect(yt.quota.remaining()).toBe(9949);
    expect(yt.quota.remaining("search.list")).toBe(99);
  });

  it("emits a quota event", async () => {
    const { yt } = client(list([]));
    const events: unknown[] = [];
    yt.on("quota", (event) => events.push(event));
    await yt.videos.list({ part: "id", id: VIDEO_ID });
    expect(events).toEqual([{ method: "videos.list", bucket: "default", cost: 1, used: 1, remaining: 9999 }]);
  });

  it("charges one unit for a rejected call, nothing for an exhausted quota", async () => {
    const { yt } = client([apiError(400, "invalidParameter"), apiError(403, "quotaExceeded")], { accessToken: "t" });
    await yt.playlists.insert({ body: {} }).catch(() => {});
    expect(yt.quota.used).toBe(1);
    await yt.playlists.insert({ body: {} }).catch(() => {});
    expect(yt.quota.used).toBe(1);
  });

  it("enforces a budget before sending", async () => {
    const { yt, calls } = client(() => list([]), { quota: { limits: { default: 2, "search.list": 0 }, enforce: true } });
    await yt.videos.list({ part: "id", id: VIDEO_ID });
    await yt.videos.list({ part: "id", id: "aaaaaaaaaaa" });
    const error = await yt.videos.list({ part: "id", id: "bbbbbbbbbbb" }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(YouTubeQuotaBudgetError);
    expect(error).toMatchObject({ code: "QUOTA_BUDGET_EXCEEDED", bucket: "default", cost: 1, remaining: 0 });
    await expect(yt.search.list({ part: "snippet", q: "x" })).rejects.toMatchObject({ bucket: "search.list" });
    expect(calls).toHaveLength(2);
    expect(yt.quota.canAfford(1)).toBe(false);
  });

  it("saves and restores its count", async () => {
    const { yt } = client(() => list([]));
    await yt.videos.list({ part: "id", id: VIDEO_ID });
    const snapshot = yt.quota.snapshot();
    const { yt: restarted } = client(() => list([]), { quota: { restore: snapshot } });
    expect(restarted.quota.used).toBe(1);
    const { yt: stale } = client(() => list([]), { quota: { restore: { ...snapshot, day: "2000-01-01" } } });
    expect(stale.quota.used).toBe(0);
    yt.quota.reset();
    expect(yt.quota.used).toBe(0);
  });

  it("resets at midnight Pacific Time, across daylight saving changes", () => {
    const pacificHour = (date: Date) => new Intl.DateTimeFormat("en-GB", { timeZone: "America/Los_Angeles", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(date);
    // A summer day, a winter day, and the days the clocks change in 2026.
    for (const now of ["2026-07-01T12:00:00Z", "2026-01-15T03:00:00Z", "2026-03-08T09:30:00Z", "2026-11-01T08:30:00Z", "2026-11-01T20:00:00Z"]) {
      const reset = nextQuotaReset(Date.parse(now));
      expect(pacificHour(reset), now).toBe("00:00");
      const ahead = reset.getTime() - Date.parse(now);
      expect(ahead, now).toBeGreaterThan(0);
      expect(ahead, now).toBeLessThanOrEqual(25 * 3_600_000);
    }
  });
});

describe("cache", () => {
  it("serves fresh entries without touching the network or the quota", async () => {
    const { yt, calls } = client(() => list([{ id: VIDEO_ID }]), { cache: true });
    const cached: boolean[] = [];
    yt.on("response", (event) => cached.push(event.cached));
    await yt.videos.list({ part: "id", id: VIDEO_ID });
    await yt.videos.list({ part: "id", id: VIDEO_ID });
    await yt.videos.list({ part: "snippet", id: VIDEO_ID });
    expect(calls).toHaveLength(2);
    expect(cached).toEqual([false, true, false]);
    expect(yt.quota.used).toBe(2);
  });

  it("revalidates stale entries with their ETag", async () => {
    const { yt, calls } = client(
      [json(list([{ id: VIDEO_ID }]), 200, { etag: '"v1"' }), new Response(null, { status: 304 }), new Response(null, { status: 304 })],
      { cache: { ttl: 30 } },
    );
    const first = await yt.videos.list({ part: "id", id: VIDEO_ID });
    await new Promise((resolve) => setTimeout(resolve, 45));
    const second = await yt.videos.list({ part: "id", id: VIDEO_ID });
    expect(calls).toHaveLength(2);
    expect(calls[1]!.headers.get("if-none-match")).toBe('"v1"');
    expect(second.items).toEqual(first.items);
    // The 304 made the entry fresh again.
    await yt.videos.list({ part: "id", id: VIDEO_ID });
    expect(calls).toHaveLength(2);
  });

  it("can be skipped or tuned per call and per method", async () => {
    const { yt, calls } = client(() => list([]), { cache: { methods: { "search.list": false, "videoCategories.list": "1d" } } });
    await yt.videos.list({ part: "id", id: VIDEO_ID });
    await yt.videos.list({ part: "id", id: VIDEO_ID }, { cache: false });
    expect(calls).toHaveLength(2);
    await yt.search.list({ part: "snippet", q: "x" });
    await yt.search.list({ part: "snippet", q: "x" });
    expect(calls).toHaveLength(4);
    await yt.videoCategories.list({ part: "snippet", regionCode: "FR" });
    await yt.videoCategories.list({ part: "snippet", regionCode: "FR" });
    expect(calls).toHaveLength(5);
    await yt.clearCache();
    await yt.videoCategories.list({ part: "snippet", regionCode: "FR" });
    expect(calls).toHaveLength(6);
  });

  it("never caches writes and keeps users apart", async () => {
    const { yt, calls } = client(() => list([{ id: "x" }]), { cache: true });
    await yt.as("token-of-alice").channels.list({ part: "id", mine: true });
    await yt.as("token-of-bobby").channels.list({ part: "id", mine: true });
    await yt.as("token-of-alice").channels.list({ part: "id", mine: true });
    expect(calls).toHaveLength(2);
    await yt.as("t").videos.rate({ id: VIDEO_ID, rating: "like" });
    await yt.as("t").videos.rate({ id: VIDEO_ID, rating: "like" });
    expect(calls).toHaveLength(4);
  });

  it("shares one request between identical concurrent reads", async () => {
    const { yt, calls } = client(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
      return list([{ id: VIDEO_ID }]);
    });
    const [a, b] = await Promise.all([yt.videos.list({ part: "id", id: VIDEO_ID }), yt.videos.list({ part: "id", id: VIDEO_ID })]);
    expect(calls).toHaveLength(1);
    expect(a.items).toEqual(b.items);
  });

  it("evicts the least recently used entry", () => {
    const cache = new MemoryCache(2);
    cache.set("a", { value: 1, expires: 1 });
    cache.set("b", { value: 2, expires: 1 });
    cache.get("a");
    cache.set("c", { value: 3, expires: 1 });
    expect(cache.get("b")).toBeUndefined();
    expect(cache.get("a")?.value).toBe(1);
    expect(cache.size).toBe(2);
  });
});
