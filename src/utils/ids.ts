import { YouTubeArgumentError } from "../core/errors.js";

/** What a YouTube URL points to, see {@link parseUrl}. */
export type YouTubeLink =
  | {
      type: "video";
      videoId: string;
      /** How the video was linked. */
      format: "watch" | "short" | "live" | "embed";
      /** Playlist the link plays the video in, when there is one. */
      playlistId?: string;
      /** Start offset in seconds, from `t` or `start`. */
      start?: number;
    }
  | { type: "playlist"; playlistId: string }
  | {
      type: "channel";
      /** Set for `/channel/UC...` links. */
      channelId?: string;
      /** Set for `/@handle` links, with the leading `@`. */
      handle?: string;
      /** Set for legacy `/user/name` links. */
      username?: string;
      /** Set for legacy `/c/name` links. The API cannot look these up directly. */
      customUrl?: string;
    };

const HOSTS = /^(?:(?:www|m|music|gaming)\.)?(?:youtube\.com|youtube-nocookie\.com)$/i;
const VIDEO_ID = /^[\w-]{11}$/;
const CHANNEL_ID = /^UC[\w-]{22}$/;
const PLAYLIST_ID = /^(?:PL|UU|LL|FL|RD|OL|WL|EL|TL)[\w-]*$/;
const RESERVED = new Set(["watch", "playlist", "feed", "results", "shorts", "live", "embed", "channel", "user", "c", "v", "e", "gaming", "premium", "music", "about", "account", "t", "s", "hashtag", "post", "clip", "source", "attribution_link", "redirect", "oembed"]);

/** Whether a string looks like a video id (11 URL-safe characters). */
export function isVideoId(value: string): boolean {
  return VIDEO_ID.test(value);
}

/** Whether a string looks like a channel id (`UC` followed by 22 characters). */
export function isChannelId(value: string): boolean {
  return CHANNEL_ID.test(value);
}

/** Whether a string looks like a playlist id. */
export function isPlaylistId(value: string): boolean {
  return PLAYLIST_ID.test(value) && value.length >= 2 && !VIDEO_ID.test(value);
}

function seconds(value: string | null): number | undefined {
  if (!value) return undefined;
  if (/^\d+s?$/.test(value)) return Number.parseInt(value, 10);
  const match = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/.exec(value);
  if (!match || !match[0]) return undefined;
  return Number(match[1] ?? 0) * 3600 + Number(match[2] ?? 0) * 60 + Number(match[3] ?? 0);
}

/**
 * Reads a YouTube URL. Understands watch pages, `youtu.be` short links,
 * Shorts, live and embed URLs, playlists, and every channel URL style.
 * Returns `null` for anything that is not a YouTube link.
 *
 * @example
 * parseUrl("https://youtu.be/dQw4w9WgXcQ?t=42");
 * // { type: "video", videoId: "dQw4w9WgXcQ", format: "watch", start: 42 }
 *
 * parseUrl("https://www.youtube.com/@GoogleDevelopers/videos");
 * // { type: "channel", handle: "@GoogleDevelopers" }
 */
