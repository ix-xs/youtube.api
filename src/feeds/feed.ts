import { YouTubeArgumentError, YouTubeRequestError } from "../core/errors.js";
import { type Duration, toMs } from "../core/time.js";
import { isChannelId, isPlaylistId } from "../utils/ids.js";
import { type XmlNode, child, children, parseXml, textOf } from "../utils/xml.js";

/** One video of a feed. */
export interface FeedEntry {
  videoId: string;
  channelId: string;
  title: string;
  /** Link to the video. Shorts link to the Shorts player. */
  url: string;
  /** Whether the entry links to the Shorts player. */
  isShort: boolean;
  author: { name: string; url: string | undefined };
  /** ISO 8601 date the video went public. */
  publishedAt: string;
  /** ISO 8601 date of the last change to the entry. */
  updatedAt: string;
  description: string;
  thumbnail: { url: string; width: number | undefined; height: number | undefined } | undefined;
  /** View count at the time the feed was generated. Feeds lag behind the API by a few minutes. */
  views: number | undefined;
  /** Number of likes at the time the feed was generated. */
  likes: number | undefined;
}

/** A channel or playlist feed. */
export interface Feed {
  title: string;
  /** Set for channel feeds. */
  channelId: string | undefined;
  /** Set for playlist feeds. */
  playlistId: string | undefined;
  /** Page of the channel or playlist. */
  url: string | undefined;
  author: { name: string; url: string | undefined } | undefined;
  /** The 15 most recent videos, newest first. */
  entries: FeedEntry[];
}

/** Options of {@link fetchFeed}. */
export interface FeedOptions {
  signal?: AbortSignal;
  /** Default `"15s"`. */
  timeout?: Duration;
  /** Custom `fetch`. */
  fetch?: typeof fetch;
}

function number(value: string | undefined): number | undefined {
  const parsed = Number(value);
  return value !== undefined && value !== "" && Number.isFinite(parsed) ? parsed : undefined;
}

function link(node: XmlNode | undefined, rel: string): string | undefined {
  return children(node, "link").find((candidate) => candidate.attributes.rel === rel)?.attributes.href;
}

function author(node: XmlNode | undefined): { name: string; url: string | undefined } | undefined {
  const element = child(node, "author");
  return element ? { name: textOf(element, "name") ?? "", url: textOf(element, "uri") } : undefined;
}

/** @internal */
export function parseEntry(entry: XmlNode, fallbackChannelId = ""): FeedEntry | undefined {
  const videoId = textOf(entry, "yt:videoId") ?? textOf(entry, "id")?.replace(/^yt:video:/, "");
  if (!videoId) return undefined;
  const group = child(entry, "media:group");
  const community = child(group, "media:community");
  const thumbnail = child(group, "media:thumbnail");
  const url = link(entry, "alternate") ?? `https://www.youtube.com/watch?v=${videoId}`;
  const publishedAt = textOf(entry, "published") ?? "";
  return {
    videoId,
    channelId: textOf(entry, "yt:channelId") ?? fallbackChannelId,
    title: textOf(entry, "title") ?? textOf(group, "media:title") ?? "",
    url,
    isShort: url.includes("/shorts/"),
    author: author(entry) ?? { name: "", url: undefined },
    publishedAt,
    updatedAt: textOf(entry, "updated") ?? publishedAt,
    description: child(group, "media:description")?.text.trim() ?? "",
    thumbnail: thumbnail?.attributes.url
      ? { url: thumbnail.attributes.url, width: number(thumbnail.attributes.width), height: number(thumbnail.attributes.height) }
      : undefined,
    views: number(child(community, "media:statistics")?.attributes.views),
    likes: number(child(community, "media:starRating")?.attributes.count),
  };
}

/**
 * Parses the XML of a YouTube feed.
 *
 * @example
 * const feed = parseFeed(await response.text());
 */
export function parseFeed(xml: string): Feed {
  const root = child(parseXml(xml), "feed");
  if (!root) throw new YouTubeArgumentError("This document is not an Atom feed.");
  const rawChannelId = textOf(root, "yt:channelId");
  // Older feeds give the channel id without its "UC" prefix.
  const channelId = rawChannelId ? (rawChannelId.startsWith("UC") ? rawChannelId : `UC${rawChannelId}`) : undefined;
  return {
    title: textOf(root, "title") ?? "",
    channelId,
    playlistId: textOf(root, "yt:playlistId"),
    url: link(root, "alternate"),
    author: author(root),
    entries: children(root, "entry")
      .map((entry) => parseEntry(entry, channelId))
      .filter((entry): entry is FeedEntry => entry !== undefined),
  };
}

/** URL of the public feed of a channel (`UC...`) or a playlist. */
export function feedUrl(id: string): string {
  if (isChannelId(id)) return `https://www.youtube.com/feeds/videos.xml?channel_id=${id}`;
  if (isPlaylistId(id)) return `https://www.youtube.com/feeds/videos.xml?playlist_id=${encodeURIComponent(id)}`;
  throw new YouTubeArgumentError(`"${id}" is neither a channel id nor a playlist id. Feeds need an id: resolve a handle with yt.channels.resolveId() first.`);
}

