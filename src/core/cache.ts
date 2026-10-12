import type { Duration } from "./time.js";

/** What the client stores for one cached response. */
export interface CacheEntry {
  /** Parsed response body. */
  value: unknown;
  /** ETag of the response, used to revalidate once the entry is stale. */
  etag?: string | undefined;
  /** Timestamp (ms) after which the entry is stale. */
  expires: number;
}

/**
 * Where cached responses live. The built-in store keeps them in memory;
 * implement this interface to back the cache with Redis, a KV namespace or a
 * file. Methods may be synchronous or return promises.
 */
export interface CacheStore {
  get(key: string): CacheEntry | undefined | Promise<CacheEntry | undefined>;
  set(key: string, entry: CacheEntry): void | Promise<void>;
  delete(key: string): void | Promise<void>;
  clear?(): void | Promise<void>;
}

/** Cache settings of the client. */
export interface CacheOptions {
  /** How long a response stays fresh. Default `"5m"`. */
  ttl?: Duration | undefined;
  /** Entries kept by the in-memory store before the oldest is dropped. Default 500. */
  max?: number | undefined;
  /** Custom storage. */
  store?: CacheStore | undefined;
  /**
   * Fine-grained freshness per method, for example
   * `{ "videoCategories.list": "1d", "search.list": "1h", "videos.list": false }`.
   */
  methods?: Record<string, Duration | false> | undefined;
}

/** In-memory store that drops the least recently used entry once full. */
export class MemoryCache implements CacheStore {
  readonly #entries = new Map<string, CacheEntry>();
  readonly #max: number;

  constructor(max = 500) {
    this.#max = Math.max(1, max);
  }

  get size(): number {
    return this.#entries.size;
  }

  get(key: string): CacheEntry | undefined {
    const entry = this.#entries.get(key);
    if (!entry) return undefined;
    // Re-insert to mark the entry as recently used.
    this.#entries.delete(key);
    this.#entries.set(key, entry);
    return entry;
  }

  set(key: string, entry: CacheEntry): void {
    this.#entries.delete(key);
    this.#entries.set(key, entry);
    if (this.#entries.size > this.#max) {
      const oldest = this.#entries.keys().next().value;
      if (oldest !== undefined) this.#entries.delete(oldest);
    }
  }

  delete(key: string): void {
    this.#entries.delete(key);
  }

  clear(): void {
    this.#entries.clear();
  }
}
