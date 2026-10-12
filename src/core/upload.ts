import { YouTubeApiError, YouTubeArgumentError, YouTubeRequestError, YouTubeUploadError } from "./errors.js";
import { sleep } from "./time.js";

/** Anything that can be uploaded. Strings are sent as UTF-8 text, handy for caption files. */
export type MediaBody = Blob | ArrayBuffer | Uint8Array | ReadableStream<Uint8Array> | AsyncIterable<Uint8Array> | string;

/** Progress of an upload, passed to `onProgress` after each confirmed chunk. */
export interface UploadProgress {
  /** Bytes confirmed by the server. */
  uploaded: number;
  /** Total size in bytes, when known. */
  total: number | undefined;
  /** 0 to 100, when the total is known. */
  percent: number | undefined;
  /** Resumable session, present for chunked uploads. Store it to resume after a crash. */
  sessionUri: string | undefined;
}

/** Detailed form of the `media` parameter. */
export interface MediaOptions {
  /** The bytes. */
  body: MediaBody;
  /** MIME type. Defaults to the Blob's type, to `text/plain` for a string, and to `application/octet-stream` otherwise. */
  mimeType?: string | undefined;
  /** Total size in bytes. Only used for streams, and only so progress can show a percentage: the stream is read to its end either way. */
  size?: number | undefined;
  /** Bytes per request for resumable uploads. Rounded to a multiple of 256 KiB. Default 8 MiB. */
  chunkSize?: number | undefined;
  /** Called after each confirmed chunk. */
  onProgress?: ((progress: UploadProgress) => void) | undefined;
  /**
   * Session URI of an interrupted upload, to carry on where it stopped. The
   * metadata and parameters given when the session was opened still apply:
   * those of the resuming call are not sent again.
   */
  resumeUri?: string | undefined;
}

/** The `media` parameter: the bytes, or the bytes with options. */
export type MediaInput = MediaBody | MediaOptions;

const KIB_256 = 256 * 1024;
const DEFAULT_CHUNK = 8 * 1024 * 1024;
/** Below this size a single request is cheaper than opening a resumable session. */
const SINGLE_REQUEST_LIMIT = 5 * 1024 * 1024;

interface Chunk {
  data: Uint8Array;
  last: boolean;
}

/** Reads the media sequentially, one chunk at a time, from any supported source. */
interface Source {
  /** Whether `size` is the real length. A size declared for a stream is only a hint for progress. */
  exact: boolean;
  size: number | undefined;
  mimeType: string;
  /** Skips to `offset`. Only called before the first read, when resuming. */
  seek(offset: number): Promise<void>;
  next(length: number): Promise<Chunk>;
}

function isOptions(media: MediaInput): media is MediaOptions {
  return (
    typeof media === "object" &&
    media !== null &&
    "body" in media &&
    !(typeof Blob !== "undefined" && media instanceof Blob) &&
    !(media instanceof ArrayBuffer) &&
    !ArrayBuffer.isView(media) &&
    !(typeof ReadableStream !== "undefined" && media instanceof ReadableStream)
  );
}

function randomAccess(size: number, mimeType: string, read: (start: number, end: number) => Promise<Uint8Array>): Source {
  let offset = 0;
  return {
    exact: true,
    size,
    mimeType,
    async seek(to) {
      offset = to;
    },
    async next(length) {
      const end = Math.min(size, offset + length);
      const data = await read(offset, end);
      offset = end;
      return { data, last: end >= size };
    },
  };
}

function sequential(iterable: AsyncIterable<Uint8Array>, size: number | undefined, mimeType: string): Source {
  const iterator = iterable[Symbol.asyncIterator]();
  let pending: Uint8Array[] = [];
  let buffered = 0;
  let ended = false;

  async function fill(target: number): Promise<void> {
    while (!ended && buffered < target) {
      const { value, done } = await iterator.next();
      if (done) ended = true;
      else if (value?.byteLength) {
        pending.push(value);
        buffered += value.byteLength;
      }
    }
  }

  function take(length: number): Uint8Array {
    const out = new Uint8Array(Math.min(length, buffered));
    let written = 0;
    while (written < out.byteLength) {
      const head = pending[0]!;
      const room = out.byteLength - written;
      if (head.byteLength <= room) {
        out.set(head, written);
        written += head.byteLength;
        pending.shift();
      } else {
        out.set(head.subarray(0, room), written);
        pending[0] = head.subarray(room);
        written += room;
      }
    }
    buffered -= out.byteLength;
    return out;
  }

  return {
    exact: false,
    size,
    mimeType,
    async seek(to) {
      let skipped = 0;
      while (skipped < to) {
        await fill(Math.min(DEFAULT_CHUNK, to - skipped));
        const dropped = take(to - skipped).byteLength;
        if (!dropped) break;
        skipped += dropped;
      }
    },
    async next(length) {
      // One byte of lookahead tells whether this chunk is the last one.
      await fill(length + 1);
      const data = take(length);
      return { data, last: ended && buffered === 0 };
    },
  };
}

