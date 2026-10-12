import type { YouTube } from "../client.js";
import { YouTubeArgumentError, isYouTubeError } from "../core/errors.js";
import type { ListRequest } from "../core/pagination.js";
import type { OneOrMany } from "../core/resource.js";
import type { RequestOptions, Rest } from "../core/rest.js";
import { METHODS } from "../generated/methods.js";
import type { ChannelsListParams } from "../generated/params.js";
import { ChannelsApi } from "../generated/resources.js";
import type { Channel, ChannelPart, PlaylistItem, PlaylistItemListResponse, PlaylistItemPart, Video, VideoPart } from "../generated/schemas.js";
import { type ChannelPlaylistKind, type ChannelRef, channelPlaylistId, parseChannelRef } from "../utils/ids.js";
import type { DefaultVideoPart } from "./videos.js";

/** Parts fetched by the channel helpers when you do not choose. */
export type DefaultChannelPart = "snippet" | "contentDetails" | "statistics";

/** Options shared by the helpers that fetch a resource: which parts, plus the usual request options. */
export interface PartOptions<P extends string> extends RequestOptions {
  /** Parts to fetch. The result type follows this list. */
  part?: OneOrMany<P>;
}

const DEFAULT_PARTS: readonly DefaultChannelPart[] = ["snippet", "contentDetails", "statistics"];

/**
 * `yt.channels`: the raw `channels` methods, plus helpers that accept a
 * channel in any form: an id, an `@handle`, a legacy username or a URL.
 */
export class Channels extends ChannelsApi {
  readonly #yt: YouTube;
  readonly #ids = new Map<string, string>();

  /** @internal */
  constructor(rest: Rest, yt: YouTube) {
    super(rest);
    this.#yt = yt;
  }

