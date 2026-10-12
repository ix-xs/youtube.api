import type { YouTube } from "../client.js";
import { YouTubeArgumentError } from "../core/errors.js";
import type { ListRequest } from "../core/pagination.js";
import type { RequestOptions, Rest } from "../core/rest.js";
import { METHODS } from "../generated/methods.js";
import { PlaylistsApi } from "../generated/resources.js";
import type { Playlist, PlaylistItem, PlaylistItemListResponse, PlaylistItemPart, PlaylistPart, Video, VideoPart } from "../generated/schemas.js";
import { playlistIdFrom, videoIdFrom } from "../utils/ids.js";
import type { PartOptions } from "./channels.js";
import type { DefaultVideoPart } from "./videos.js";

/** Parts fetched by the playlist helpers when you do not choose. */
export type DefaultPlaylistPart = "snippet" | "contentDetails" | "status";

/** Fields of {@link Playlists.create}. */
export interface CreatePlaylistInput {
  title: string;
  description?: string | undefined;
  /** Default `"private"`. */
  privacy?: "public" | "unlisted" | "private" | undefined;
  /** Language of the title and description, for example `"en"`. */
  defaultLanguage?: string | undefined;
}

function requirePlaylistId(playlist: string): string {
  const id = playlistIdFrom(playlist);
  if (!id) throw new YouTubeArgumentError(`"${playlist}" is neither a playlist id nor a URL with a "list" parameter.`);
  return id;
}

function requireVideoId(video: string): string {
  const id = videoIdFrom(video);
  if (!id) throw new YouTubeArgumentError(`"${video}" is neither a video id nor a video URL.`);
  return id;
}

/**
 * `yt.playlists`: the raw `playlists` methods, plus helpers that accept a
 * playlist id or URL and take care of the playlist items for you.
 */
export class Playlists extends PlaylistsApi {
  readonly #yt: YouTube;

  /** @internal */
  constructor(rest: Rest, yt: YouTube) {
    super(rest);
    this.#yt = yt;
  }

  /**
   * Fetches one playlist from its id or URL. Resolves to `null` when it does
   * not exist or is private.
   *
   * Quota: 1 unit.
   *
   * @example
   * const playlist = await yt.playlists.get("PLBCF2DAC6FFB574DE");
   * if (playlist) console.log(playlist.snippet.title, playlist.contentDetails.itemCount);
   */
  async get<P extends PlaylistPart = DefaultPlaylistPart>(playlist: string, options: PartOptions<P> = {}): Promise<Playlist<P> | null> {
    const { part = ["snippet", "contentDetails", "status"] as readonly PlaylistPart[] as readonly P[], ...request } = options;
    return (await this.list({ part, id: requirePlaylistId(playlist) }, request).first()) ?? null;
  }

  /**
   * Lists the items of a playlist. Items are light: a title, a position and
   * the video id. Use {@link videos} when you need durations or statistics.
   *
   * Quota: 1 unit per page of 50.
   *
   * @example
   * for await (const item of yt.playlists.items(playlistUrl)) {
   *   console.log(item.snippet.position, item.snippet.title);
   * }
   */
  items<P extends PlaylistItemPart = "snippet" | "contentDetails">(
    playlist: string,
    options: PartOptions<P> = {},
  ): ListRequest<PlaylistItem<P>, PlaylistItemListResponse> {
    const { part = ["snippet", "contentDetails"] as readonly PlaylistItemPart[] as readonly P[], ...request } = options;
    return this._list(METHODS["playlistItems.list"], { part, playlistId: requirePlaylistId(playlist) }, request, true);
  }

  /**
   * Walks the videos of a playlist as full video resources, in playlist
   * order. Deleted and private videos are skipped, and `limit` counts the
   * videos you get, not the playlist items read.
   *
   * Quota: 2 units per 50 videos.
   *
   * @example
   * let total = 0;
   * for await (const video of yt.playlists.videos(playlistId, { part: "contentDetails" })) {
   *   total += parseDuration(video.contentDetails.duration);
   * }
   */
  async *videos<P extends VideoPart = DefaultVideoPart>(
    playlist: string,
    options: PartOptions<P> & { limit?: number | undefined } = {},
  ): AsyncGenerator<Video<P>, void, undefined> {
    const { part, limit = Number.POSITIVE_INFINITY, ...request } = options;
    if (limit <= 0) return;
    let yielded = 0;
    for await (const page of this.items(playlist, { ...request, part: "contentDetails" }).pages()) {
      const ids = page.items.map((item) => item.contentDetails.videoId);
      const found = await this.#yt.videos.getMany<P>(ids, { ...request, ...(part !== undefined ? { part } : {}) });
      const byId = new Map(found.map((video) => [(video as { id: string }).id, video]));
      // Playlist order, repeats included; what the API did not return is skipped.
      for (const id of ids) {
        const video = byId.get(id);
        if (!video) continue;
        yield video;
        if (++yielded >= limit) return;
      }
    }
  }

  /**
   * Creates a playlist on the authenticated user's channel.
   *
   * Quota: 50 units.
   *
   * @example
   * const playlist = await yt.playlists.create({ title: "Favourites", privacy: "unlisted" });
   */
  create(input: CreatePlaylistInput, options?: RequestOptions): Promise<Playlist<"snippet" | "status">> {
    const snippet: { title: string; description?: string; defaultLanguage?: string } = { title: input.title };
    if (input.description !== undefined) snippet.description = input.description;
    if (input.defaultLanguage !== undefined) snippet.defaultLanguage = input.defaultLanguage;
    return this.insert({ part: ["snippet", "status"], body: { snippet, status: { privacyStatus: input.privacy ?? "private" } } }, options);
  }

  /**
   * Adds a video to a playlist, at the end unless `position` says otherwise.
   *
   * Quota: 50 units.
   *
   * @example
   * await yt.playlists.add(playlistId, "https://youtu.be/dQw4w9WgXcQ", { position: 0 });
   */
  add(playlist: string, video: string, options: RequestOptions & { position?: number | undefined; note?: string | undefined } = {}): Promise<PlaylistItem<"snippet" | "contentDetails">> {
    const { position, note, ...request } = options;
    const snippet: Record<string, unknown> = {
      playlistId: requirePlaylistId(playlist),
      resourceId: { kind: "youtube#video", videoId: requireVideoId(video) },
    };
    if (position !== undefined) snippet.position = position;
    return this.#yt.playlistItems.insert(
      { part: ["snippet", "contentDetails"], body: { snippet, ...(note !== undefined ? { contentDetails: { note } } : {}) } },
      request,
    );
  }

  /**
   * Removes every occurrence of a video from a playlist. Resolves to the
   * number of items removed.
   *
   * Quota: 1 unit to find the items, then 50 per item removed.
   *
   * @example
   * await yt.playlists.removeVideo(playlistId, videoId);
   */
  async removeVideo(playlist: string, video: string, options?: RequestOptions): Promise<number> {
    const items = await this.#yt.playlistItems.list({ part: "id", playlistId: requirePlaylistId(playlist), videoId: requireVideoId(video) }, options).all();
    for (const item of items) await this.#yt.playlistItems.delete({ id: item.id }, options);
    return items.length;
  }
}