export function parseUrl(input: string): YouTubeLink | null {
  let url: URL;
  try {
    url = new URL(/^[a-z][a-z\d+.-]*:\/\//i.test(input) ? input : `https://${input}`);
  } catch {
    return null;
  }
  const host = url.hostname.toLowerCase();
  let segments: string[];
  try {
    segments = url.pathname.split("/").filter(Boolean).map((segment) => decodeURIComponent(segment));
  } catch {
    return null;
  }
  const list = url.searchParams.get("list") ?? undefined;
  const start = seconds(url.searchParams.get("t") ?? url.searchParams.get("start"));

  const video = (videoId: string | undefined, format: "watch" | "short" | "live" | "embed"): YouTubeLink | null => {
    if (!videoId || !VIDEO_ID.test(videoId)) return null;
    return { type: "video", videoId, format, ...(list ? { playlistId: list } : {}), ...(start !== undefined ? { start } : {}) };
  };

  if (host === "youtu.be") return video(segments[0], "watch");
  if (!HOSTS.test(host)) return null;

  const [first, second] = segments;
  if (first === "watch") return video(url.searchParams.get("v") ?? undefined, "watch");
  if (first === "shorts") return video(second, "short");
  if (first === "live") return video(second, "live");
  if (first === "embed" && second === "videoseries") return list ? { type: "playlist", playlistId: list } : null;
  if (first === "embed" || first === "v" || first === "e") return video(second, "embed");
  if (first === "playlist") return list ? { type: "playlist", playlistId: list } : null;
  if (first === "channel") return second && CHANNEL_ID.test(second) ? { type: "channel", channelId: second } : null;
  if (first === "user") return second ? { type: "channel", username: second } : null;
  if (first === "c") return second ? { type: "channel", customUrl: second } : null;
  if (first?.startsWith("@") && first.length > 1) return { type: "channel", handle: first };
  // youtube.com/SomeName is the oldest custom URL style.
  if (first && segments.length <= 2 && !RESERVED.has(first.toLowerCase())) return { type: "channel", customUrl: first };
  return null;
}

/**
 * Extracts a video id from an id or any video URL. Returns `null` when there
 * is none.
 *
 * @example
 * videoIdFrom("https://www.youtube.com/shorts/abcdefghijk"); // "abcdefghijk"
 * videoIdFrom("dQw4w9WgXcQ");                                // "dQw4w9WgXcQ"
 */
export function videoIdFrom(input: string): string | null {
  const value = input.trim();
  if (VIDEO_ID.test(value)) return value;
  const link = parseUrl(value);
  return link?.type === "video" ? link.videoId : null;
}

/** Extracts a playlist id from an id or a URL that carries a `list` parameter. */
export function playlistIdFrom(input: string): string | null {
  const value = input.trim();
  if (!/[/.?]/.test(value) && isPlaylistId(value)) return value;
  const link = parseUrl(value);
  if (link?.type === "playlist") return link.playlistId;
  if (link?.type === "video" && link.playlistId) return link.playlistId;
  return null;
}

/** A way to designate a channel, see {@link parseChannelRef}. */
export type ChannelRef =
  | { by: "id"; value: string }
  | { by: "handle"; value: string }
  | { by: "username"; value: string }
  | { by: "custom"; value: string };

/**
 * Works out what a channel reference is: an id, a handle, a legacy username or
 * a URL of any style.
 *
 * @example
 * parseChannelRef("@GoogleDevelopers");                       // { by: "handle", value: "@GoogleDevelopers" }
 * parseChannelRef("https://youtube.com/channel/UC_x5XG1OV2P6uZZ5FSM9Ttw"); // { by: "id", ... }
 */
export function parseChannelRef(input: string): ChannelRef {
  const value = input.trim();
  if (!value) throw new YouTubeArgumentError("Expected a channel id, a handle or a channel URL, got an empty string.");
  if (CHANNEL_ID.test(value)) return { by: "id", value };
  if (value.startsWith("@")) return { by: "handle", value };
  if (/[/.]/.test(value)) {
    const link = parseUrl(value);
    if (link?.type === "channel") {
      if (link.channelId) return { by: "id", value: link.channelId };
      if (link.handle) return { by: "handle", value: link.handle };
      if (link.username) return { by: "username", value: link.username };
      if (link.customUrl) return { by: "custom", value: link.customUrl };
    }
    throw new YouTubeArgumentError(`"${input}" is not a channel URL.`);
  }
  // A bare name: handles are by far the most common today.
  return { by: "handle", value: `@${value}` };
}

/** The kinds of auto-generated playlists every channel has. */
export type ChannelPlaylistKind =
  | "uploads"
  | "videos"
  | "shorts"
  | "live"
  | "popularVideos"
  | "popularShorts"
  | "popularLive"
  | "membersOnlyVideos";

const PLAYLIST_PREFIX: Record<ChannelPlaylistKind, string> = {
  uploads: "UU",
  videos: "UULF",
  shorts: "UUSH",
  live: "UULV",
  popularVideos: "UULP",
  popularShorts: "UUPS",
  popularLive: "UUPV",
  membersOnlyVideos: "UUMO",
};

/**
 * Derives the id of one of a channel's auto-generated playlists, without any
 * API call. Reading that playlist with `playlistItems.list` costs 1 unit for
 * 50 videos, where a search would use the scarce search bucket.
 *
 * `uploads` is documented by YouTube (it is `contentDetails.relatedPlaylists.uploads`).
 * The other kinds are not documented but have been stable for years: `videos`
 * leaves out Shorts and live streams, `shorts` and `live` keep only those.
 *
 * @example
 * channelPlaylistId("UC_x5XG1OV2P6uZZ5FSM9Ttw");           // "UU_x5XG1OV2P6uZZ5FSM9Ttw"
 * channelPlaylistId("UC_x5XG1OV2P6uZZ5FSM9Ttw", "shorts"); // "UUSH_x5XG1OV2P6uZZ5FSM9Ttw"
 */
export function channelPlaylistId(channelId: string, kind: ChannelPlaylistKind = "uploads"): string {
  if (!CHANNEL_ID.test(channelId)) throw new YouTubeArgumentError(`"${channelId}" is not a channel id (expected "UC" followed by 22 characters).`);
  return PLAYLIST_PREFIX[kind] + channelId.slice(2);
}

/** Options of {@link urls.video}. */
export interface VideoUrlOptions {
  /** Start offset in seconds. */
  start?: number;
  /** Plays the video inside this playlist. */
  playlistId?: string;
  /** Uses the short `youtu.be` domain. */
  short?: boolean;
}

/** Options of {@link urls.embed}. */
export interface EmbedUrlOptions {
  start?: number;
  end?: number;
  autoplay?: boolean;
  mute?: boolean;
  loop?: boolean;
  controls?: boolean;
  /** Serves the player from `youtube-nocookie.com`, which sets no cookie until playback. */
  noCookie?: boolean;
  /** Interface language of the player, for example `"fr"`. */
  hl?: string;
}

/** Thumbnail sizes YouTube generates for every video. `maxres` is missing on older or low-resolution uploads. */
export type ThumbnailQuality = "default" | "medium" | "high" | "standard" | "maxres";

const THUMBNAIL_FILE: Record<ThumbnailQuality, string> = {
  default: "default",
  medium: "mqdefault",
  high: "hqdefault",
  standard: "sddefault",
  maxres: "maxresdefault",
};

/**
 * Builds YouTube URLs.
 *
 * @example
 * urls.video("dQw4w9WgXcQ", { start: 42 }); // "https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=42s"
 * urls.channel("@GoogleDevelopers");        // "https://www.youtube.com/@GoogleDevelopers"
 * urls.thumbnail("dQw4w9WgXcQ", "maxres");  // "https://i.ytimg.com/vi/dQw4w9WgXcQ/maxresdefault.jpg"
 */
export const urls = Object.freeze({
  /** Watch page of a video. */
  video(videoId: string, options: VideoUrlOptions = {}): string {
    const url = new URL(options.short ? `https://youtu.be/${videoId}` : "https://www.youtube.com/watch");
    if (!options.short) url.searchParams.set("v", videoId);
    if (options.playlistId) url.searchParams.set("list", options.playlistId);
    if (options.start) url.searchParams.set("t", `${Math.floor(options.start)}s`);
    return url.toString();
  },
  /** Shorts player for a video. */
  short(videoId: string): string {
    return `https://www.youtube.com/shorts/${videoId}`;
  },
  /** Page of a channel, from its id or its `@handle`. */
  channel(channel: string): string {
    return channel.startsWith("@") ? `https://www.youtube.com/${channel}` : `https://www.youtube.com/channel/${channel}`;
  },
  /** Page of a playlist. */
  playlist(playlistId: string): string {
    return `https://www.youtube.com/playlist?list=${encodeURIComponent(playlistId)}`;
  },
  /** URL for an `<iframe>` player. */
  embed(videoId: string, options: EmbedUrlOptions = {}): string {
    const url = new URL(`https://www.${options.noCookie ? "youtube-nocookie" : "youtube"}.com/embed/${videoId}`);
    if (options.start) url.searchParams.set("start", String(Math.floor(options.start)));
    if (options.end) url.searchParams.set("end", String(Math.floor(options.end)));
    if (options.autoplay) url.searchParams.set("autoplay", "1");
    if (options.mute) url.searchParams.set("mute", "1");
    if (options.controls === false) url.searchParams.set("controls", "0");
    if (options.hl) url.searchParams.set("hl", options.hl);
    if (options.loop) {
      // The player only loops when it has a playlist, even of one video.
      url.searchParams.set("loop", "1");
      url.searchParams.set("playlist", videoId);
    }
    return url.toString();
  },
  /** Thumbnail image of a video, without any API call. */
  thumbnail(videoId: string, quality: ThumbnailQuality = "high"): string {
    return `https://i.ytimg.com/vi/${videoId}/${THUMBNAIL_FILE[quality]}.jpg`;
  },
});
