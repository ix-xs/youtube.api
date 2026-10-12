import type { OAuth2 } from "../auth/oauth2.js";
import { type CacheEntry, type CacheOptions, type CacheStore, MemoryCache } from "./cache.js";
import { Emitter } from "./emitter.js";
import {
  type ApiErrorDetail,
  YouTubeApiError,
  YouTubeArgumentError,
  YouTubeAuthError,
  YouTubeRequestError,
  redactUrl,
} from "./errors.js";
import { type QuotaBucket, type QuotaEvent, type QuotaOptions, QuotaTracker } from "./quota.js";
import { type Duration, sleep, toMs } from "./time.js";
import { type MediaInput, type UploadProgress, upload } from "./upload.js";

/** Which Google API a method belongs to. */
export type ApiName = "data" | "analytics" | "reporting";

/** Static description of one API method. The table of all of them is generated. */
export interface MethodSpec {
  /** Method name as written in the docs, for example `videos.list`. */
  readonly id: string;
  readonly api: ApiName;
  readonly verb: "GET" | "POST" | "PUT" | "DELETE";
  readonly path: string;
  /** Quota units charged per call. */
  readonly quota: number;
  readonly bucket: QuotaBucket;
  /** `oauth` when an API key can never be enough. */
  readonly auth: "any" | "oauth";
  /** OAuth scopes accepted by the method, short form. */
  readonly scopes: readonly string[];
  /** Pagination: name of the page size parameter and its bounds. */
  readonly paged?: { readonly size: string; readonly max: number; readonly min?: number };
  /** Parameter that takes a capped list of ids and can be split across calls. */
  readonly chunk?: { readonly param: string; readonly size: number };
  /** Key of the array in a list response. Default `items`. */
  readonly items?: string;
  readonly upload?: { readonly path: string; readonly accept: readonly string[]; readonly maxSize: number };
  /** Whether the method takes `onBehalfOfContentOwner`. */
  readonly owner?: boolean;
  /** A write whose `part` defaults to the parts present in its body. */
  readonly autoPart?: boolean;
  /** Shape of a successful answer. Default `json`. */
  readonly response?: "json" | "none" | "text";
}

/** What a `Retry-After` header asks for, in seconds: it holds either a number of seconds or a date. */
export function retryAfterSeconds(header: string | null, now: number = Date.now()): number | undefined {
  if (!header) return undefined;
  const seconds = Number(header);
  if (Number.isFinite(seconds)) return seconds > 0 ? seconds : undefined;
  const date = Date.parse(header);
  if (Number.isNaN(date)) return undefined;
  const wait = Math.ceil((date - now) / 1000);
  return wait > 0 ? wait : undefined;
}

/** Retry policy. */
export interface RetryOptions {
  /** Retries after the first attempt. Default 3. Use 0 to turn retries off. */
  attempts?: number | undefined;
  /** First delay, doubled on each retry. Default `"500ms"`. */
  delay?: Duration | undefined;
  /**
   * Upper bound of a single delay. Default `"30s"`. When the API asks to wait
   * longer than this (`Retry-After`), the call is not retried: the error is
   * thrown with its `retryAfter`.
   */
  maxDelay?: Duration | undefined;
}

/** Options accepted as the last argument of every API call. */
export interface RequestOptions {
  /** Cancels the call. */
  signal?: AbortSignal | undefined;
  /** Overrides the client's timeout for this call. */
  timeout?: Duration | undefined;
  /** Overrides the client's retry policy. `false` turns retries off. */
  retry?: RetryOptions | false | undefined;
  /**
   * Partial response selector: only the listed fields come back, which
   * shrinks the payload. Example: `"items(id,snippet/title),nextPageToken"`.
   */
  fields?: string | undefined;
  /** `false` skips the cache for this call, a duration overrides the freshness. */
  cache?: Duration | false | undefined;
  /** Per-user quota key (at most 40 characters) for server apps that enforce per-user limits. */
  quotaUser?: string | undefined;
  /** Uses this access token for the call, instead of the client's credentials. */
  accessToken?: string | undefined;
  /** Extra headers. */
  headers?: Record<string, string> | undefined;
}

