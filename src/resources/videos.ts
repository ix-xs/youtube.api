import { YouTubeArgumentError } from "../core/errors.js";
import type { ListRequest } from "../core/pagination.js";
import type { RequestOptions } from "../core/rest.js";
import type { VideosListParams } from "../generated/params.js";
import { VideosApi } from "../generated/resources.js";
import type { Video, VideoListResponse, VideoPart, VideoRating } from "../generated/schemas.js";
import { videoIdFrom } from "../utils/ids.js";
import type { PartOptions } from "./channels.js";

/** Parts fetched by the video helpers when you do not choose. */
export type DefaultVideoPart = "snippet" | "contentDetails" | "statistics";

const DEFAULT_PARTS: readonly DefaultVideoPart[] = ["snippet", "contentDetails", "statistics"];

function requireVideoId(video: string): string {
  const id = videoIdFrom(video);
  if (!id) throw new YouTubeArgumentError(`"${video}" is neither a video id nor a video URL.`);
  return id;
}

/**
 * `yt.videos`: the raw `videos` methods, plus helpers that accept a video id
 * or any video URL (watch page, `youtu.be`, Shorts, live, embed).
 */
export class Videos extends VideosApi {
  /**
   * Fetches one video from its id or URL. Resolves to `null` when the video
   * does not exist or is private.
   *
   * Quota: 1 unit.
   *
   * @example
   * const video = await yt.videos.get("https://youtu.be/dQw4w9WgXcQ");
   * if (video) console.log(video.snippet.title, video.contentDetails.duration, video.statistics.viewCount);
   */
  async get<P extends VideoPart = DefaultVideoPart>(video: string, options: PartOptions<P> = {}): Promise<Video<P> | null> {
    const { part = DEFAULT_PARTS as readonly VideoPart[] as readonly P[], ...request } = options;
    return (await this.list({ part, id: requireVideoId(video) }, request).first()) ?? null;
  }

  /**
   * Fetches many videos at once, in the order you gave. Videos that do not
   * exist or are private are left out. Duplicates are fetched once.
   *
   * Quota: 1 unit per 50 videos.
   *
   * @example
   * const videos = await yt.videos.getMany(["dQw4w9WgXcQ", "https://youtu.be/9bZkp7q19f0"]);
   */
  async getMany<P extends VideoPart = DefaultVideoPart>(videos: readonly string[], options: PartOptions<P> = {}): Promise<Video<P>[]> {
    const { part = DEFAULT_PARTS as readonly VideoPart[] as readonly P[], ...request } = options;
    const ids = [...new Set(videos.map(requireVideoId))];
    if (!ids.length) return [];
    const { items } = await this.list({ part, id: ids }, request);
    const byId = new Map(items.map((item) => [item.id as string, item]));
    return ids.map((id) => byId.get(id)).filter((item): item is NonNullable<typeof item> => item !== undefined);
  }

  /**
   * Lists the most popular videos of a region, optionally within a category.
   * Since July 2025 the chart is built from the trending Music, Movies and
   * Gaming charts.
   *
   * Quota: 1 unit per page of 50.
   *
   * @example
   * const top = await yt.videos.popular({ regionCode: "FR" }).take(10);
   */
  popular<P extends VideoPart = DefaultVideoPart>(
    options: PartOptions<P> & Pick<VideosListParams, "regionCode" | "videoCategoryId" | "hl" | "maxResults"> = {},
  ): ListRequest<Video<P>, VideoListResponse> {
    const { part = DEFAULT_PARTS as readonly VideoPart[] as readonly P[], regionCode, videoCategoryId, hl, maxResults, ...request } = options;
    return this.list({ part, chart: "mostPopular", regionCode, videoCategoryId, hl, maxResults } as VideosListParams<P>, request);
  }

  /** Likes a video as the authenticated user. Quota: 50 units. */
  like(video: string, options?: RequestOptions): Promise<void> {
    return this.rate({ id: requireVideoId(video), rating: "like" }, options);
  }

  /** Dislikes a video as the authenticated user. Quota: 50 units. */
  dislike(video: string, options?: RequestOptions): Promise<void> {
    return this.rate({ id: requireVideoId(video), rating: "dislike" }, options);
  }

  /** Removes the authenticated user's like or dislike from a video. Quota: 50 units. */
  unrate(video: string, options?: RequestOptions): Promise<void> {
    return this.rate({ id: requireVideoId(video), rating: "none" }, options);
  }

  /**
   * Tells how the authenticated user rated a video.
   *
   * @example
   * if ((await yt.videos.ratingOf(videoId)) !== "like") await yt.videos.like(videoId);
   */
  async ratingOf(video: string, options?: RequestOptions): Promise<NonNullable<VideoRating["rating"]>> {
    const rating = await this.getRating({ id: requireVideoId(video) }, options).first();
    return rating?.rating ?? "none";
  }
}
