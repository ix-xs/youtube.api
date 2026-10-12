export { YouTube, quotaCost, type YouTubeOptions } from "./client.js";

export { OAuth2, type AuthUrl, type AuthUrlOptions, type DeviceCode, type OAuth2Options, type TokenInfo, type Tokens } from "./auth/oauth2.js";
export { Scopes, scopeName, scopeUrl, type Scope, type ShortScope } from "./auth/scopes.js";

export {
  YouTubeApiError,
  YouTubeArgumentError,
  YouTubeAuthError,
  YouTubeError,
  YouTubeQuotaBudgetError,
  YouTubeRequestError,
  YouTubeUploadError,
  isYouTubeError,
  type ApiErrorDetail,
  type YouTubeErrorCode,
  type YouTubeErrorReason,
} from "./core/errors.js";

export { ListRequest, Page, type CollectOptions } from "./core/pagination.js";
export { MemoryCache, type CacheEntry, type CacheOptions, type CacheStore } from "./core/cache.js";
export { DEFAULT_QUOTA_LIMITS, QuotaTracker, nextQuotaReset, type QuotaBucket, type QuotaEvent, type QuotaOptions, type QuotaSnapshot } from "./core/quota.js";
export type { AccessTokenProvider, ApiName, ClientEvents, MethodSpec, RequestOptions, RetryOptions } from "./core/rest.js";
export type { Body, Identified, OnBehalfOfContentOwner, OnBehalfOfContentOwnerChannel, OneOrMany, Simplify, WithParts } from "./core/resource.js";
export type { Duration } from "./core/time.js";
export type { MediaBody, MediaInput, MediaOptions, UploadProgress } from "./core/upload.js";

export { METHODS, type MethodId } from "./generated/methods.js";
export type * from "./generated/schemas.js";
export type * from "./generated/params.js";
export * from "./generated/resources.js";
export * from "./generated/analytics.js";
export * from "./generated/reporting.js";

export { Channels, type DefaultChannelPart, type PartOptions } from "./resources/channels.js";
export { Videos, type DefaultVideoPart } from "./resources/videos.js";
export { Playlists, type CreatePlaylistInput, type DefaultPlaylistPart } from "./resources/playlists.js";
export {
  CommentThreads,
  Comments,
  Search,
  Subscriptions,
  type ChannelSearchResult,
  type PlaylistSearchResult,
  type SearchFilters,
  type VideoSearchResult,
} from "./resources/community.js";
export { LiveChat, LiveChatMessages, type ChatMessage, type ChatReadOptions, type ChatSubscription } from "./live/chat.js";
export { Analytics, type AnalyticsDimension, type AnalyticsMetric, type AnalyticsQuery, type AnalyticsReport } from "./analytics.js";
export { Reporting } from "./reporting.js";

export { fetchFeed, feedUrl, oEmbed, parseFeed, type Feed, type FeedEntry, type FeedOptions, type OEmbed } from "./feeds/feed.js";
export { Watcher, type WatchedVideo, type WatcherEvents, type WatcherOptions } from "./feeds/watcher.js";
export { websub, type WebSubNotification, type WebSubReceiveOptions, type WebSubResult, type WebSubSubscribeOptions } from "./feeds/websub.js";

export {
  channelPlaylistId,
  isChannelId,
  isPlaylistId,
  isVideoId,
  parseChannelRef,
  parseUrl,
  playlistIdFrom,
  urls,
  videoIdFrom,
  type ChannelPlaylistKind,
  type ChannelRef,
  type EmbedUrlOptions,
  type ThumbnailQuality,
  type VideoUrlOptions,
  type YouTubeLink,
} from "./utils/ids.js";
export { VideoCategories, bestThumbnail, formatCount, formatDuration, parseDuration } from "./utils/format.js";
