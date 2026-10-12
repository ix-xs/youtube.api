import type { MethodSpec, RequestOptions, Rest } from "./rest.js";

type Params = Record<string, unknown>;

/** Raw shape shared by the API's list responses. */
interface ListBody {
  nextPageToken?: string;
  prevPageToken?: string;
  pageInfo?: { totalResults?: number; resultsPerPage?: number };
  [key: string]: unknown;
}

/**
 * One page of results.
 *
 * @typeParam T - Item type.
 * @typeParam R - Type of the raw response body.
 */
export class Page<T, R = unknown> {
  /** Items of this page. */
  readonly items: T[];
  /** Token of the next page, when there is one. */
  readonly nextPageToken: string | undefined;
  /** Token of the previous page, when the API provides it. */
  readonly prevPageToken: string | undefined;
  /**
   * Size of the whole result set as reported by the API. It is an estimate for
   * searches and is capped at 1,000,000.
   */
  readonly totalResults: number | undefined;
  /** Items the API put in a full page. */
  readonly resultsPerPage: number | undefined;
  /** The response body as the API sent it. */
  readonly raw: R;

  readonly #fetchNext: ((token: string) => Promise<Page<T, R>>) | undefined;

  /** @internal */
  constructor(raw: R, items: T[], fetchNext?: (token: string) => Promise<Page<T, R>>) {
    const body = (raw ?? {}) as ListBody;
    this.raw = raw;
    this.items = items;
    this.nextPageToken = body.nextPageToken || undefined;
    this.prevPageToken = body.prevPageToken || undefined;
    this.totalResults = body.pageInfo?.totalResults;
    this.resultsPerPage = body.pageInfo?.resultsPerPage;
    this.#fetchNext = fetchNext;
  }

  /** Whether another page follows. */
  get hasNext(): boolean {
    return this.nextPageToken !== undefined && this.#fetchNext !== undefined;
  }

  /** Fetches the next page, or resolves to `null` on the last one. */
  async next(): Promise<Page<T, R> | null> {
    if (!this.nextPageToken || !this.#fetchNext) return null;
    return this.#fetchNext(this.nextPageToken);
  }

  /** Iterates the items of this page. */
  [Symbol.iterator](): IterableIterator<T> {
    return this.items[Symbol.iterator]();
  }
}

/** Options of {@link ListRequest.all} and {@link ListRequest.pages}. */
export interface CollectOptions {
  /**
   * Stop once this many items were fetched. Without it, every page is
   * fetched. `pages()` yields whole pages, so the last one can go past the limit.
   */
  limit?: number;
}

function chunkOf<V>(values: readonly V[], size: number): V[][] {
  const chunks: V[][] = [];
  for (let index = 0; index < values.length; index += size) chunks.push(values.slice(index, index + size));
  return chunks;
}

/**
 * What every `list` method returns. It is lazy: nothing is sent until you
 * await it or iterate it.
 *
 * - `await request` resolves to the first {@link Page}.
 * - `for await (const item of request)` walks every item of every page.
 * - `request.all({ limit })` collects items into an array.
 *
 * When walking pages without an explicit `maxResults`, the largest page size
 * the method allows is used, which is the cheapest in quota.
 *
 * Lists of ids longer than the API accepts in one call (50) are split across
 * calls for you.
 *
 * @example
 * const page = await yt.playlistItems.list({ part: "snippet", playlistId });
 * page.items;
 *
 * for await (const item of yt.playlistItems.list({ part: "snippet", playlistId })) {
 *   console.log(item.snippet.title);
 * }
 *
 * const firstHundred = await yt.playlistItems.list({ part: "snippet", playlistId }).all({ limit: 100 });
 */
export class ListRequest<T, R = unknown> implements PromiseLike<Page<T, R>>, AsyncIterable<T> {
  readonly #rest: Rest;
  readonly #spec: MethodSpec;
  readonly #source: Params | (() => Promise<Params>);
  readonly #options: RequestOptions | undefined;
  #resolved: Promise<Params> | undefined;

  /** @internal */
  constructor(rest: Rest, spec: MethodSpec, params: Params | (() => Promise<Params>), options?: RequestOptions) {
    this.#rest = rest;
    this.#spec = spec;
    this.#source = params;
    this.#options = options;
  }

  /** The parameters, once anything they depend on (a handle to resolve, for instance) is known. */
  #input(): Promise<Params> {
    this.#resolved ??= typeof this.#source === "function" ? this.#source() : Promise.resolve(this.#source);
    return this.#resolved;
  }

  #itemsOf(raw: unknown): T[] {
    return ((raw as ListBody | undefined)?.[this.#spec.items ?? "items"] as T[] | undefined) ?? [];
  }

  /** The id list split into calls, when it is longer than one call accepts. */
  #chunks(params: Params): unknown[][] | undefined {
    const chunk = this.#spec.chunk;
    if (!chunk) return undefined;
    const value = params[chunk.param];
    if (!Array.isArray(value) || value.length <= chunk.size) return undefined;
    return chunkOf([...new Set(value)], chunk.size);
  }