/** Events emitted by the client, see `yt.on()`. */
export interface ClientEvents {
  /** A request is about to be sent. Fires once per attempt. */
  request: { method: string; verb: string; url: string; attempt: number };
  /** A call finished successfully. `cached` calls did not touch the network. */
  response: { method: string; status: number; duration: number; cached: boolean; cost: number; bucket: QuotaBucket };
  /** A failed attempt will be retried after `delay` milliseconds. */
  retry: { method: string; attempt: number; delay: number; error: Error };
  /** Quota was charged. */
  quota: QuotaEvent;
  /** A listener of yours threw, or the cache store failed. Neither stops the call that was running. */
  error: unknown;
}

/** A value, or a function that produces it. */
export type AccessTokenProvider = string | (() => string | Promise<string>);

export interface RestOptions {
  apiKey?: string | undefined;
  accessToken?: AccessTokenProvider | undefined;
  oauth?: OAuth2 | undefined;
  fetch?: typeof fetch | undefined;
  baseUrl?: string | undefined;
  timeout?: Duration | undefined;
  retry?: RetryOptions | false | undefined;
  cache?: boolean | CacheOptions | undefined;
  quota?: QuotaOptions | undefined;
  quotaUser?: string | undefined;
  headers?: Record<string, string> | undefined;
  onBehalfOfContentOwner?: string | undefined;
}

const BASE_URLS: Record<ApiName, string> = {
  data: "https://youtube.googleapis.com/",
  analytics: "https://youtubeanalytics.googleapis.com/",
  reporting: "https://youtubereporting.googleapis.com/",
};

/** Query parameters that only make sense for an authenticated user. */
const USER_PARAMS = [
  "mine",
  "myRating",
  "mySubscribers",
  "myRecentSubscribers",
  "forMine",
  "home",
  "managedByMe",
  "forContentOwner",
  "forDeveloper",
  "onBehalfOfContentOwner",
  "onBehalfOfContentOwnerChannel",
];

const ERROR_INFO_REASONS: Record<string, string> = {
  API_KEY_INVALID: "keyInvalid",
  API_KEY_EXPIRED: "keyExpired",
  SERVICE_DISABLED: "accessNotConfigured",
  ACCESS_TOKEN_SCOPE_INSUFFICIENT: "insufficientPermissions",
  RATE_LIMIT_EXCEEDED: "rateLimitExceeded",
};

type Params = Record<string, unknown>;

interface ResolvedRetry {
  attempts: number;
  delay: number;
  maxDelay: number;
}

function resolveRetry(base: ResolvedRetry, override: RetryOptions | false | undefined): ResolvedRetry {
  if (override === false) return { ...base, attempts: 0 };
  if (!override) return base;
  return {
    attempts: override.attempts ?? base.attempts,
    delay: override.delay !== undefined ? toMs(override.delay) : base.delay,
    maxDelay: override.maxDelay !== undefined ? toMs(override.maxDelay) : base.maxDelay,
  };
}

