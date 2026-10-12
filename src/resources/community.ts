import type { YouTube } from "../client.js";
import { YouTubeArgumentError } from "../core/errors.js";
import type { ListRequest } from "../core/pagination.js";
import type { RequestOptions, Rest } from "../core/rest.js";
import { METHODS } from "../generated/methods.js";
import type { CommentThreadsListParams, CommentsListParams, SearchListParams } from "../generated/params.js";
import { CommentThreadsApi, CommentsApi, SearchApi, SubscriptionsApi } from "../generated/resources.js";
import type {
  Comment,
  CommentListResponse,
  CommentPart,
  CommentThread,
  CommentThreadListResponse,
  CommentThreadPart,
  SearchListResponse,
  SearchResult,
  Subscription,
} from "../generated/schemas.js";
import { videoIdFrom } from "../utils/ids.js";
import type { PartOptions } from "./channels.js";

/** A search result known to be a video. */
export type VideoSearchResult = SearchResult<"snippet"> & { id: { kind: "youtube#video"; videoId: string } };
/** A search result known to be a channel. */
export type ChannelSearchResult = SearchResult<"snippet"> & { id: { kind: "youtube#channel"; channelId: string } };
/** A search result known to be a playlist. */
export type PlaylistSearchResult = SearchResult<"snippet"> & { id: { kind: "youtube#playlist"; playlistId: string } };

/** Every search filter except the query, the part and the result type, which the helpers set. */
export type SearchFilters = Omit<SearchListParams<"snippet">, "part" | "q" | "type">;

function requireVideoId(video: string): string {
  const id = videoIdFrom(video);
  if (!id) throw new YouTubeArgumentError(`"${video}" is neither a video id nor a video URL.`);
  return id;
}

/**
 * `yt.search`: the raw `search.list`, plus one helper per result type whose
 * results are typed accordingly.
 *
 * Search draws from its own quota bucket: 100 calls a day by default. When a
 * cheaper method answers the question (a channel's uploads, a playlist's
 * videos, a video by id), use it. Each helper costs 1 call of that bucket per
 * page of 50 results. An empty query lists without search terms.
 */
export class Search extends SearchApi {
  /**
   * Searches videos. `result.id.videoId` is always set on the results.
   *
   * @example
   * const results = await yt.search.videos("lofi hip hop", { order: "viewCount", videoDuration: "long" }).take(10);
   * const videos = await yt.videos.getMany(results.map((result) => result.id.videoId));
   */
  videos(query: string, filters: SearchFilters = {}, options?: RequestOptions): ListRequest<VideoSearchResult, SearchListResponse> {
    return this._list(METHODS["search.list"], { ...filters, part: "snippet", q: query || undefined, type: "video" }, options, true) as ListRequest<VideoSearchResult, SearchListResponse>;
  }

  /**
   * Searches channels. `result.id.channelId` is always set on the results.
   *
   * @example
   * const [first] = await yt.search.channels("Google for Developers").take(1);
   */
  channels(query: string, filters: SearchFilters = {}, options?: RequestOptions): ListRequest<ChannelSearchResult, SearchListResponse> {
    return this._list(METHODS["search.list"], { ...filters, part: "snippet", q: query || undefined, type: "channel" }, options, true) as ListRequest<ChannelSearchResult, SearchListResponse>;
  }

  /**
   * Searches playlists. `result.id.playlistId` is always set on the results.
   *
   * @example
   * const playlists = await yt.search.playlists("typescript course").take(5);
   */
  playlists(query: string, filters: SearchFilters = {}, options?: RequestOptions): ListRequest<PlaylistSearchResult, SearchListResponse> {
    return this._list(METHODS["search.list"], { ...filters, part: "snippet", q: query || undefined, type: "playlist" }, options, true) as ListRequest<PlaylistSearchResult, SearchListResponse>;
  }

  /**
   * Lists the broadcasts that are live right now for a query or a channel.
   *
   * @example
   * const live = await yt.search.live("speedrun", { channelId }).take(5);
   */
  live(query: string, filters: Omit<SearchFilters, "eventType"> = {}, options?: RequestOptions): ListRequest<VideoSearchResult, SearchListResponse> {
    return this._list(METHODS["search.list"], { ...filters, part: "snippet", q: query || undefined, type: "video", eventType: "live" }, options, true) as ListRequest<VideoSearchResult, SearchListResponse>;
  }
}

