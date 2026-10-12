import { Analytics } from "./analytics.js";
import { OAuth2, type OAuth2Options } from "./auth/oauth2.js";
import type { CacheOptions } from "./core/cache.js";
import { YouTubeArgumentError } from "./core/errors.js";
import type { QuotaBucket, QuotaOptions, QuotaTracker } from "./core/quota.js";
import { type AccessTokenProvider, type ClientEvents, type RequestOptions, Rest, type RetryOptions } from "./core/rest.js";
import type { Duration } from "./core/time.js";
import { Watcher, type WatcherOptions } from "./feeds/watcher.js";
import { METHODS, type MethodId } from "./generated/methods.js";
import {
  AbuseReportsApi,
  ActivitiesApi,
  CaptionsApi,
  ChannelBannersApi,
  ChannelSectionsApi,
  I18nLanguagesApi,
  I18nRegionsApi,
  LiveBroadcastsApi,
  LiveChatBansApi,
  LiveChatModeratorsApi,
  LiveStreamsApi,
  MembersApi,
  MembershipsLevelsApi,
  PlaylistImagesApi,
  PlaylistItemsApi,
  SuperChatEventsApi,
  ThirdPartyLinksApi,
  ThumbnailsApi,
  VideoAbuseReportReasonsApi,
  VideoCategoriesApi,
  VideoTrainabilityApi,
  WatermarksApi,
} from "./generated/resources.js";
import { LiveChat, LiveChatMessages } from "./live/chat.js";
import { Reporting } from "./reporting.js";
import { Channels } from "./resources/channels.js";
import { CommentThreads, Comments, Search, Subscriptions } from "./resources/community.js";
import { Playlists } from "./resources/playlists.js";
import { Videos } from "./resources/videos.js";
import { videoIdFrom } from "./utils/ids.js";

/** Settings of the {@link YouTube} client. Every field is optional. */
export interface YouTubeOptions {
  /**
   * API key, enough to read public data. Create one in the Google Cloud
   * console under APIs & Services > Credentials, with the YouTube Data API v3
   * enabled. When left out, the `YOUTUBE_API_KEY` environment variable is used.
   */
  apiKey?: string | undefined;
  /**
   * OAuth 2.0 client that keeps tokens fresh, or the options to build one.
   * Needed for anything private or any write.
   */
  oauth?: OAuth2 | OAuth2Options | undefined;
  /**
   * A ready-made access token, or a function that returns one, when token
   * handling lives elsewhere. No automatic refresh in this mode.
   */
  accessToken?: AccessTokenProvider | undefined;
  /**
   * Caches successful reads. `true` keeps them 5 minutes in memory; an object
   * sets the freshness, a per-method policy or a custom store. Off by default.
   */
  cache?: boolean | CacheOptions | undefined;
  /** Daily limits, optional enforcement and restored usage for the quota tracker. */
  quota?: QuotaOptions | undefined;
  /** Retries on rate limits, server errors and network failures. Default: 3 retries with exponential backoff. `false` disables them. */
  retry?: RetryOptions | false | undefined;
  /**
   * Time allowed for one attempt. Default `"30s"`, and `0` turns it off.
   * Uploads, report downloads and the live chat stream are not subject to it:
   * give those a `signal`.
   */
  timeout?: Duration | undefined;
  /** Custom `fetch`, for a proxy, an instrumented client or tests. */
  fetch?: typeof fetch | undefined;
  /** Root of the Data API, to go through a proxy. Default `https://youtube.googleapis.com/`. */
  baseUrl?: string | undefined;
  /** Headers added to every request. */
  headers?: Record<string, string> | undefined;
  /** Per-user quota key sent with every request, for server apps that enforce per-user limits. */
  quotaUser?: string | undefined;
  /**
   * For YouTube content partners: the content owner requests are made on
   * behalf of. It is sent with every method that accepts it, and those calls
   * then need OAuth.
   */
  onBehalfOfContentOwner?: string | undefined;
}

function envApiKey(): string | undefined {
  const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env;
  return env?.YOUTUBE_API_KEY || undefined;
}

/**
 * The YouTube client. One instance gives access to every method of the Data
 * API v3 (live streaming included), the Analytics API and the Reporting API.
 *
 * @example
 * import { YouTube } from "@ix-xs/youtube.api";
 *
 * const yt = new YouTube({ apiKey: process.env.YOUTUBE_API_KEY });
 *
 * const channel = await yt.channels.get("@GoogleDevelopers");
 * const latest = await yt.channels.latestVideos("@GoogleDevelopers", { limit: 5 });
 *
 * // The result type follows the parts you ask for.
 * const { items } = await yt.videos.list({ part: ["snippet", "statistics"], id: "dQw4w9WgXcQ" });
 * items[0]?.statistics.viewCount; // string
 * items[0]?.contentDetails;       // compile error: that part was not requested
 *
 * @example
 * // With OAuth, for private data and writes.
 * const yt = new YouTube({
 *   oauth: { clientId, clientSecret, tokens: savedTokens, onTokens: saveTokens },
 * });
 * await yt.playlists.add(playlistId, videoId);
 */
