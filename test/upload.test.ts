import { describe, expect, it } from "vitest";
import { type UploadProgress, YouTubeUploadError } from "../src/index.js";
import { type Call, VIDEO_ID, apiError, client, json } from "./helpers.js";

const KIB = 1024;
const MIB = 1024 * KIB;
const SESSION = "https://upload.example/session/1";

function bytes(size: number) {
  const data = new Uint8Array(size);
  for (let index = 0; index < size; index++) data[index] = index % 251;
  return data;
}

/** A fake resumable upload endpoint that stores what it receives. */
function uploadServer(options: { failAt?: number[]; ackHalfAt?: number } = {}) {
  let received = new Uint8Array(0);
  let puts = 0;
  const ranges: string[] = [];
  const respond = async (call: Call): Promise<Response> => {
    if (call.url.href !== SESSION) {
      return new Response(null, { status: 200, headers: { location: SESSION } });
    }
    const range = call.headers.get("content-range")!;
    ranges.push(range);
    const status = /^bytes \*\/(\d+|\*)$/.exec(range);
    if (status) {
      return new Response(null, { status: 308, headers: received.length ? { range: `bytes=0-${received.length - 1}` } : {} });
    }
    puts++;
    if (options.failAt?.includes(puts)) return apiError(503, "backendError");
    const [, start, end, total] = /^bytes (\d+)-(\d+)\/(\d+|\*)$/.exec(range)!;
    let chunk = new Uint8Array(call.init.body as Uint8Array);
    expect(chunk.length).toBe(Number(end) - Number(start) + 1);
    expect(Number(start)).toBe(received.length);
    if (options.ackHalfAt === puts) chunk = chunk.subarray(0, chunk.length / 2);
    const next = new Uint8Array(received.length + chunk.length);
    next.set(received);
    next.set(chunk, received.length);
    received = next;
    if (total !== "*" && received.length === Number(total)) return json({ id: VIDEO_ID, kind: "youtube#video", etag: "e" });
    return new Response(null, { status: 308, headers: { range: `bytes=0-${received.length - 1}` } });
  };
  return { respond, ranges, get received() { return received; }, get puts() { return puts; } };
}

