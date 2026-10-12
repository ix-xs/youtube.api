/**
 * OAuth 2.0 scopes of the YouTube APIs, by short name.
 *
 * @example
 * oauth.authUrl({ scopes: [Scopes.readonly, Scopes.upload] });
 */
export const Scopes = Object.freeze({
  /** Manage the YouTube account: read and write everything except deleting comments made by others. */
  manage: "https://www.googleapis.com/auth/youtube",
  /** View the YouTube account. */
  readonly: "https://www.googleapis.com/auth/youtube.readonly",
  /** Upload videos and manage them. */
  upload: "https://www.googleapis.com/auth/youtube.upload",
  /** Everything `manage` does, plus comments and captions. Required by the comment methods. */
  forceSsl: "https://www.googleapis.com/auth/youtube.force-ssl",
  /** See the list of a channel's current members, their level and join date. */
  channelMemberships: "https://www.googleapis.com/auth/youtube.channel-memberships.creator",
  /** View and manage assets and content on YouTube, for content partners. */
  partner: "https://www.googleapis.com/auth/youtubepartner",
  /** View private channel information relevant to a partner audit. */
  partnerChannelAudit: "https://www.googleapis.com/auth/youtubepartner-channel-audit",
  /** View YouTube Analytics reports. */
  analytics: "https://www.googleapis.com/auth/yt-analytics.readonly",
  /** View YouTube Analytics monetary reports. */
  analyticsMonetary: "https://www.googleapis.com/auth/yt-analytics-monetary.readonly",
} as const);

/** Short scope names, as the API reference writes them. */
export type ShortScope =
  | "youtube"
  | "youtube.readonly"
  | "youtube.upload"
  | "youtube.force-ssl"
  | "youtube.channel-memberships.creator"
  | "youtubepartner"
  | "youtubepartner-channel-audit"
  | "yt-analytics.readonly"
  | "yt-analytics-monetary.readonly";

/**
 * A scope: a short name (`"youtube.readonly"`), a full URL, or an OpenID
 * Connect scope when you also want the user's identity.
 */
export type Scope = ShortScope | (typeof Scopes)[keyof typeof Scopes] | "openid" | "email" | "profile" | (string & {});

const SCOPE_ROOT = "https://www.googleapis.com/auth/";
const BARE = new Set(["openid", "email", "profile"]);

/** Expands a short scope name to the URL Google expects. */
export function scopeUrl(scope: Scope): string {
  return scope.startsWith("https://") || BARE.has(scope) ? scope : SCOPE_ROOT + scope;
}

/** Shortens a scope URL to the name used in the API reference. */
export function scopeName(scope: string): string {
  return scope.startsWith(SCOPE_ROOT) ? scope.slice(SCOPE_ROOT.length) : scope;
}