export class YouTube {
  /** Quota spent by this client, per bucket and per method. */
  readonly quota: QuotaTracker;
  /** The OAuth 2.0 client, when the client was created with one. */
  readonly oauth: OAuth2 | undefined;

  readonly #rest: Rest;
  readonly #options: YouTubeOptions;
  readonly #resources = new Map<string, unknown>();

  /**
   * @param options - Settings, or just an API key.
   */
  constructor(options: YouTubeOptions | string = {}, /** @internal */ shared?: Rest) {
    if (options === null || (typeof options !== "string" && typeof options !== "object")) {
      throw new YouTubeArgumentError("new YouTube() takes an options object or an API key.");
    }
    const resolved: YouTubeOptions = typeof options === "string" ? { apiKey: options } : { ...options };
    // Also next to OAuth: public reads then work before the user has signed in.
    if (!resolved.apiKey) {
      const fromEnv = envApiKey();
      if (fromEnv) resolved.apiKey = fromEnv;
    }
    // An OAuth client built here goes through the same fetch as the API calls.
    const oauth =
      resolved.oauth instanceof OAuth2
        ? resolved.oauth
        : resolved.oauth
          ? new OAuth2({ ...resolved.oauth, ...(resolved.oauth.fetch ?? resolved.fetch ? { fetch: (resolved.oauth.fetch ?? resolved.fetch)! } : {}) })
          : undefined;
    this.#options = resolved;
    this.#rest = new Rest({ ...resolved, oauth }, shared);
    this.quota = this.#rest.quota;
    this.oauth = oauth;
  }