  /** A lookup by id returns exactly those ids: the API refuses a page size next to it. */
  #byId(params: Params): boolean {
    const chunk = this.#spec.chunk;
    return chunk !== undefined && params[chunk.param] !== undefined;
  }

  async #fetch(params: Params): Promise<Page<T, R>> {
    const raw = await this.#rest.request<R>(this.#spec, params, this.#options);
    return new Page<T, R>(raw, this.#itemsOf(raw), (pageToken) => this.#fetch({ ...params, pageToken }));
  }

  /** Page size to use while walking: the one given by the caller, or the largest allowed. */
  #walkParams(params: Params, limit: number | undefined): Params {
    const paged = this.#spec.paged;
    if (!paged || params[paged.size] !== undefined || this.#byId(params)) return params;
    const size = Math.max(paged.min ?? 1, Math.min(paged.max, limit ?? paged.max));
    return { ...params, [paged.size]: size };
  }

  /**
   * Fetches the first page. With an id list too long for one call, the calls
   * run in parallel and their items are merged into a single page.
   */
  async page(): Promise<Page<T, R>> {
    const params = await this.#input();
    const chunks = this.#chunks(params);
    if (!chunks) return this.#fetch(params);
    const param = this.#spec.chunk!.param;
    const raws: R[] = new Array(chunks.length);
    let cursor = 0;
    const worker = async () => {
      while (cursor < chunks.length) {
        const index = cursor++;
        raws[index] = await this.#rest.request<R>(this.#spec, { ...params, [param]: chunks[index] }, this.#options);
      }
    };
    await Promise.all(Array.from({ length: Math.min(4, chunks.length) }, worker));
    const items = raws.flatMap((raw) => this.#itemsOf(raw));
    return new Page<T, R>(raws[0]!, items);
  }

  /** Walks the pages one by one. */
  async *pages(options: CollectOptions = {}): AsyncGenerator<Page<T, R>, void, undefined> {
    const params = await this.#input();
    const chunks = this.#chunks(params);
    if (chunks) {
      const param = this.#spec.chunk!.param;
      for (const chunk of chunks) {
        const raw = await this.#rest.request<R>(this.#spec, { ...params, [param]: chunk }, this.#options);
        yield new Page<T, R>(raw, this.#itemsOf(raw));
      }
      return;
    }
    const limit = options.limit ?? Number.POSITIVE_INFINITY;
    if (limit <= 0) return;
    let seen = 0;
    let page: Page<T, R> | null = await this.#fetch(this.#walkParams(params, options.limit));
    while (page) {
      yield page;
      seen += page.items.length;
      // The page that reaches the limit is the last one fetched.
      if (seen >= limit) return;
      page = await page.next();
    }
  }

  /** Collects items across pages into an array. */
  async all(options: CollectOptions = {}): Promise<T[]> {
    const limit = options.limit ?? Number.POSITIVE_INFINITY;
    const out: T[] = [];
    if (limit <= 0) return out;
    for await (const page of this.pages(options)) {
      for (const item of page.items) {
        out.push(item);
        if (out.length >= limit) return out;
      }
    }
    return out;
  }

  /** Shorthand for `all({ limit })`. */
  take(limit: number): Promise<T[]> {
    return this.all({ limit });
  }

  /** Resolves to the first item, or `undefined` when there is none. */
  async first(): Promise<T | undefined> {
    const params = await this.#input();
    if (this.#chunks(params)) return (await this.page()).items[0];
    const paged = this.#spec.paged;
    // One item is enough, unless the method has a larger minimum page size.
    const sized = paged && params[paged.size] === undefined && !this.#byId(params) ? { ...params, [paged.size]: paged.min ?? 1 } : params;
    return (await this.#fetch(sized)).items[0];
  }

  async *[Symbol.asyncIterator](): AsyncGenerator<T, void, undefined> {
    for await (const page of this.pages()) yield* page.items;
  }

  then<A = Page<T, R>, B = never>(
    onfulfilled?: ((page: Page<T, R>) => A | PromiseLike<A>) | null,
    onrejected?: ((reason: unknown) => B | PromiseLike<B>) | null,
  ): Promise<A | B> {
    return this.page().then(onfulfilled, onrejected);
  }

  catch<B = never>(onrejected?: ((reason: unknown) => B | PromiseLike<B>) | null): Promise<Page<T, R> | B> {
    return this.page().catch(onrejected);
  }

  finally(onfinally?: (() => void) | null): Promise<Page<T, R>> {
    return this.page().finally(onfinally);
  }
}
