/**
 * Stable machine-readable codes carried by every error this library throws.
 * Compare against `error.code` instead of parsing messages.
 */
export type YouTubeErrorCode =
  | "API_ERROR"
  | "BAD_REQUEST"
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "CONFLICT"
  | "QUOTA_EXCEEDED"
  | "RATE_LIMITED"
  | "SERVER_ERROR"
  | "TIMEOUT"
  | "NETWORK"
  | "ABORTED"
  | "PARSE_ERROR"
  | "MISSING_CREDENTIALS"
  | "INSUFFICIENT_SCOPE"
  | "OAUTH_ERROR"
  | "INVALID_ARGUMENT"
  | "UPLOAD_FAILED"
  | "QUOTA_BUDGET_EXCEEDED"
  | "FEED_UNAVAILABLE"
  | "HUB_ERROR";

/**
 * The `reason` strings the YouTube API puts in its error bodies. The list
 * covers the ones worth branching on; the API can return others, so the type
 * stays open.
 */
export type YouTubeErrorReason =
  | "quotaExceeded"
  | "dailyLimitExceeded"
  | "rateLimitExceeded"
  | "userRateLimitExceeded"
  | "keyInvalid"
  | "keyExpired"
  | "accessNotConfigured"
  | "ipRefererBlocked"
  | "authError"
  | "required"
  | "forbidden"
  | "insufficientPermissions"
  | "youtubeSignupRequired"
  | "accountClosed"
  | "accountSuspended"
  | "channelClosed"
  | "channelSuspended"
  | "badRequest"
  | "invalid"
  | "invalidParameter"
  | "missingRequiredParameter"
  | "incompatibleParameters"
  | "invalidPageToken"
  | "invalidFilters"
  | "unknownPart"
  | "notFound"
  | "videoNotFound"
  | "channelNotFound"
  | "playlistNotFound"
  | "playlistItemNotFound"
  | "commentNotFound"
  | "commentThreadNotFound"
  | "subscriptionNotFound"
  | "captionNotFound"
  | "liveChatNotFound"
  | "liveBroadcastNotFound"
  | "liveStreamNotFound"
  | "commentsDisabled"
  | "liveChatDisabled"
  | "liveChatEnded"
  | "subscriptionDuplicate"
  | "subscriptionForbidden"
  | "playlistForbidden"
  | "playlistContainsMaximumNumberOfVideos"
  | "videoAlreadyInPlaylist"
  | "uploadLimitExceeded"
  | "invalidTitle"
  | "invalidDescription"
  | "invalidTags"
  | "invalidCategoryId"
  | "invalidVideoMetadata"
  | "defaultLanguageNotSet"
  | "videoRatingDisabled"
  | "emailNotVerified"
  | "processingFailure"
  | "backendError"
  | "internalError"
  | "serviceUnavailable"
  | (string & {});

/** One entry of the `error.errors` array returned by the API. */
export interface ApiErrorDetail {
  message: string;
  domain?: string;
  reason?: YouTubeErrorReason;
  location?: string;
  locationType?: string;
}

/** Base class of everything thrown by this library. */
export class YouTubeError extends Error {
  /** Stable code, safe to switch on. */
  readonly code: YouTubeErrorCode;

  constructor(code: YouTubeErrorCode, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "YouTubeError";
    this.code = code;
  }
}

/** Details passed to {@link YouTubeApiError}. */
export interface ApiErrorInit {
  status: number;
  message: string;
  method: string;
  url: string;
  reason?: YouTubeErrorReason | undefined;
  errors?: ApiErrorDetail[] | undefined;
  /** gRPC-style status, for example `PERMISSION_DENIED`. */
  apiStatus?: string | undefined;
  /** Seconds to wait before retrying, when the API sent `Retry-After`. */
  retryAfter?: number | undefined;
  body?: unknown;
}

/**
 * The API answered with an error status.
 *
 * @example
 * try {
 *   await yt.videos.rate({ id, rating: "like" });
 * } catch (error) {
 *   if (error instanceof YouTubeApiError && error.reason === "videoRatingDisabled") {
 *     // ratings are turned off on that video
 *   }
 * }
 */
export class YouTubeApiError extends YouTubeError {
  /** HTTP status code. */
  readonly status: number;
  /** The `reason` of the error body, for example `quotaExceeded`. When the body carries a more precise one in its details (an invalid key, a missing scope), that one is used. */
  readonly reason: YouTubeErrorReason | undefined;
  /** Every error entry the API returned. */
  readonly errors: ApiErrorDetail[];
  /** gRPC-style status, for example `PERMISSION_DENIED`. */
  readonly apiStatus: string | undefined;
  /** Method that failed, for example `videos.list`. */
  readonly method: string;
  /** Request URL with credentials removed. */
  readonly url: string;
  /** Seconds to wait before retrying, when the API said so. */
  readonly retryAfter: number | undefined;
  /** Parsed response body, when there was one. */
  readonly body: unknown;

  constructor(init: ApiErrorInit) {
    super(codeFor(init.status, init.reason), `${init.method}: ${init.message}`);
    this.name = "YouTubeApiError";
    this.status = init.status;
    this.reason = init.reason;
    this.errors = init.errors ?? [];
    this.apiStatus = init.apiStatus;
    this.method = init.method;
    this.url = init.url;
    this.retryAfter = init.retryAfter;
    this.body = init.body;
  }