/**
 * Reads the public feed of a channel or a playlist: its 15 most recent
 * videos, with no API key and no quota.
 *
 * The feed is a convenience YouTube does not guarantee. It lags a few minutes
 * behind uploads and has had outages where every feed answers 404 for hours.
 * A failure throws a `FEED_UNAVAILABLE` error; it does not mean the channel
 * is gone. For something dependable, read the uploads playlist through the
 * API (`yt.channels.uploads()`), or let `yt.watch()` fall back for you.
 *
 * @example
 * const feed = await fetchFeed("UC_x5XG1OV2P6uZZ5FSM9Ttw");
 * console.log(feed.title, feed.entries[0]?.title);
 */
export async function fetchFeed(id: string, options: FeedOptions = {}): Promise<Feed> {
  const url = feedUrl(id);
  const fetchImpl = options.fetch ?? globalThis.fetch;
  const controller = new AbortController();
  const timeout = toMs(options.timeout ?? "15s");
  let timedOut = false;
  const timer = setTimeout(() => ((timedOut = true), controller.abort()), timeout);
  const onAbort = () => controller.abort(options.signal?.reason);
  if (options.signal?.aborted) controller.abort(options.signal.reason);
  else options.signal?.addEventListener("abort", onAbort, { once: true });
  try {
    const response = await fetchImpl(url, { signal: controller.signal, headers: { accept: "application/atom+xml, application/xml;q=0.9" } });
    if (!response.ok) {
      void response.body?.cancel().catch(() => {});
      throw new YouTubeRequestError(
        "FEED_UNAVAILABLE",
        "feed",
        response.status === 404
          ? `YouTube answered 404 for the feed of ${id}. Either the id is wrong, or the feed service is having one of its outages.`
          : `YouTube answered ${response.status} for the feed of ${id}.`,
      );
    }
    return parseFeed(await response.text());
  } catch (error) {
    if (error instanceof YouTubeRequestError || error instanceof YouTubeArgumentError) throw error;
    if (options.signal?.aborted) throw new YouTubeRequestError("ABORTED", "feed", "the request was aborted.", { cause: error });
    if (timedOut) throw new YouTubeRequestError("TIMEOUT", "feed", `no response after ${timeout} ms.`, { cause: error });
    throw new YouTubeRequestError("FEED_UNAVAILABLE", "feed", `could not fetch the feed of ${id} (${(error as Error)?.message ?? error}).`, { cause: error });
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener("abort", onAbort);
  }
}

/** What YouTube's oEmbed endpoint says about a video or a playlist. */
export interface OEmbed {
  title: string;
  authorName: string;
  /** Page of the channel. */
  authorUrl: string;
  type: "video" | "rich";
  /** Ready-to-use `<iframe>` markup. */
  html: string;
  width: number;
  height: number;
  thumbnailUrl: string;
  thumbnailWidth: number;
  thumbnailHeight: number;
}

/**
 * Fetches the title, author, thumbnail and embed code of a video or playlist
 * URL, with no API key and no quota. Resolves to `null` when the video does
 * not exist, is private, or cannot be embedded, which also makes this a free
 * existence check.
 *
 * @example
 * const info = await oEmbed("https://youtu.be/dQw4w9WgXcQ");
 * console.log(info?.title, info?.authorName);
 */
export async function oEmbed(url: string, options: FeedOptions & { maxWidth?: number; maxHeight?: number } = {}): Promise<OEmbed | null> {
  const endpoint = new URL("https://www.youtube.com/oembed");
  endpoint.searchParams.set("url", /^[\w-]{11}$/.test(url) ? `https://www.youtube.com/watch?v=${url}` : url);
  endpoint.searchParams.set("format", "json");
  if (options.maxWidth) endpoint.searchParams.set("maxwidth", String(options.maxWidth));
  if (options.maxHeight) endpoint.searchParams.set("maxheight", String(options.maxHeight));
  const fetchImpl = options.fetch ?? globalThis.fetch;
  let response: Response;
  try {
    response = await fetchImpl(endpoint, { signal: options.signal ?? AbortSignal.timeout(toMs(options.timeout ?? "15s")) });
  } catch (cause) {
    throw new YouTubeRequestError(options.signal?.aborted ? "ABORTED" : "NETWORK", "oembed", `could not reach YouTube (${(cause as Error)?.message ?? cause}).`, { cause });
  }
  if ([400, 401, 403, 404].includes(response.status)) {
    void response.body?.cancel().catch(() => {});
    return null;
  }
  if (!response.ok) throw new YouTubeRequestError("NETWORK", "oembed", `YouTube answered ${response.status}.`);
  const data = (await response.json()) as Record<string, string | number>;
  return {
    title: String(data.title ?? ""),
    authorName: String(data.author_name ?? ""),
    authorUrl: String(data.author_url ?? ""),
    type: data.type === "rich" ? "rich" : "video",
    html: String(data.html ?? ""),
    width: Number(data.width ?? 0),
    height: Number(data.height ?? 0),
    thumbnailUrl: String(data.thumbnail_url ?? ""),
    thumbnailWidth: Number(data.thumbnail_width ?? 0),
    thumbnailHeight: Number(data.thumbnail_height ?? 0),
  };
}
