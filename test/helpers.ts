import { YouTube, type YouTubeOptions } from "../src/index.js";

export interface Call {
  url: URL;
  method: string;
  headers: Headers;
  /** Parsed JSON body, raw text, or the body object itself for binary payloads. */
  body: unknown;
  init: RequestInit;
}

type Responder = Response | Record<string, unknown> | ((call: Call) => Response | Record<string, unknown> | Promise<Response | Record<string, unknown>>);

export function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
}

export function apiError(status: number, reason: string, message = reason, headers: Record<string, string> = {}): Response {
  return json({ error: { code: status, message, errors: [{ message, domain: "youtube", reason }] } }, status, headers);
}

/**
 * A fake `fetch`. With one responder it answers every call; with several,
 * they are used in order and the last one repeats.
 */
export function mockFetch(...responders: Responder[]): { fetch: typeof fetch; calls: Call[] } {
  const calls: Call[] = [];
  const fetchImpl = (async (input: string | URL | Request, init: RequestInit = {}) => {
    if (init.signal?.aborted) throw init.signal.reason ?? new DOMException("Aborted", "AbortError");
    let body: unknown = init.body;
    if (typeof init.body === "string") {
      try {
        body = JSON.parse(init.body);
      } catch {
        body = init.body;
      }
    }
    const call: Call = { url: new URL(String(input)), method: init.method ?? "GET", headers: new Headers(init.headers), body, init };
    calls.push(call);
    const responder = responders[Math.min(calls.length - 1, responders.length - 1)];
    if (typeof responder === "function") {
      const result = await responder(call);
      return result instanceof Response ? result : json(result ?? {});
    }
    // A fixed Response may be served several times: hand out copies.
    const result = responder;
    if (result instanceof Response) return result.clone();
    return json(result ?? {});
  }) as typeof fetch;
  return { fetch: fetchImpl, calls };
}

/** A client wired to a fake fetch, with retries made instant. */
export function client(responders: Responder[] | Responder, options: YouTubeOptions = {}): { yt: YouTube; calls: Call[] } {
  const { fetch, calls } = mockFetch(...(Array.isArray(responders) ? responders : [responders]));
  const yt = new YouTube({ apiKey: "test-key", retry: { delay: 1, maxDelay: 2 }, ...options, fetch });
  return { yt, calls };
}

export const list = (items: unknown[], extra: Record<string, unknown> = {}) => ({ kind: "youtube#listResponse", etag: "etag", items, ...extra });

export const CHANNEL_ID = "UC_x5XG1OV2P6uZZ5FSM9Ttw";
export const VIDEO_ID = "dQw4w9WgXcQ";