async function* streamToIterable(stream: ReadableStream<Uint8Array>): AsyncGenerator<Uint8Array> {
  const reader = stream.getReader();
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) return;
      yield value;
    }
  } finally {
    reader.releaseLock();
  }
}

function toSource(options: MediaOptions): Source {
  const { body } = options;
  const fallback = options.mimeType ?? "application/octet-stream";
  if (typeof body === "string") {
    const bytes = new TextEncoder().encode(body);
    return randomAccess(bytes.byteLength, options.mimeType ?? "text/plain; charset=UTF-8", async (start, end) => bytes.subarray(start, end));
  }
  if (typeof Blob !== "undefined" && body instanceof Blob) {
    return randomAccess(body.size, options.mimeType ?? (body.type || fallback), async (start, end) => new Uint8Array(await body.slice(start, end).arrayBuffer()));
  }
  if (body instanceof ArrayBuffer) {
    const bytes = new Uint8Array(body);
    return randomAccess(bytes.byteLength, fallback, async (start, end) => bytes.subarray(start, end));
  }
  if (ArrayBuffer.isView(body)) {
    const bytes = new Uint8Array(body.buffer, body.byteOffset, body.byteLength);
    return randomAccess(bytes.byteLength, fallback, async (start, end) => bytes.subarray(start, end));
  }
  if (typeof ReadableStream !== "undefined" && body instanceof ReadableStream) {
    return sequential(streamToIterable(body), options.size, fallback);
  }
  if (body && typeof (body as AsyncIterable<Uint8Array>)[Symbol.asyncIterator] === "function") {
    return sequential(body as AsyncIterable<Uint8Array>, options.size, fallback);
  }
  throw new YouTubeArgumentError("Unsupported media body. Pass a Blob, a Uint8Array, an ArrayBuffer, a ReadableStream, an async iterable of bytes or a string.");
}

function matchesAccept(mimeType: string, accept: readonly string[]): boolean {
  const type = mimeType.split(";")[0]!.trim().toLowerCase();
  return accept.some((pattern) => pattern === "*/*" || pattern === type || (pattern.endsWith("/*") && type.startsWith(pattern.slice(0, -1))));
}

export interface UploadRequest {
  fetch: typeof fetch;
  method: string;
  verb: string;
  /** Upload endpoint with the method's query parameters, without `uploadType`. */
  url: string;
  headers: Record<string, string>;
  metadata: unknown;
  media: MediaInput;
  accept: readonly string[];
  maxSize: number;
  signal?: AbortSignal | undefined;
  retry: { attempts: number; delay: number; maxDelay: number };
  parseError: (response: Response, text: string) => YouTubeApiError;
}

function withUploadType(url: string, type: "media" | "multipart" | "resumable"): string {
  const next = new URL(url);
  next.searchParams.set("uploadType", type);
  return next.toString();
}

async function readResult<T>(request: UploadRequest, response: Response): Promise<T> {
  const text = await response.text();
  if (!response.ok) throw request.parseError(response, text);
  if (!text) return undefined as T;
  try {
    return JSON.parse(text) as T;
  } catch (cause) {
    throw new YouTubeRequestError("PARSE_ERROR", request.method, "the upload response is not valid JSON.", { cause });
  }
}

/**
 * Sends a media upload: one request for small payloads, a resumable session
 * for everything else.
 *
 * @internal
 */