  #resource<T>(name: string, create: (rest: Rest) => T): T {
    let resource = this.#resources.get(name) as T | undefined;
    if (!resource) this.#resources.set(name, (resource = create(this.#rest)));
    return resource;
  }

  // ------------------------------------------------------------- Data API

  /** Channels: lookups by id, handle or URL, uploads, latest videos, branding updates. */
  get channels(): Channels {
    return this.#resource("channels", (rest) => new Channels(rest, this));
  }

  /** Videos: lookups, the popular chart, uploads, metadata updates, ratings. */
  get videos(): Videos {
    return this.#resource("videos", (rest) => new Videos(rest));
  }

  /** Playlists: lookups, creation, and helpers to walk or edit their content. */
  get playlists(): Playlists {
    return this.#resource("playlists", (rest) => new Playlists(rest, this));
  }

  /** The videos inside playlists. */
  get playlistItems(): PlaylistItemsApi {
    return this.#resource("playlistItems", (rest) => new PlaylistItemsApi(rest));
  }

  /** Custom thumbnail images of playlists. */
  get playlistImages(): PlaylistImagesApi {
    return this.#resource("playlistImages", (rest) => new PlaylistImagesApi(rest));
  }

  /** Search across videos, channels and playlists. */
  get search(): Search {
    return this.#resource("search", (rest) => new Search(rest));
  }

  /** Comment threads: the top-level comments of a video or a channel. */
  get commentThreads(): CommentThreads {
    return this.#resource("commentThreads", (rest) => new CommentThreads(rest));
  }

  /** Individual comments and replies, and their moderation. */
  get comments(): Comments {
    return this.#resource("comments", (rest) => new Comments(rest));
  }

  /** Subscriptions of a user and subscribers of a channel. */
  get subscriptions(): Subscriptions {
    return this.#resource("subscriptions", (rest) => new Subscriptions(rest, this));
  }

  /** Recent public actions of a channel. */
  get activities(): ActivitiesApi {
    return this.#resource("activities", (rest) => new ActivitiesApi(rest));
  }

  /** Caption tracks of videos. */
  get captions(): CaptionsApi {
    return this.#resource("captions", (rest) => new CaptionsApi(rest));
  }

  /** Channel banner uploads. */
  get channelBanners(): ChannelBannersApi {
    return this.#resource("channelBanners", (rest) => new ChannelBannersApi(rest));
  }

  /** Shelves of a channel's home tab. */
  get channelSections(): ChannelSectionsApi {
    return this.#resource("channelSections", (rest) => new ChannelSectionsApi(rest));
  }

  /** Custom video thumbnails. */
  get thumbnails(): ThumbnailsApi {
    return this.#resource("thumbnails", (rest) => new ThumbnailsApi(rest));
  }

  /** Channel watermarks. */
  get watermarks(): WatermarksApi {
    return this.#resource("watermarks", (rest) => new WatermarksApi(rest));
  }

  /** Video categories per region. */
  get videoCategories(): VideoCategoriesApi {
    return this.#resource("videoCategories", (rest) => new VideoCategoriesApi(rest));
  }

  /** Reasons accepted when reporting a video. */
  get videoAbuseReportReasons(): VideoAbuseReportReasonsApi {
    return this.#resource("videoAbuseReportReasons", (rest) => new VideoAbuseReportReasonsApi(rest));
  }

  /** Whether a video's owner allows third parties to train AI models on it. */
  get videoTrainability(): VideoTrainabilityApi {
    return this.#resource("videoTrainability", (rest) => new VideoTrainabilityApi(rest));
  }

  /** Interface languages supported by YouTube. */
  get i18nLanguages(): I18nLanguagesApi {
    return this.#resource("i18nLanguages", (rest) => new I18nLanguagesApi(rest));
  }

  /** Content regions supported by YouTube. */
  get i18nRegions(): I18nRegionsApi {
    return this.#resource("i18nRegions", (rest) => new I18nRegionsApi(rest));
  }

  /** Paying members of your channel. */
  get members(): MembersApi {
    return this.#resource("members", (rest) => new MembersApi(rest));
  }

  /** Membership levels of your channel. */
  get membershipsLevels(): MembershipsLevelsApi {
    return this.#resource("membershipsLevels", (rest) => new MembershipsLevelsApi(rest));
  }

  /** Abuse reports. Not part of the public reference. */
  get abuseReports(): AbuseReportsApi {
    return this.#resource("abuseReports", (rest) => new AbuseReportsApi(rest));
  }

  /** Links between a channel and a third party, for commerce partners. */
  get thirdPartyLinks(): ThirdPartyLinksApi {
    return this.#resource("thirdPartyLinks", (rest) => new ThirdPartyLinksApi(rest));
  }

  // ------------------------------------------------------- Live Streaming

  /** Live broadcasts: schedule, bind to a stream, go live, end. */
  get liveBroadcasts(): LiveBroadcastsApi {
    return this.#resource("liveBroadcasts", (rest) => new LiveBroadcastsApi(rest));
  }

  /** Video streams: the ingestion endpoints your encoder sends to. */
  get liveStreams(): LiveStreamsApi {
    return this.#resource("liveStreams", (rest) => new LiveStreamsApi(rest));
  }

  /** Raw live chat message methods. `yt.liveChat()` is the comfortable way in. */
  get liveChatMessages(): LiveChatMessages {
    return this.#resource("liveChatMessages", (rest) => new LiveChatMessages(rest));
  }

  /** Live chat bans. */
  get liveChatBans(): LiveChatBansApi {
    return this.#resource("liveChatBans", (rest) => new LiveChatBansApi(rest));
  }

  /** Live chat moderators. */
  get liveChatModerators(): LiveChatModeratorsApi {
    return this.#resource("liveChatModerators", (rest) => new LiveChatModeratorsApi(rest));
  }

  /** Super Chats and Super Stickers received by your channel. */
  get superChatEvents(): SuperChatEventsApi {
    return this.#resource("superChatEvents", (rest) => new SuperChatEventsApi(rest));
  }

  // ------------------------------------------------- Analytics, Reporting

  /** The YouTube Analytics API: on-demand reports and groups. */
  get analytics(): Analytics {
    return this.#resource("analytics", (rest) => new Analytics(rest));
  }

  /** The YouTube Reporting API: scheduled bulk reports. */
  get reporting(): Reporting {
    return this.#resource("reporting", (rest) => new Reporting(rest));
  }

  // --------------------------------------------------------------- Helpers

  /**
   * Opens a live chat from its id (`liveStreamingDetails.activeLiveChatId`).
   *
   * @example
   * for await (const message of yt.liveChat(liveChatId).messages()) {
   *   console.log(message.authorDetails.displayName, message.snippet.displayMessage);
   * }
   */
  liveChat(liveChatId: string): LiveChat {
    return new LiveChat(this, liveChatId);
  }

  /**
   * Opens the live chat of a broadcast, from the video id or URL. Throws when
   * the video is not live or has its chat turned off.
   *
   * Quota: 1 unit.
   *
   * @example
   * const chat = await yt.liveChatOf("https://www.youtube.com/watch?v=jfKfPfyJRdk");
   */
  async liveChatOf(video: string, options?: RequestOptions): Promise<LiveChat> {
    const id = videoIdFrom(video);
    if (!id) throw new YouTubeArgumentError(`"${video}" is neither a video id nor a video URL.`);
    const found = await this.videos.list({ part: "liveStreamingDetails", id }, options).first();
    if (!found) throw new YouTubeArgumentError(`Video "${id}" does not exist or is private.`);
    const liveChatId = found.liveStreamingDetails?.activeLiveChatId;
    if (!liveChatId) throw new YouTubeArgumentError(`Video "${id}" has no active live chat: it is not live right now, or its chat is turned off.`);
    return new LiveChat(this, liveChatId);
  }

  /**
   * Watches channels for new uploads. Accepts ids, handles and URLs. Reads
   * the free public feed and falls back on the API when the feed is down.
   *
   * @example
   * const watcher = yt.watch(["@GoogleDevelopers"], { interval: "5m" });
   * watcher.on("video", (video) => console.log("New upload:", video.title, video.url));
   * watcher.start();
   */
  watch(channels: string | readonly string[], options?: WatcherOptions): Watcher {
    // Feed requests go through the client's fetch unless the watcher has its own.
    const fetchImpl = options?.fetch ?? this.#options.fetch;
    return new Watcher(typeof channels === "string" ? [channels] : channels, { ...options, ...(fetchImpl ? { fetch: fetchImpl } : {}) }, this);
  }

  // ---------------------------------------------------------------- Client

  /**
   * Subscribes to what the client does: `request`, `response`, `retry`,
   * `quota`, and `error` for a listener or a cache store that failed.
   * Returns a function that unsubscribes.
   *
   * @example
   * yt.on("response", ({ method, duration, cost, cached }) => {
   *   console.log(method, `${duration} ms`, cached ? "cached" : `${cost} units`);
   * });
   */
  on<K extends keyof ClientEvents>(event: K, listener: (payload: ClientEvents[K]) => void): () => void {
    return this.#rest.events.on(event, listener);
  }

  /** Like {@link on}, for a single occurrence. */
  once<K extends keyof ClientEvents>(event: K, listener: (payload: ClientEvents[K]) => void): () => void {
    return this.#rest.events.once(event, listener);
  }

  /** Removes a listener added with {@link on}. */
  off<K extends keyof ClientEvents>(event: K, listener: (payload: ClientEvents[K]) => void): void {
    this.#rest.events.off(event, listener);
  }

  /**
   * Returns a client that acts for another user, sharing this one's cache,
   * quota count, events and settings. Meant for servers that hold the tokens
   * of many users. `overrides` changes the few settings that are per user.
   *
   * @example
   * app.get("/me", async (req, res) => {
   *   const user = yt.as(req.session.accessToken);
   *   res.json(await user.channels.mine());
   * });
   */
  as(credentials: AccessTokenProvider | OAuth2, overrides: Pick<YouTubeOptions, "quotaUser" | "headers" | "onBehalfOfContentOwner"> = {}): YouTube {
    const { oauth: _oauth, accessToken: _token, ...rest } = this.#options;
    const settings = { ...rest, ...overrides };
    return new YouTube(credentials instanceof OAuth2 ? { ...settings, oauth: credentials } : { ...settings, accessToken: credentials }, this.#rest);
  }

  /**
   * Calls a method by name, for the rare case where you build the call
   * dynamically. The typed resources (`yt.videos.list(...)`) are the normal
   * way. Parameters are sent as given: `part` is not filled in from the body
   * and long id lists are not split.
   *
   * @example
   * const response = await yt.request("videos.list", { part: "id", chart: "mostPopular" });
   */
  request<T = unknown>(method: MethodId, params: Record<string, unknown> = {}, options?: RequestOptions): Promise<T> {
    const spec = METHODS[method];
    if (!spec) throw new YouTubeArgumentError(`Unknown method "${method}".`);
    return this.#rest.request<T>(spec, params, options);
  }

  /** Empties the response cache. */
  async clearCache(): Promise<void> {
    await this.#rest.cacheStore?.clear?.();
  }
}

/**
 * Quota cost of a method, in units, and the bucket it is charged to. For the
 * Analytics and Reporting APIs, which Google does not bill in units, the cost
 * is a plain call count.
 *
 * @example
 * quotaCost("playlistItems.insert"); // { cost: 50, bucket: "default" }
 * quotaCost("search.list");          // { cost: 1, bucket: "search.list" }
 */
export function quotaCost(method: MethodId): { cost: number; bucket: QuotaBucket } {
  const spec = METHODS[method];
  if (!spec) throw new YouTubeArgumentError(`Unknown method "${method}".`);
  return { cost: spec.quota, bucket: spec.bucket };
}