  /** The project ran out of quota for the day. Retrying before midnight Pacific Time is pointless. */
  get isQuotaExceeded(): boolean {
    return this.code === "QUOTA_EXCEEDED";
  }

  /** Too many requests in a short window. Retrying after a pause works. */
  get isRateLimited(): boolean {
    return this.code === "RATE_LIMITED";
  }

  /** The resource does not exist, or the credentials cannot see it. */
  get isNotFound(): boolean {
    return this.code === "NOT_FOUND";
  }
}

const QUOTA_REASONS = new Set(["quotaExceeded", "dailyLimitExceeded"]);
const RATE_REASONS = new Set(["rateLimitExceeded", "userRateLimitExceeded"]);

function codeFor(status: number, reason: string | undefined): YouTubeErrorCode {
  if (reason && QUOTA_REASONS.has(reason)) return "QUOTA_EXCEEDED";
  if (status === 429 || (reason && RATE_REASONS.has(reason))) return "RATE_LIMITED";
  if (status === 400) return "BAD_REQUEST";
  if (status === 401) return "UNAUTHORIZED";
  if (status === 403) return "FORBIDDEN";
  if (status === 404) return "NOT_FOUND";
  if (status === 409) return "CONFLICT";
  if (status >= 500) return "SERVER_ERROR";
  return "API_ERROR";
}

/** Credentials are missing, insufficient, or an OAuth exchange failed. */
export class YouTubeAuthError extends YouTubeError {
  /** Scopes that would have allowed the call, when known. */
  readonly scopes: readonly string[];
  /** OAuth error name returned by Google, for example `invalid_grant`. */
  readonly oauthError: string | undefined;

  constructor(
    code: "MISSING_CREDENTIALS" | "INSUFFICIENT_SCOPE" | "OAUTH_ERROR",
    message: string,
    options?: { scopes?: readonly string[]; oauthError?: string | undefined; cause?: unknown },
  ) {
    super(code, message, options);
    this.name = "YouTubeAuthError";
    this.scopes = options?.scopes ?? [];
    this.oauthError = options?.oauthError;
  }
}

/** The request never produced a usable response: timeout, network failure, abort or unreadable body. */
export class YouTubeRequestError extends YouTubeError {
  /** Method that failed, for example `videos.list`. */
  readonly method: string;

  constructor(
    code: "TIMEOUT" | "NETWORK" | "ABORTED" | "PARSE_ERROR" | "FEED_UNAVAILABLE" | "HUB_ERROR" | "SERVER_ERROR",
    method: string,
    message: string,
    options?: { cause?: unknown },
  ) {
    super(code, `${method}: ${message}`, options);
    this.name = "YouTubeRequestError";
    this.method = method;
  }
}

/**
 * The library itself refused something: an argument that cannot be right, or
 * a reference that matched nothing (a handle with no channel, a video with no
 * live chat). The API did not answer with an error.
 */
export class YouTubeArgumentError extends YouTubeError {
  constructor(message: string) {
    super("INVALID_ARGUMENT", message);
    this.name = "YouTubeArgumentError";
  }
}

/** The call would go over the quota budget configured on the client. Nothing was sent. */
export class YouTubeQuotaBudgetError extends YouTubeError {
  /** Bucket the call is charged to. */
  readonly bucket: string;
  /** Units the call would have cost. */
  readonly cost: number;
  /** Units left in the bucket. */
  readonly remaining: number;
  /** When the bucket resets (midnight Pacific Time). */
  readonly resetsAt: Date;

  constructor(method: string, bucket: string, cost: number, remaining: number, resetsAt: Date) {
    super(
      "QUOTA_BUDGET_EXCEEDED",
      `${method} costs ${cost} quota unit${cost === 1 ? "" : "s"} but only ${remaining} remain in the "${bucket}" budget. It resets at ${resetsAt.toISOString()}.`,
    );
    this.name = "YouTubeQuotaBudgetError";
    this.bucket = bucket;
    this.cost = cost;
    this.remaining = remaining;
    this.resetsAt = resetsAt;
  }
}

/**
 * An upload could not be completed. For a resumable upload that can still be
 * resumed, `sessionUri` is set; it is undefined for a single-request upload
 * and for a session that expired.
 */
export class YouTubeUploadError extends YouTubeError {
  /** Resumable session, valid for about a week. Pass it back as `resumeUri`. */
  readonly sessionUri: string | undefined;
  /** Bytes the server confirmed. */
  readonly uploaded: number;

  constructor(message: string, options: { sessionUri?: string | undefined; uploaded?: number; cause?: unknown }) {
    super("UPLOAD_FAILED", message, options);
    this.name = "YouTubeUploadError";
    this.sessionUri = options.sessionUri;
    this.uploaded = options.uploaded ?? 0;
  }
}

/**
 * Type guard for errors thrown by this library, optionally narrowed to a code.
 *
 * @example
 * if (isYouTubeError(error, "QUOTA_EXCEEDED")) await pauseUntil(yt.quota.resetsAt);
 */
export function isYouTubeError(error: unknown, code?: YouTubeErrorCode): error is YouTubeError {
  return error instanceof YouTubeError && (code === undefined || error.code === code);
}

/** Removes API keys and tokens from a URL so it can be logged or thrown. */
export function redactUrl(url: string): string {
  return url.replace(/([?&](?:key|access_token|oauth_token|client_secret|refresh_token|code)=)[^&#]+/gi, "$1REDACTED");
}