export async function upload<T>(request: UploadRequest): Promise<T> {
  const options: MediaOptions = isOptions(request.media) ? request.media : { body: request.media };
  const source = toSource(options);

  if (!matchesAccept(source.mimeType, request.accept)) {
    throw new YouTubeArgumentError(`${request.method} does not accept "${source.mimeType}". Accepted types: ${request.accept.join(", ")}. Set \`media.mimeType\`.`);
  }
  if (source.exact && source.size !== undefined) {
    if (source.size === 0) throw new YouTubeArgumentError(`${request.method}: the media is empty.`);
    if (source.size > request.maxSize) {
      throw new YouTubeArgumentError(`${request.method}: the media is ${source.size} bytes, the limit is ${request.maxSize}.`);
    }
  }

  const report = (uploaded: number, sessionUri: string | undefined) =>
    options.onProgress?.({
      uploaded,
      total: source.size,
      percent: source.size ? Math.min(100, Math.round((uploaded / source.size) * 1000) / 10) : undefined,
      sessionUri,
    });

  if (!options.resumeUri && source.exact && source.size !== undefined && source.size <= SINGLE_REQUEST_LIMIT) {
    const { data } = await source.next(source.size);
    const result = await single<T>(request, data, source.mimeType);
    report(source.size, undefined);
    return result;
  }
  return resumable<T>(request, source, options, report);
}