describe("uploads", () => {
  it("sends a small file with its metadata in one multipart request", async () => {
    const { yt, calls } = client({ id: VIDEO_ID }, { accessToken: "token" });
    const progress: UploadProgress[] = [];
    const video = await yt.videos.insert({
      part: ["snippet", "status"],
      body: { snippet: { title: "Small" }, status: { privacyStatus: "private" } },
      media: { body: new Blob([bytes(2048)], { type: "video/mp4" }), onProgress: (p) => progress.push(p) },
      notifySubscribers: false,
    });
    expect(video.id).toBe(VIDEO_ID);
    expect(calls).toHaveLength(1);
    const call = calls[0]!;
    expect(call.url.origin + call.url.pathname).toBe("https://youtube.googleapis.com/upload/youtube/v3/videos");
    expect(Object.fromEntries(call.url.searchParams)).toEqual({ part: "snippet,status", notifySubscribers: "false", uploadType: "multipart" });
    expect(call.headers.get("authorization")).toBe("Bearer token");
    const boundary = /boundary=(.+)$/.exec(call.headers.get("content-type")!)![1]!;
    const text = await (call.init.body as Blob).text();
    expect(text.startsWith(`--${boundary}\r\ncontent-type: application/json; charset=UTF-8\r\n\r\n{"snippet":{"title":"Small"}`)).toBe(true);
    expect(text).toContain(`\r\n--${boundary}\r\ncontent-type: video/mp4\r\n\r\n`);
    expect(text.endsWith(`\r\n--${boundary}--`)).toBe(true);
    expect(progress).toEqual([{ uploaded: 2048, total: 2048, percent: 100, sessionUri: undefined }]);
    expect(yt.quota.usage).toEqual({ "videos.insert": 1 });
  });

  it("sends a file without metadata as a plain media upload", async () => {
    const { yt, calls } = client({ kind: "youtube#thumbnailSetResponse", items: [] }, { accessToken: "token" });
    await yt.thumbnails.set({ videoId: VIDEO_ID, media: new Blob([bytes(512)], { type: "image/png" }) });
    expect(Object.fromEntries(calls[0]!.url.searchParams)).toEqual({ videoId: VIDEO_ID, uploadType: "media" });
    expect(calls[0]!.headers.get("content-type")).toBe("image/png");
    expect((calls[0]!.init.body as Uint8Array).byteLength).toBe(512);
  });

  it("accepts text for captions", async () => {
    const { yt, calls } = client({ id: "cap" }, { accessToken: "token" });
    await yt.captions.insert({ body: { snippet: { videoId: VIDEO_ID, language: "en", name: "English" } }, media: { body: "1\n00:00:00,000 --> 00:00:01,000\nHi\n", mimeType: "application/x-subrip" } });
    expect(calls[0]!.url.searchParams.get("part")).toBe("snippet");
    expect(await (calls[0]!.init.body as Blob).text()).toContain("00:00:00,000 --> 00:00:01,000");
  });

  it("uploads a large file in chunks over a resumable session", async () => {
    const server = uploadServer();
    const { yt, calls } = client(server.respond, { accessToken: "token" });
    const data = bytes(6 * MIB + 123);
    const progress: UploadProgress[] = [];
    const video = await yt.videos.insert({
      body: { snippet: { title: "Big" } },
      media: { body: data, mimeType: "video/mp4", chunkSize: 2 * MIB, onProgress: (p) => progress.push(p) },
    });
    expect(video.id).toBe(VIDEO_ID);
    const start = calls[0]!;
    expect(start.url.searchParams.get("uploadType")).toBe("resumable");
    expect(start.headers.get("x-upload-content-type")).toBe("video/mp4");
    expect(start.headers.get("x-upload-content-length")).toBe(String(data.length));
    expect(start.body).toEqual({ snippet: { title: "Big" } });
    expect(server.ranges).toEqual([
      `bytes 0-${2 * MIB - 1}/${data.length}`,
      `bytes ${2 * MIB}-${4 * MIB - 1}/${data.length}`,
      `bytes ${4 * MIB}-${6 * MIB - 1}/${data.length}`,
      `bytes ${6 * MIB}-${data.length - 1}/${data.length}`,
    ]);
    expect(Buffer.compare(server.received, data)).toBe(0);
    expect(progress.map((p) => p.uploaded)).toEqual([0, 2 * MIB, 4 * MIB, 6 * MIB, data.length]);
    expect(progress.at(-1)).toMatchObject({ percent: 100, sessionUri: SESSION });
  });

  it("recovers from a failed chunk and from a partial acknowledgement", async () => {
    const server = uploadServer({ failAt: [2], ackHalfAt: 4 });
    const { yt } = client(server.respond, { accessToken: "token" });
    const data = bytes(6 * MIB);
    await yt.videos.insert({ body: { snippet: { title: "Flaky" } }, media: { body: data, mimeType: "video/mp4", chunkSize: 2 * MIB } });
    expect(Buffer.compare(server.received, data)).toBe(0);
    expect(server.ranges).toContain(`bytes */${data.length}`);
    expect(server.puts).toBeGreaterThan(3);
  });

  it("uploads a stream of unknown size", async () => {
    const server = uploadServer();
    const { yt } = client(server.respond, { accessToken: "token" });
    const data = bytes(700 * KIB);
    async function* source() {
      for (let offset = 0; offset < data.length; offset += 100 * KIB) yield data.subarray(offset, offset + 100 * KIB);
    }
    await yt.videos.insert({ body: { snippet: { title: "Stream" } }, media: { body: source(), mimeType: "video/webm", chunkSize: 256 * KIB } });
    expect(server.ranges).toEqual([`bytes 0-${256 * KIB - 1}/*`, `bytes ${256 * KIB}-${512 * KIB - 1}/*`, `bytes ${512 * KIB}-${data.length - 1}/${data.length}`]);
    expect(Buffer.compare(server.received, data)).toBe(0);
  });

  it("uploads a ReadableStream whose size is an exact number of chunks", async () => {
    const server = uploadServer();
    const { yt } = client(server.respond, { accessToken: "token" });
    const data = bytes(512 * KIB);
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(data);
        controller.close();
      },
    });
    await yt.videos.insert({ body: { snippet: { title: "Exact" } }, media: { body: stream, mimeType: "video/mp4", chunkSize: 256 * KIB } });
    expect(server.ranges.at(-1)).toBe(`bytes ${256 * KIB}-${512 * KIB - 1}/${512 * KIB}`);
    expect(Buffer.compare(server.received, data)).toBe(0);
  });

  it("resumes an interrupted session", async () => {
    const data = bytes(6 * MIB);
    const server = uploadServer();
    // The server already holds the first two megabytes.
    await server.respond({ url: new URL(SESSION), headers: new Headers({ "content-range": `bytes 0-${2 * MIB - 1}/${data.length}` }), init: { body: data.subarray(0, 2 * MIB) } } as unknown as Call);
    const { yt, calls } = client(server.respond, { accessToken: "token" });
    await yt.videos.insert({ body: { snippet: { title: "Resumed" } }, media: { body: data, mimeType: "video/mp4", chunkSize: 2 * MIB, resumeUri: SESSION } });
    expect(calls.every((call) => call.url.href === SESSION)).toBe(true);
    expect(server.ranges.slice(1)).toEqual([`bytes */${data.length}`, `bytes ${2 * MIB}-${4 * MIB - 1}/${data.length}`, `bytes ${4 * MIB}-${6 * MIB - 1}/${data.length}`]);
    expect(Buffer.compare(server.received, data)).toBe(0);
  });

  it("gives the session back when it gives up", async () => {
    const server = uploadServer({ failAt: [1, 2, 3, 4, 5, 6] });
    const { yt } = client(server.respond, { accessToken: "token", retry: { attempts: 2, delay: 1 } });
    const error = (await yt.videos.insert({ body: {}, media: { body: bytes(6 * MIB), mimeType: "video/mp4" } }).catch((e: unknown) => e)) as YouTubeUploadError;
    expect(error).toBeInstanceOf(YouTubeUploadError);
    expect(error).toMatchObject({ code: "UPLOAD_FAILED", sessionUri: SESSION, uploaded: 0 });
  });

  it("checks the type and the size before sending anything", async () => {
    const { yt, calls } = client({}, { accessToken: "token" });
    await expect(yt.thumbnails.set({ videoId: VIDEO_ID, media: new Blob([bytes(10)], { type: "image/gif" }) })).rejects.toThrow(/does not accept "image\/gif"/);
    await expect(yt.thumbnails.set({ videoId: VIDEO_ID, media: new Blob([], { type: "image/png" }) })).rejects.toThrow(/empty/);
    await expect(yt.videos.insert({ body: {}, media: 42 as never })).rejects.toThrow(/Unsupported media/);
    expect(calls).toHaveLength(0);
  });

  it("surfaces an API error on the session request", async () => {
    const { yt } = client(apiError(403, "uploadLimitExceeded", "The user has exceeded the number of videos they may upload."), { accessToken: "token" });
    await expect(yt.videos.insert({ body: {}, media: { body: bytes(6 * MIB), mimeType: "video/mp4" } })).rejects.toMatchObject({ code: "FORBIDDEN", reason: "uploadLimitExceeded" });
  });
});