function serialize(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (Array.isArray(value)) {
    const parts = value.map(serialize).filter((part): part is string => part !== undefined);
    return parts.length ? parts.join(",") : undefined;
  }
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

/** Combines the caller's signal with a timeout. */
function withTimeout(signal: AbortSignal | undefined | null, ms: number): { signal: AbortSignal; timedOut: () => boolean; done: () => void } {
  const controller = new AbortController();
  let timedOut = false;
  const timer = ms > 0 && Number.isFinite(ms) ? setTimeout(() => ((timedOut = true), controller.abort()), ms) : undefined;
  const onAbort = () => controller.abort(signal!.reason);
  if (signal?.aborted) controller.abort(signal.reason);
  else signal?.addEventListener("abort", onAbort, { once: true });
  return {
    signal: controller.signal,
    timedOut: () => timedOut,
    done: () => {
      if (timer) clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
    },
  };
}

/**
 * The request pipeline shared by every resource: credentials, cache, quota,
 * timeout, retries and error mapping.
 *
 * @internal
 */
export class Rest {
  readonly events = new Emitter<ClientEvents>();
  readonly quota: QuotaTracker;
  readonly oauth: OAuth2 | undefined;
  readonly options: RestOptions;

  readonly #fetch: typeof fetch;
  readonly #timeout: number;
  readonly #retry: ResolvedRetry;
  readonly #cache: { store: CacheStore; ttl: number; methods: Record<string, Duration | false> } | undefined;
  readonly #inflight = new Map<string, Promise<unknown>>();
  readonly #identities = new Map<string, string>();

  constructor(options: RestOptions, shared?: Rest) {
    this.options = options;
    const custom = options.fetch;
    if (typeof (custom ?? globalThis.fetch) !== "function") {
      throw new YouTubeArgumentError("No fetch implementation found. Use Node.js 20 or newer, or pass one with the `fetch` option.");
    }
    // Always called as a plain function: a native fetch refuses to run as a method of another object.
    this.#fetch = custom ? (input, init) => custom(input, init) : (input, init) => globalThis.fetch(input, init);
    this.#timeout = toMs(options.timeout ?? "30s");
    this.#retry = resolveRetry({ attempts: 3, delay: 500, maxDelay: 30_000 }, options.retry);
    this.oauth = options.oauth;

    if (shared) {
      // A derived client keeps counting against the same quota and cache.
      this.quota = shared.quota;
      this.events = shared.events;
      this.#cache = shared.#cache;
    } else {
      this.quota = new QuotaTracker(options.quota);
      if (options.cache) {
        const config: CacheOptions = options.cache === true ? {} : options.cache;
        this.#cache = {
          store: config.store ?? new MemoryCache(config.max),
          ttl: toMs(config.ttl ?? "5m"),
          methods: config.methods ?? {},
        };
      }
    }
  }

  get fetch(): typeof fetch {
    return this.#fetch;
  }

  get cacheStore(): CacheStore | undefined {
    return this.#cache?.store;
  }

  /**
   * Access token for a call, refreshed if needed. Undefined when there is
   * none. With `required` false, an OAuth client that has no usable token yet
   * also gives undefined, so a public read can go out with the API key.
   */
  async accessToken(options?: RequestOptions, required = true): Promise<string | undefined> {
    if (options?.accessToken) return options.accessToken;
    if (this.oauth) {
      if (!required && this.oauth.isExpired && !this.oauth.canRefresh) return undefined;
      return this.oauth.getAccessToken();
    }
    const provider = this.options.accessToken;
    if (typeof provider === "function") return provider();
    return provider;
  }

  buildUrl(spec: MethodSpec, query: Params, pathParams: Params, base?: string): string {
    const path = spec.path.replace(/\{\+?(\w+)\}/g, (_, name: string) => {
      const value = serialize(pathParams[name]);
      if (value === undefined) throw new YouTubeArgumentError(`${spec.id}: missing required parameter "${name}".`);
      // `{+name}` keeps slashes, as in a media resource name.
      return _.startsWith("{+") ? encodeURI(value) : encodeURIComponent(value);
    });
    const root = base ?? (spec.api === "data" ? (this.options.baseUrl ?? BASE_URLS.data) : BASE_URLS[spec.api]);
    const url = new URL(path, root.endsWith("/") ? root : `${root}/`);
    for (const [name, raw] of Object.entries(query)) {
      const value = serialize(raw);
      if (value !== undefined) url.searchParams.set(name, value);
    }
    return url.toString();
  }

  /** Splits the flat params object into path, query, body and media. */
  split(spec: MethodSpec, params: Params): { query: Params; path: Params; body: unknown; media: MediaInput | undefined } {
    const { body, media, ...rest } = params;
    const query: Params = {};
    const path: Params = {};
    const inPath = new Set([...spec.path.matchAll(/\{\+?(\w+)\}/g)].map((match) => match[1]));
    for (const [name, value] of Object.entries(rest)) {
      if (inPath.has(name)) path[name] = value;
      else query[name] = value;
    }
    if (this.options.onBehalfOfContentOwner && spec.owner && query.onBehalfOfContentOwner === undefined) {
      query.onBehalfOfContentOwner = this.options.onBehalfOfContentOwner;
    }
    return { query, path, body, media: media as MediaInput | undefined };
  }

  /** Whether an API key can never be enough for this call. */
  #needsOAuth(spec: MethodSpec, query: Params): boolean {
    if (spec.auth === "oauth" || spec.api !== "data") return true;
    return USER_PARAMS.some((name) => query[name] !== undefined && query[name] !== false);
  }

  /** Fails fast, before any quota is spent, when the credentials cannot possibly work. */
  async #headers(spec: MethodSpec, query: Params, options: RequestOptions | undefined): Promise<{ headers: Record<string, string>; token: string | undefined }> {
    const headers: Record<string, string> = { accept: "application/json" };
    // Lower-cased, so a header given by the caller and one set here are the same key.
    for (const source of [this.options.headers, options?.headers]) {
      for (const [name, value] of Object.entries(source ?? {})) headers[name.toLowerCase()] = value;
    }
    const needsOAuth = this.#needsOAuth(spec, query);
    // A token sees everything a key sees plus the user's private data, so it
    // wins when both are set. Without a usable token, a public read falls back on the key.
    const token = await this.accessToken(options, needsOAuth || !this.options.apiKey);

    if (token) {
      const granted = this.oauth?.grantedScopes;
      const lacking = granted !== undefined && spec.scopes.length > 0 && !options?.accessToken && !spec.scopes.some((scope) => granted.has(scope));
      if (!lacking) {
        headers.authorization = `Bearer ${token}`;
        return { headers, token };
      }
      // A public read does not need the user: it goes out with the key instead.
      if (needsOAuth || !this.options.apiKey) {
        throw new YouTubeAuthError(
          "INSUFFICIENT_SCOPE",
          `${spec.id} needs one of these scopes: ${spec.scopes.join(", ")}. The current token only has: ${[...granted!].join(", ") || "none"}. Send the user through the consent screen again with the missing scope.`,
          { scopes: spec.scopes },
        );
      }
    }
    if (needsOAuth) {
      const why = spec.auth === "oauth" || spec.api !== "data" ? "always needs OAuth 2.0" : "needs OAuth 2.0 with the parameters you passed";
      throw new YouTubeAuthError(
        "MISSING_CREDENTIALS",
        `${spec.id} ${why}. An API key only reads public data. Pass \`oauth\` or \`accessToken\` to the client${spec.scopes.length ? ` (accepted scopes: ${spec.scopes.join(", ")})` : ""}.`,
        { scopes: spec.scopes },
      );
    }
    if (!this.options.apiKey) {
      throw new YouTubeAuthError("MISSING_CREDENTIALS", `${spec.id} needs credentials. Pass \`apiKey\`, \`accessToken\` or \`oauth\` to the client, or set the YOUTUBE_API_KEY environment variable.`);
    }
    headers["x-goog-api-key"] = this.options.apiKey;
    return { headers, token: undefined };
  }

  /**
   * Who a cached response belongs to: a digest of the whole token, so two
   * users can never share an entry and no part of a token reaches the store.
   * Undefined when the runtime cannot hash, in which case nothing is cached.
   */
  async #identity(accessToken: string | undefined, options: RequestOptions | undefined): Promise<string | undefined> {
    if (accessToken === undefined) return "key";
    // The refresh token outlives the access tokens: keyed on it, a user's entries survive a refresh.
    const token = (!options?.accessToken && this.oauth?.tokens.refreshToken) || accessToken;
    const known = this.#identities.get(token);
    if (known) return known;
    const subtle = globalThis.crypto?.subtle;
    if (!subtle) return undefined;
    const digest = await subtle.digest("SHA-256", new TextEncoder().encode(token));
    const id = `user:${[...new Uint8Array(digest).subarray(0, 16)].map((byte) => byte.toString(16).padStart(2, "0")).join("")}`;
    if (this.#identities.size >= 256) this.#identities.clear();
    this.#identities.set(token, id);
    return id;
  }

  /** A cache that fails must never fail the call it was meant to speed up. */
  async #cacheGet(key: string): Promise<CacheEntry | undefined> {
    try {
      return await this.#cache!.store.get(key);
    } catch (error) {
      this.events.emit("error", error);
      return undefined;
    }
  }

  async #cacheSet(key: string, entry: CacheEntry): Promise<void> {
    try {
      await this.#cache!.store.set(key, entry);
    } catch (error) {
      this.events.emit("error", error);
    }
  }

  /** Runs one API method. */
  async request<T>(spec: MethodSpec, params: Params = {}, options?: RequestOptions): Promise<T> {
    const { query, path, body, media } = this.split(spec, params);
    if (options?.fields) query.fields = options.fields;
    const quotaUser = options?.quotaUser ?? this.options.quotaUser;
    if (quotaUser) query.quotaUser = quotaUser;

    const { headers, token } = await this.#headers(spec, query, options);

    if (media !== undefined) {
      if (!spec.upload) throw new YouTubeArgumentError(`${spec.id} does not accept a media upload.`);
      return this.#budgeted(spec, () => this.#upload<T>(spec, query, path, body, media, headers, options));
    }

    const url = this.buildUrl(spec, query, path);
    if (spec.verb !== "GET") {
      return this.#budgeted(spec, () => this.#send<T>(spec, url, headers, body, options));
    }

    const identity = await this.#identity(headers.authorization ? token : undefined, options);
    const cacheKey = `${identity}:${url}`;
    const ttl = identity === undefined ? false : this.#ttlFor(spec, options);
    if (ttl !== false && this.#cache) {
      const entry = await this.#cacheGet(cacheKey);
      if (entry && entry.expires > Date.now()) {
        this.events.emit("response", { method: spec.id, status: 200, duration: 0, cached: true, cost: 0, bucket: spec.bucket });
        return entry.value as T;
      }
      if (entry?.etag) headers["if-none-match"] = entry.etag;
    }

    // Identical reads fired at the same time share one request.
    const shareable = identity !== undefined && !options?.signal;
    const pending = shareable ? this.#inflight.get(cacheKey) : undefined;
    if (pending) return pending as Promise<T>;

    const run = this.#budgeted(spec, () => this.#send<T>(spec, url, headers, undefined, options, ttl === false ? undefined : { key: cacheKey, ttl }));
    if (shareable) {
      this.#inflight.set(cacheKey, run);
      const clear = () => this.#inflight.delete(cacheKey);
      run.then(clear, clear);
    }
    return run;
  }

  /** Holds the cost of a call against the budget while it is in flight, so parallel calls cannot overspend. */
  async #budgeted<T>(spec: MethodSpec, run: () => Promise<T>): Promise<T> {
    const release = this.quota.reserve(spec.id, spec.bucket, spec.quota);
    try {
      return await run();
    } finally {
      release();
    }
  }

  /**
   * Sends an authorized request and hands back the raw response, for bodies
   * that are streamed or are not JSON. `url` replaces the method's own URL
   * when the API gave one (a report's download link, for instance). One
   * attempt, no timeout: the body can be long or endless, and the caller
   * decides when to give up through `signal`.
   */
  async raw(spec: MethodSpec, params: Params, options?: RequestOptions, url?: string): Promise<Response> {
    const { query, path } = this.split(spec, params);
    const { headers } = await this.#headers(spec, query, options);
    const target = url ?? this.buildUrl(spec, query, path);
    return this.#budgeted(spec, async () => {
      const started = Date.now();
      this.events.emit("request", { method: spec.id, verb: spec.verb, url: redactUrl(target), attempt: 0 });
      let response: Response;
      try {
        response = await this.#fetch(target, { method: spec.verb, headers, signal: options?.signal ?? null });
      } catch (cause) {
        if (options?.signal?.aborted) throw new YouTubeRequestError("ABORTED", spec.id, "the request was aborted.", { cause });
        throw new YouTubeRequestError("NETWORK", spec.id, `network failure (${(cause as Error)?.message ?? cause}).`, { cause });
      }
      if (!response.ok) {
        const error = this.#toError(spec, target, response, await response.text().catch(() => ""));
        if (response.status >= 400 && response.status < 500 && response.status !== 401 && error.code !== "QUOTA_EXCEEDED") {
          this.events.emit("quota", this.quota.charge(spec.id, spec.bucket, 1));
        }
        throw error;
      }
      this.#account(spec, response.status, started);
      return response;
    });
  }

  #ttlFor(spec: MethodSpec, options: RequestOptions | undefined): number | false {
    if (!this.#cache || options?.cache === false) return false;
    if (options?.cache !== undefined) return toMs(options.cache);
    const perMethod = this.#cache.methods[spec.id];
    if (perMethod === false) return false;
    return perMethod !== undefined ? toMs(perMethod) : this.#cache.ttl;
  }

  async #upload<T>(
    spec: MethodSpec,
    query: Params,
    path: Params,
    body: unknown,
    media: MediaInput,
    headers: Record<string, string>,
    options: RequestOptions | undefined,
  ): Promise<T> {
    const started = Date.now();
    const base = (spec.api === "data" ? (this.options.baseUrl ?? BASE_URLS.data) : BASE_URLS[spec.api]).replace(/\/$/, "");
    const url = this.buildUrl({ ...spec, path: spec.upload!.path.replace(/^\//, "") }, query, path, base);
    this.events.emit("request", { method: spec.id, verb: spec.verb, url: redactUrl(url), attempt: 0 });
    const result = await upload<T>({
      fetch: this.#fetch,
      method: spec.id,
      verb: spec.verb,
      url,
      headers,
      metadata: body,
      media,
      accept: spec.upload!.accept,
      maxSize: spec.upload!.maxSize,
      signal: options?.signal,
      retry: resolveRetry(this.#retry, options?.retry),
      parseError: (response, text) => {
        const error = this.#toError(spec, url, response, text);
        // A rejected request is still billed, at least one unit.
        if (response.status >= 400 && response.status < 500 && response.status !== 401 && error.code !== "QUOTA_EXCEEDED") {
          this.events.emit("quota", this.quota.charge(spec.id, spec.bucket, 1));
        }
        return error;
      },
    });
    this.#account(spec, 200, started);
    return result;
  }

  async #send<T>(
    spec: MethodSpec,
    url: string,
    headers: Record<string, string>,
    body: unknown,
    options: RequestOptions | undefined,
    cache?: { key: string; ttl: number },
  ): Promise<T> {
    const retry = resolveRetry(this.#retry, options?.retry);
    const timeout = options?.timeout !== undefined ? toMs(options.timeout) : this.#timeout;
    const init: RequestInit = { method: spec.verb, headers };
    if (body !== undefined) {
      headers["content-type"] = "application/json";
      init.body = JSON.stringify(body);
    }
    let refreshed = false;

    for (let attempt = 0; ; attempt++) {
      const started = Date.now();
      const guard = withTimeout(options?.signal, timeout);
      let failure: Error | undefined;
      let retryable = false;
      let wait: number | undefined;
      let response: Response | undefined;
      let text = "";
      let value: T | undefined;

      // Only what touches the network sits in this block: anything thrown
      // here is a transport problem. The response is dealt with after it.
      try {
        this.events.emit("request", { method: spec.id, verb: spec.verb, url: redactUrl(url), attempt });
        response = await this.#fetch(url, { ...init, signal: guard.signal });
        if (response.ok) value = await this.#parse<T>(spec, response);
        else if (response.status !== 304) text = await response.text().catch(() => "");
      } catch (error) {
        if (error instanceof YouTubeRequestError) throw error;
        if (guard.timedOut()) {
          failure = new YouTubeRequestError("TIMEOUT", spec.id, `no response after ${timeout} ms.`, { cause: error });
        } else if (options?.signal?.aborted) {
          throw new YouTubeRequestError("ABORTED", spec.id, "the request was aborted.", { cause: error });
        } else {
          failure = new YouTubeRequestError("NETWORK", spec.id, `network failure (${(error as Error)?.message ?? error}).`, { cause: error });
        }
        // Nothing says whether a write got through, so only reads are replayed.
        retryable = spec.verb === "GET";
      } finally {
        guard.done();
      }

      if (!failure && response) {
        if (response.ok) {
          this.#account(spec, response.status, started);
          if (cache && this.#cache) {
            await this.#cacheSet(cache.key, { value, etag: response.headers.get("etag") ?? undefined, expires: Date.now() + cache.ttl });
          }
          return value as T;
        }

        if (response.status === 304) {
          const entry = cache && this.#cache ? await this.#cacheGet(cache.key) : undefined;
          if (entry) {
            await this.#cacheSet(cache!.key, { ...entry, expires: Date.now() + cache!.ttl });
            this.#account(spec, 304, started);
            return entry.value as T;
          }
          // The entry was evicted while the request was out: ask again for the full answer.
          if (headers["if-none-match"]) {
            delete headers["if-none-match"];
            attempt--;
            continue;
          }
        }

        const error = this.#toError(spec, url, response, text);
        // A rejected request is still billed, at least one unit.
        if (response.status >= 400 && response.status < 500 && response.status !== 401 && error.code !== "QUOTA_EXCEEDED") {
          this.events.emit("quota", this.quota.charge(spec.id, spec.bucket, 1));
        }
        if (response.status === 401 && this.oauth && !refreshed && !options?.accessToken && this.oauth.canRefresh) {
          refreshed = true;
          headers.authorization = `Bearer ${await this.oauth.refresh()}`;
          attempt--;
          continue;
        }
        failure = error;
        // A rate limit means the call was not processed, so anything can be
        // replayed. A server error says nothing about a write: only reads are.
        retryable = error.code === "RATE_LIMITED" || (spec.verb === "GET" && response.status >= 500);
        wait = error.retryAfter !== undefined ? error.retryAfter * 1000 : undefined;
        // Waiting longer than the caller allowed would hold the call hostage.
        if (wait !== undefined && wait > retry.maxDelay) retryable = false;
      }

      if (!failure) failure = new YouTubeRequestError("NETWORK", spec.id, "no response.");
      if (!retryable || attempt >= retry.attempts) throw failure;
      const backoff = Math.min(retry.maxDelay, retry.delay * 2 ** attempt);
      // Jitter keeps a fleet of clients from retrying in step.
      const delay = Math.round(wait ?? backoff / 2 + Math.random() * (backoff / 2));
      this.events.emit("retry", { method: spec.id, attempt: attempt + 1, delay, error: failure });
      try {
        await sleep(delay, options?.signal);
      } catch (error) {
        throw new YouTubeRequestError("ABORTED", spec.id, "the request was aborted.", { cause: error });
      }
    }
  }

  #account(spec: MethodSpec, status: number, started: number): void {
    this.events.emit("quota", this.quota.charge(spec.id, spec.bucket, spec.quota));
    this.events.emit("response", { method: spec.id, status, duration: Date.now() - started, cached: false, cost: spec.quota, bucket: spec.bucket });
  }

  async #parse<T>(spec: MethodSpec, response: Response): Promise<T> {
    if (spec.response === "none" || response.status === 204) {
      void response.body?.cancel().catch(() => {});
      return undefined as T;
    }
    const text = await response.text();
    if (spec.response === "text") return text as T;
    if (!text) return undefined as T;
    try {
      return JSON.parse(text) as T;
    } catch (cause) {
      throw new YouTubeRequestError("PARSE_ERROR", spec.id, "the response is not valid JSON.", { cause });
    }
  }

  #toError(spec: MethodSpec, url: string, response: Response, text: string): YouTubeApiError {
    let body: unknown = text;
    let message = response.statusText || `HTTP ${response.status}`;
    let errors: ApiErrorDetail[] = [];
    let apiStatus: string | undefined;
    let reason: string | undefined;
    try {
      const parsed = JSON.parse(text) as { error?: { message?: string; errors?: ApiErrorDetail[]; status?: string; details?: Array<{ reason?: string }> } | string; error_description?: string };
      body = parsed;
      if (typeof parsed.error === "object" && parsed.error) {
        message = parsed.error.message ?? message;
        errors = parsed.error.errors ?? [];
        apiStatus = parsed.error.status;
        reason = errors[0]?.reason;
        for (const detail of parsed.error.details ?? []) {
          const mapped = detail.reason && ERROR_INFO_REASONS[detail.reason];
          if (mapped) reason = mapped;
        }
      } else if (typeof parsed.error === "string") {
        message = parsed.error_description ?? parsed.error;
      }
    } catch {
      // Not JSON: keep the status text.
    }
    return new YouTubeApiError({
      status: response.status,
      message,
      method: spec.id,
      url: redactUrl(url),
      reason,
      errors,
      apiStatus,
      retryAfter: retryAfterSeconds(response.headers.get("retry-after")),
      body,
    });
  }
}

export type { UploadProgress };
