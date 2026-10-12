import { YouTubeQuotaBudgetError } from "./errors.js";

/**
 * Quota buckets. Since June 2026 `search.list`, `videos.insert` and
 * `videos.batchGetStats` are charged to their own bucket; every other Data API
 * method shares `default`. Analytics and Reporting calls are counted for
 * information only, Google does not bill them in units.
 */
export type QuotaBucket = "default" | "search.list" | "videos.insert" | "videos.batchGetStats" | "analytics" | "reporting";

/** Daily allocation of a new Google Cloud project, per bucket. */
export const DEFAULT_QUOTA_LIMITS: Readonly<Record<QuotaBucket, number>> = Object.freeze({
  default: 10_000,
  "search.list": 100,
  "videos.insert": 100,
  "videos.batchGetStats": 10_000,
  analytics: Number.POSITIVE_INFINITY,
  reporting: Number.POSITIVE_INFINITY,
});

/** Quota settings of the client. */
export interface QuotaOptions {
  /** Daily limits of your project, when they differ from the defaults. */
  limits?: Partial<Record<QuotaBucket, number>> | undefined;
  /**
   * Refuse a call that would go over a limit, before it is sent. The call
   * throws a `YouTubeQuotaBudgetError` and costs nothing. Off by default.
   */
  enforce?: boolean | undefined;
  /** Usage saved earlier with `yt.quota.snapshot()`, to carry the count across restarts. */
  restore?: QuotaSnapshot | undefined;
}

/** Serializable usage, see {@link QuotaTracker.snapshot}. */
export interface QuotaSnapshot {
  /** Pacific Time day the usage belongs to, `YYYY-MM-DD`. */
  day: string;
  usage: Partial<Record<QuotaBucket, number>>;
  methods: Record<string, number>;
}

/** Payload of the client's `quota` event. */
export interface QuotaEvent {
  method: string;
  bucket: QuotaBucket;
  cost: number;
  used: number;
  remaining: number;
}

const PACIFIC = "America/Los_Angeles";
// Built on first use: importing the package then has no effect of its own.
let dayFormat: Intl.DateTimeFormat | undefined;
let clockFormat: Intl.DateTimeFormat | undefined;

function pacificDay(now: number): string {
  dayFormat ??= new Intl.DateTimeFormat("en-CA", { timeZone: PACIFIC, year: "numeric", month: "2-digit", day: "2-digit" });
  return dayFormat.format(now);
}

function secondsIntoPacificDay(now: number): number {
  clockFormat ??= new Intl.DateTimeFormat("en-GB", { timeZone: PACIFIC, hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" });
  const [h = 0, m = 0, s = 0] = clockFormat.format(now).split(":").map(Number);
  return h * 3600 + m * 60 + s;
}

/** Next midnight Pacific Time, when YouTube resets daily quotas. */
export function nextQuotaReset(now: number = Date.now()): Date {
  const startOfSecond = now - (now % 1000);
  let reset = startOfSecond + (86_400 - secondsIntoPacificDay(startOfSecond)) * 1000;
  // A daylight saving switch makes the day 23 or 25 hours long.
  const drift = secondsIntoPacificDay(reset);
  if (drift !== 0) reset += drift > 43_200 ? (86_400 - drift) * 1000 : -drift * 1000;
  return new Date(reset);
}

/**
 * Counts the quota this client spends. Available as `yt.quota`.
 *
 * The count is local: it knows what this client sent, not what other processes
 * using the same project spent. Persist it with {@link snapshot} if you restart
 * often.
 *
 * @example
 * await yt.search.list({ part: "snippet", q: "lofi" });
 * yt.quota.used;                     // 0, search has its own bucket
 * yt.quota.usage["search.list"];     // 1
 * yt.quota.remaining("search.list"); // 99
 */
export class QuotaTracker {
  #day: string;
  #usage: Partial<Record<QuotaBucket, number>> = {};
  #methods: Record<string, number> = {};
  #pending: Partial<Record<QuotaBucket, number>> = {};
  readonly #limits: Record<QuotaBucket, number>;
  readonly #enforce: boolean;

  constructor(options: QuotaOptions = {}) {
    this.#limits = { ...DEFAULT_QUOTA_LIMITS, ...options.limits };
    this.#enforce = options.enforce ?? false;
    this.#day = pacificDay(Date.now());
    if (options.restore) this.restore(options.restore);
  }

  #roll(): void {
    const today = pacificDay(Date.now());
    if (today !== this.#day) {
      this.#day = today;
      this.#usage = {};
      this.#methods = {};
    }
  }

  /** Units spent today in the shared `default` bucket. */
  get used(): number {
    this.#roll();
    return this.#usage.default ?? 0;
  }

  /** Units spent today, per bucket. */
  get usage(): Readonly<Partial<Record<QuotaBucket, number>>> {
    this.#roll();
    return { ...this.#usage };
  }

  /** Units spent today, per method, for example `{ "videos.list": 12 }`. */
  get byMethod(): Readonly<Record<string, number>> {
    this.#roll();
    return { ...this.#methods };
  }

  /** Daily limits in effect, per bucket. */
  get limits(): Readonly<Record<QuotaBucket, number>> {
    return { ...this.#limits };
  }

  /** When the counters reset: the next midnight Pacific Time. */
  get resetsAt(): Date {
    return nextQuotaReset();
  }

  /** Units left today in a bucket. */
  remaining(bucket: QuotaBucket = "default"): number {
    this.#roll();
    return Math.max(0, this.#limits[bucket] - (this.#usage[bucket] ?? 0));
  }

  /** Whether a call of `cost` units still fits in the bucket, next to the calls already in flight. */
  canAfford(cost: number, bucket: QuotaBucket = "default"): boolean {
    return this.remaining(bucket) - (this.#enforce ? (this.#pending[bucket] ?? 0) : 0) >= cost;
  }

  /** Usage as plain data, to store and give back through the `quota.restore` option. */
  snapshot(): QuotaSnapshot {
    this.#roll();
    return { day: this.#day, usage: { ...this.#usage }, methods: { ...this.#methods } };
  }

  /** Loads a snapshot. One taken on another Pacific day than today is ignored. */
  restore(snapshot: QuotaSnapshot): void {
    this.#roll();
    if (snapshot.day !== this.#day) return;
    this.#usage = { ...snapshot.usage };
    this.#methods = { ...snapshot.methods };
  }

  /** Clears the counters. */
  reset(): void {
    this.#usage = {};
    this.#methods = {};
  }

  /**
   * @internal Sets the cost of a call aside while it is in flight and returns
   * the function that gives it back. Throws when the budget is enforced and
   * the call does not fit next to the ones already under way.
   */
  reserve(method: string, bucket: QuotaBucket, cost: number): () => void {
    if (!this.#enforce) return () => {};
    const remaining = this.remaining(bucket) - (this.#pending[bucket] ?? 0);
    if (cost > remaining) throw new YouTubeQuotaBudgetError(method, bucket, cost, Math.max(0, remaining), this.resetsAt);
    this.#pending[bucket] = (this.#pending[bucket] ?? 0) + cost;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.#pending[bucket] = (this.#pending[bucket] ?? 0) - cost;
    };
  }

  /** @internal */
  charge(method: string, bucket: QuotaBucket, cost: number): QuotaEvent {
    this.#roll();
    const used = (this.#usage[bucket] ?? 0) + cost;
    this.#usage[bucket] = used;
    this.#methods[method] = (this.#methods[method] ?? 0) + cost;
    return { method, bucket, cost, used, remaining: Math.max(0, this.#limits[bucket] - used) };
  }
}