/** `yt.commentThreads`: the raw methods, plus shortcuts for the comments of a video. */
export class CommentThreads extends CommentThreadsApi {
  /**
   * Lists the comment threads of a video. Ask for the `replies` part to get
   * up to five replies with each thread.
   *
   * Quota: 1 unit per page of 100.
   *
   * @example
   * for await (const thread of yt.commentThreads.forVideo(videoId, { order: "relevance" })) {
   *   const comment = thread.snippet.topLevelComment.snippet;
   *   console.log(comment?.authorDisplayName, comment?.textDisplay);
   * }
   */
  forVideo<P extends CommentThreadPart = "snippet">(
    video: string,
    options: PartOptions<P> & Pick<CommentThreadsListParams, "order" | "searchTerms" | "textFormat" | "moderationStatus" | "maxResults"> = {},
  ): ListRequest<CommentThread<P>, CommentThreadListResponse> {
    const { part = "snippet" as P, order, searchTerms, textFormat, moderationStatus, maxResults, ...request } = options;
    return this._list(METHODS["commentThreads.list"], { part, videoId: requireVideoId(video), order, searchTerms, textFormat, moderationStatus, maxResults }, request, true);
  }

  /**
   * Posts a top-level comment on a video.
   *
   * Quota: 50 units.
   *
   * @example
   * await yt.commentThreads.post(videoId, "Great video!");
   */
  post(video: string, text: string, options?: RequestOptions): Promise<CommentThread<"snippet">> {
    return this.insert({ part: "snippet", body: { snippet: { videoId: requireVideoId(video), topLevelComment: { snippet: { textOriginal: text } } } } }, options);
  }
}

/** `yt.comments`: the raw methods, plus shortcuts for replies. */
export class Comments extends CommentsApi {
  /**
   * Lists every reply to a top-level comment. `commentThreads` only inlines
   * the first five.
   *
   * Quota: 1 unit per page of 100.
   *
   * @example
   * const replies = await yt.comments.replies(thread.id).all();
   */
  replies<P extends CommentPart = "snippet">(
    parentId: string,
    options: PartOptions<P> & Pick<CommentsListParams, "textFormat" | "maxResults"> = {},
  ): ListRequest<Comment<P>, CommentListResponse> {
    const { part = "snippet" as P, textFormat, maxResults, ...request } = options;
    return this._list(METHODS["comments.list"], { part, parentId, textFormat, maxResults }, request, true);
  }

  /**
   * Replies to a comment. `parentId` is the id of the top-level comment, which
   * is also the id of its thread.
   *
   * Quota: 50 units.
   *
   * @example
   * await yt.comments.reply(thread.id, "Thanks!");
   */
  reply(parentId: string, text: string, options?: RequestOptions): Promise<Comment<"snippet">> {
    return this.insert({ part: "snippet", body: { snippet: { parentId, textOriginal: text } } }, options);
  }

  /** Replaces the text of one of your comments. Quota: 50 units. */
  edit(commentId: string, text: string, options?: RequestOptions): Promise<Comment<"snippet">> {
    return this.update({ part: "snippet", body: { id: commentId, snippet: { textOriginal: text } } }, options);
  }
}

/** `yt.subscriptions`: the raw methods, plus subscribe and unsubscribe by channel. */
export class Subscriptions extends SubscriptionsApi {
  readonly #yt: YouTube;

  /** @internal */
  constructor(rest: Rest, yt: YouTube) {
    super(rest);
    this.#yt = yt;
  }

  async #channelId(channel: string, options?: RequestOptions): Promise<string> {
    const id = await this.#yt.channels.resolveId(channel, options);
    if (!id) throw new YouTubeArgumentError(`No channel found for "${channel}".`);
    return id;
  }

  /**
   * Finds the authenticated user's subscription to a channel, or `null` when
   * they are not subscribed.
   *
   * Quota: 1 unit, plus 1 to resolve a handle the first time.
   *
   * @example
   * const subscribed = (await yt.subscriptions.to("@GoogleDevelopers")) !== null;
   */
  async to(channel: string, options?: RequestOptions): Promise<Subscription<"snippet"> | null> {
    const forChannelId = await this.#channelId(channel, options);
    return (await this.list({ part: "snippet", mine: true, forChannelId }, options).first()) ?? null;
  }

  /**
   * Subscribes the authenticated user to a channel.
   *
   * Quota: 50 units, plus 1 to resolve a handle the first time.
   *
   * @example
   * await yt.subscriptions.subscribe("@GoogleDevelopers");
   */
  async subscribe(channel: string, options?: RequestOptions): Promise<Subscription<"snippet">> {
    const channelId = await this.#channelId(channel, options);
    return this.insert({ part: "snippet", body: { snippet: { resourceId: { kind: "youtube#channel", channelId } } } }, options);
  }

  /**
   * Unsubscribes the authenticated user from a channel. Resolves to `false`
   * when they were not subscribed.
   *
   * Quota: 1 unit to find the subscription, 50 to delete it.
   */
  async unsubscribe(channel: string, options?: RequestOptions): Promise<boolean> {
    const subscription = await this.to(channel, options);
    if (!subscription) return false;
    await this.delete({ id: subscription.id }, options);
    return true;
  }
}