  #filters(ref: ChannelRef, input: string): Array<Pick<ChannelsListParams, "id" | "forHandle" | "forUsername">> {
    switch (ref.by) {
      case "id":
        return [{ id: ref.value }];
      case "handle":
        // A bare name is most likely a handle, but old accounts still answer to a username.
        return input.trim().startsWith("@") || /[/.]/.test(input) ? [{ forHandle: ref.value }] : [{ forHandle: ref.value }, { forUsername: input.trim() }];
      case "username":
        return [{ forUsername: ref.value }];
      case "custom":
        // The API has no lookup for /c/name URLs. The name usually survives as the handle.
        return [{ forHandle: `@${ref.value}` }, { forUsername: ref.value }];
    }
  }

  /**
   * Fetches one channel from an id, an `@handle`, a legacy username or any
   * channel URL. Resolves to `null` when no channel matches.
   *
   * Quota: 1 unit, 2 when a bare name has to be tried as a handle and then as a username.
   *
   * @example
   * const channel = await yt.channels.get("@GoogleDevelopers");
   * if (channel) console.log(channel.snippet.title, channel.statistics.subscriberCount);
   *
   * // Only what you need:
   * const slim = await yt.channels.get("https://www.youtube.com/@GoogleDevelopers", { part: "snippet" });
   */
  async get<P extends ChannelPart = DefaultChannelPart>(channel: string, options: PartOptions<P> = {}): Promise<Channel<P> | null> {
    const { part = DEFAULT_PARTS as readonly ChannelPart[] as readonly P[], ...request } = options;
    for (const filter of this.#filters(parseChannelRef(channel), channel)) {
      const found = await this.list({ part, ...filter }, request).first();
      if (found) {
        this.#ids.set(channel.trim().toLowerCase(), (found as { id: string }).id);
        return found;
      }
    }
    return null;
  }

  /**
   * Fetches the channel of the authenticated user. Needs OAuth. Resolves to
   * `null` for a Google account that has no YouTube channel.
   *
   * @example
   * const me = await yt.channels.mine();
   */
  async mine<P extends ChannelPart = DefaultChannelPart>(options: PartOptions<P> = {}): Promise<Channel<P> | null> {
    const { part = DEFAULT_PARTS as readonly ChannelPart[] as readonly P[], ...request } = options;
    return (await this.list({ part, mine: true }, request).first()) ?? null;
  }

  /**
   * Turns any channel reference into its `UC...` id. Ids and `/channel/` URLs
   * cost nothing; handles and usernames cost 1 unit the first time and are
   * remembered afterwards.
   *
   * @example
   * await yt.channels.resolveId("@GoogleDevelopers"); // "UC_x5XG1OV2P6uZZ5FSM9Ttw"
   */
  async resolveId(channel: string, options: RequestOptions = {}): Promise<string | null> {
    const ref = parseChannelRef(channel);
    if (ref.by === "id") return ref.value;
    const key = channel.trim().toLowerCase();
    const known = this.#ids.get(key);
    if (known) return known;
    const found = await this.get(channel, { ...options, part: "id" });
    return found?.id ?? null;
  }

  async #requireId(channel: string, options?: RequestOptions): Promise<string> {
    const id = await this.resolveId(channel, options);
    if (!id) throw new YouTubeArgumentError(`No channel found for "${channel}".`);
    return id;
  }

  /**
   * Lists what a channel uploaded, newest first, by reading its uploads
   * playlist: 1 unit for 50 videos, where a search would spend the scarce
   * search bucket. `kind` narrows the list to regular videos, Shorts or live
   * streams.
   *
   * A channel that never uploaded has no such playlist: the request then
   * fails with a `NOT_FOUND` error.
   *
   * @example
   * for await (const item of yt.channels.uploads("@GoogleDevelopers")) {
   *   console.log(item.contentDetails.videoId, item.snippet.title);
   * }
   *
   * const lastTenShorts = await yt.channels.uploads(channelId, { kind: "shorts" }).take(10);
   */
  uploads<P extends PlaylistItemPart = "snippet" | "contentDetails">(
    channel: string,
    options: PartOptions<P> & { kind?: ChannelPlaylistKind } = {},
  ): ListRequest<PlaylistItem<P>, PlaylistItemListResponse> {
    const { part = ["snippet", "contentDetails"] as readonly PlaylistItemPart[] as readonly P[], kind, ...request } = options;
    return this._list(METHODS["playlistItems.list"], async () => ({ part, playlistId: channelPlaylistId(await this.#requireId(channel, request), kind) }), request);
  }

  /**
   * Fetches the most recent videos of a channel as full video resources, with
   * durations and statistics. Resolves to an empty array for a channel
   * without uploads.
   *
   * Quota: 2 units for up to 50 videos, plus 1 to resolve a handle the first time.
   *
   * @example
   * const videos = await yt.channels.latestVideos("@GoogleDevelopers", { limit: 3 });
   * for (const video of videos) console.log(video.snippet.title, video.statistics.viewCount);
   */
  async latestVideos<P extends VideoPart = DefaultVideoPart>(
    channel: string,
    options: PartOptions<P> & { limit?: number; kind?: ChannelPlaylistKind } = {},
  ): Promise<Video<P>[]> {
    const { limit = 5, kind, part, ...request } = options;
    let items: PlaylistItem<"contentDetails">[];
    try {
      items = await this.uploads(channel, { ...request, part: "contentDetails", ...(kind ? { kind } : {}) }).take(limit);
    } catch (error) {
      if (isYouTubeError(error, "NOT_FOUND")) return [];
      throw error;
    }
    return this.#yt.videos.getMany<P>(
      items.map((item) => item.contentDetails.videoId),
      { ...request, ...(part !== undefined ? { part } : {}) },
    );
  }

  /**
   * Fetches the latest video of a channel, or `null` when it has none.
   *
   * @example
   * const video = await yt.channels.latestVideo("@GoogleDevelopers");
   * if (video) console.log(`New video: ${video.snippet.title}`);
   */
  async latestVideo<P extends VideoPart = DefaultVideoPart>(channel: string, options: PartOptions<P> & { kind?: ChannelPlaylistKind } = {}): Promise<Video<P> | null> {
    const [video] = await this.latestVideos<P>(channel, { ...options, limit: 1 });
    return video ?? null;
  }
}