async function single<T>(request: UploadRequest, data: Uint8Array, mimeType: string): Promise<T> {
  const { fetch: send } = request;
  const headers = { ...request.headers };
  let body: BodyInit;
  let url: string;
  if (request.metadata === undefined) {
    url = withUploadType(request.url, "media");
    headers["content-type"] = mimeType;
    body = data as unknown as BodyInit;
  } else {
    const boundary = `ytapi_${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
    url = withUploadType(request.url, "multipart");
    headers["content-type"] = `multipart/related; boundary=${boundary}`;
    const head = `--${boundary}\r\ncontent-type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(request.metadata)}\r\n--${boundary}\r\ncontent-type: ${mimeType}\r\n\r\n`;
    body = new Blob([head, data as unknown as BlobPart, `\r\n--${boundary}--`]);
  }
  let response: Response;
  try {
    response = await send(url, { method: request.verb, headers, body, signal: request.signal ?? null });
  } catch (cause) {
    if (request.signal?.aborted) throw new YouTubeRequestError("ABORTED", request.method, "the upload was aborted.", { cause });
    throw new YouTubeUploadError(`${request.method}: the upload failed (${(cause as Error)?.message ?? cause}).`, { cause });
  }
  return readResult<T>(request, response);
}

/** Offset confirmed by a 308 answer: the byte after the end of its `Range` header. */
function confirmedOffset(response: Response): number {
  const match = /bytes=0-(\d+)/.exec(response.headers.get("range") ?? "");
  return match ? Number(match[1]) + 1 : 0;
}

async function resumable<T>(
  request: UploadRequest,
  source: Source,
  options: MediaOptions,
  report: (uploaded: number, sessionUri: string | undefined) => void,
): Promise<T> {
  const { fetch: send } = request;
  const chunkSize = Math.max(KIB_256, Math.round((options.chunkSize ?? DEFAULT_CHUNK) / KIB_256) * KIB_256);
  // A size declared for a stream is a hint for progress, never a promise made to the server.
  const total = source.exact ? source.size : undefined;
  const auth: Record<string, string> = request.headers.authorization ? { authorization: request.headers.authorization } : {};
  let sessionUri = options.resumeUri;
  let offset = 0;

  const fail = (message: string, cause?: unknown): never => {
    if (request.signal?.aborted) throw new YouTubeRequestError("ABORTED", request.method, "the upload was aborted.", { cause });
    throw new YouTubeUploadError(`${request.method}: ${message}`, { sessionUri, uploaded: offset, cause });
  };

  /** The session is gone: the error carries no `sessionUri`, since there is nothing left to resume. */
  const expired = (): never => {
    sessionUri = undefined;
    return fail("the upload session expired. Start the upload again.");
  };

  /** Asks the server how many bytes it has. Returns the final response if the upload is already complete. */
  const status = async (): Promise<Response | undefined> => {
    const response = await send(sessionUri!, {
      method: "PUT",
      headers: { ...auth, "content-range": `bytes */${total ?? "*"}` },
      signal: request.signal ?? null,
    });
    if (response.status === 308) {
      offset = confirmedOffset(response);
      void response.body?.cancel().catch(() => {});
      return undefined;
    }
    if (response.status === 404 || response.status === 410) {
      void response.body?.cancel().catch(() => {});
      return expired();
    }
    return response;
  };

  if (sessionUri) {
    let done: Response | undefined;
    try {
      done = await status();
    } catch (cause) {
      if (cause instanceof YouTubeUploadError || cause instanceof YouTubeRequestError) throw cause;
      return fail(`could not reach the upload session (${(cause as Error)?.message ?? cause}).`, cause);
    }
    if (done) return readResult<T>(request, done);
    await source.seek(offset);
  } else {
    const headers: Record<string, string> = { ...request.headers, "x-upload-content-type": source.mimeType };
    if (total !== undefined) headers["x-upload-content-length"] = String(total);
    const init: RequestInit = { method: request.verb, headers, signal: request.signal ?? null };
    if (request.metadata !== undefined) {
      headers["content-type"] = "application/json; charset=UTF-8";
      init.body = JSON.stringify(request.metadata);
    }
    let response: Response;
    try {
      response = await send(withUploadType(request.url, "resumable"), init);
    } catch (cause) {
      return fail(`could not open an upload session (${(cause as Error)?.message ?? cause}).`, cause);
    }
    if (!response.ok) throw request.parseError(response, await response.text().catch(() => ""));
    sessionUri = response.headers.get("location") ?? undefined;
    void response.body?.cancel().catch(() => {});
    if (!sessionUri) return fail("the API did not return an upload session.");
  }
  report(offset, sessionUri);

  let failures = 0;
  let chunk = await source.next(chunkSize);
  if (!chunk.data.byteLength && chunk.last && offset === 0) throw new YouTubeArgumentError(`${request.method}: the media is empty.`);
  /** Offset of the first byte of `chunk`. */
  let chunkStart = offset;

  for (;;) {
    const data = chunk.data.subarray(offset - chunkStart);
    const end = offset + data.byteLength;
    const size = chunk.last ? end : (total ?? "*");
    const range = data.byteLength ? `bytes ${offset}-${end - 1}/${size}` : `bytes */${size}`;
    let response: Response | undefined;
    try {
      response = await send(sessionUri, {
        method: "PUT",
        headers: { ...auth, "content-type": source.mimeType, "content-range": range },
        body: data as unknown as BodyInit,
        signal: request.signal ?? null,
      });
    } catch (cause) {
      if (request.signal?.aborted) return fail("aborted", cause);
      response = undefined;
    }

    if (response?.status === 308) {
      failures = 0;
      offset = confirmedOffset(response);
      void response.body?.cancel().catch(() => {});
      // The bytes before this chunk are gone from memory: a server that
      // steps back behind them cannot be served, and guessing would corrupt the file.
      if (offset < chunkStart) return fail("the server lost bytes it had confirmed. Start the upload again.");
      report(offset, sessionUri);
      if (offset >= chunkStart + chunk.data.byteLength) {
        if (chunk.last) return fail("the server confirmed every byte but did not finish the upload.");
        chunkStart = offset;
        chunk = await source.next(chunkSize);
      }
      continue;
    }
    if (response && (response.status === 200 || response.status === 201)) {
      offset = end;
      report(offset, sessionUri);
      return readResult<T>(request, response);
    }
    if (response && response.status < 500 && response.status !== 408 && response.status !== 429) {
      if (response.status === 404 || response.status === 410) return expired();
      throw request.parseError(response, await response.text().catch(() => ""));
    }

    // Network failure or a 5xx: wait, ask the server where it stands, carry on.
    void response?.body?.cancel().catch(() => {});
    if (++failures > request.retry.attempts) {
      return fail(`gave up after ${failures} failed attempts at byte ${offset}. Pass \`resumeUri\` to resume.`);
    }
    const backoff = Math.min(request.retry.maxDelay, request.retry.delay * 2 ** (failures - 1));
    try {
      await sleep(backoff / 2 + Math.random() * (backoff / 2), request.signal);
      const done = await status();
      if (done) return readResult<T>(request, done);
    } catch (cause) {
      if (cause instanceof YouTubeUploadError || cause instanceof YouTubeRequestError) throw cause;
      if (request.signal?.aborted) return fail("aborted", cause);
      // The status probe failed too: the next round of the loop retries.
    }
    if (offset < chunkStart) return fail("the server lost bytes it had confirmed. Start the upload again.");
  }
}
