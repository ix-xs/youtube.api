import { Emitter } from "../core/emitter.js";
import { YouTubeArgumentError, YouTubeAuthError } from "../core/errors.js";
import { sleep } from "../core/time.js";
import { type Scope, scopeName, scopeUrl } from "./scopes.js";

const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const REVOKE_URL = "https://oauth2.googleapis.com/revoke";
const DEVICE_URL = "https://oauth2.googleapis.com/device/code";
const TOKENINFO_URL = "https://oauth2.googleapis.com/tokeninfo";

/** Tokens to restart a session. The shape is plain data, safe to store as JSON. */
export interface Tokens {
  /** Short-lived token sent with each request. */
  accessToken?: string | undefined;
  /** Long-lived token used to get new access tokens. Keep it secret. */
  refreshToken?: string | undefined;
  /** When the access token expires, as a timestamp in milliseconds. */
  expiresAt?: number | undefined;
  /** Scopes the user granted, space separated, as Google returns them. */
  scope?: string | undefined;
  /** Always `Bearer`. */
  tokenType?: string | undefined;
  /** OpenID Connect identity token, when an `openid` scope was requested. */
  idToken?: string | undefined;
}

/** Settings of an {@link OAuth2} client. */
export interface OAuth2Options {
  /** Client id of your Google Cloud OAuth client. */
  clientId: string;
  /** Client secret. Leave it out for public clients (browser, mobile, desktop) that use PKCE. */
  clientSecret?: string;
  /** Where Google sends the user back after consent. Must match the client's configuration exactly. */
  redirectUri?: string;
  /** Tokens saved from a previous session. */
  tokens?: Tokens;
  /**
   * Called whenever tokens change: after an exchange and after each refresh.
   * This is where you persist them. It is awaited, and if it throws, the call
   * that triggered it fails: tokens that could not be saved are not silently lost.
   */
  onTokens?: (tokens: Tokens) => void | Promise<void>;
  /** Custom `fetch`. */
  fetch?: typeof fetch;
}

/** Options of {@link OAuth2.authUrl}. */
export interface AuthUrlOptions {
  /** Scopes to request. Short names such as `"youtube.readonly"` work. */
  scopes: readonly Scope[];
  /**
   * `"offline"` asks for a refresh token, so the app keeps working when the
   * user is away. Default `"offline"`.
   */
  accessType?: "offline" | "online";
  /**
   * `"consent"` forces the consent screen, which is what makes Google send a
   * refresh token again for a user who already approved the app.
   */
  prompt?: "none" | "consent" | "select_account" | "consent select_account";
  /** Opaque value echoed back to the redirect URI. Generated when left out; verify it there to block CSRF. */
  state?: string;
  /** Email or account id to preselect. */
  loginHint?: string;
  /** Keep the scopes the user granted earlier in addition to the new ones. Default true. */
  includeGrantedScopes?: boolean;
  /**
   * Use PKCE. Required for clients without a secret, recommended for all.
   * Default true.
   */
  pkce?: boolean;
  /** Overrides the client's redirect URI. */
  redirectUri?: string;
}

/** Result of {@link OAuth2.authUrl}. */
export interface AuthUrl {
  /** Send the user here. */
  url: string;
  /** Compare with the `state` query parameter on the way back. */
  state: string;
  /** Keep it (session, cookie) and give it to `exchange()`. Undefined when PKCE is off. */
  codeVerifier: string | undefined;
}

/** A pending device authorization, see {@link OAuth2.requestDeviceCode}. */
export interface DeviceCode {
  deviceCode: string;
  /** Code the user types on the verification page. */
  userCode: string;
  /** Page the user opens on another device. */
  verificationUrl: string;
  /** Seconds until the codes expire. */
  expiresIn: number;
  /** Seconds to wait between two polls. */
  interval: number;
}

/** What Google knows about an access token, see {@link OAuth2.tokenInfo}. */
export interface TokenInfo {
  /** Client the token was issued to. */
  clientId: string;
  /** Granted scopes, short names. */
  scopes: string[];
  /** Seconds until the token expires. */
  expiresIn: number;
  /** Email of the account, when an identity scope was granted. */
  email: string | undefined;
}

interface TokenResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
  token_type?: string;
  id_token?: string;
  error?: string;
  error_description?: string;
}

function base64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function randomToken(bytes = 32): string {
  return base64Url(crypto.getRandomValues(new Uint8Array(bytes)));
}

async function challengeFor(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return base64Url(new Uint8Array(digest));
}

/**
 * OAuth 2.0 for the YouTube APIs: consent URL, code exchange, automatic
 * refresh, revocation and the device flow. Give the instance to the client and
 * tokens are kept fresh on their own.
 *
 * @example
 * const oauth = new OAuth2({
 *   clientId: process.env.GOOGLE_CLIENT_ID!,
 *   clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
 *   redirectUri: "https://example.com/oauth/callback",
 *   onTokens: (tokens) => db.saveTokens(userId, tokens),
 * });
 *
 * // 1. Send the user to Google.
 * const { url, state, codeVerifier } = await oauth.authUrl({ scopes: ["youtube.readonly"] });
 *
 * // 2. On the callback route, trade the code for tokens.
 * await oauth.exchange(code, { codeVerifier });
 *
 * // 3. Use the API. Tokens refresh on their own from here on.
 * const yt = new YouTube({ oauth });
 * const me = await yt.channels.list({ part: "snippet", mine: true }).first();
 */
export class OAuth2 {
  readonly clientId: string;
  readonly #clientSecret: string | undefined;
  readonly #redirectUri: string | undefined;
  readonly #fetch: typeof fetch;
  readonly #events = new Emitter<{ tokens: Tokens }>();
  #tokens: Tokens;
  #refreshing: Promise<string> | undefined;
  readonly #onTokens: ((tokens: Tokens) => void | Promise<void>) | undefined;
  /** Bumped whenever the tokens are replaced from outside, so a grant in flight does not overwrite them. */
  #epoch = 0;

  constructor(options: OAuth2Options) {
    if (!options?.clientId) throw new YouTubeArgumentError("OAuth2 needs a `clientId`.");
    this.clientId = options.clientId;
    this.#clientSecret = options.clientSecret;
    this.#redirectUri = options.redirectUri;
    const custom = options.fetch;
    // Always called as a plain function: a native fetch refuses to run as a method of another object.
    this.#fetch = custom ? (input, init) => custom(input, init) : (input, init) => globalThis.fetch(input, init);
    this.#tokens = { ...options.tokens };
    this.#onTokens = options.onTokens;
  }

  /** Current tokens. Store them to restart later without sending the user through consent again. */
  get tokens(): Readonly<Tokens> {
    return { ...this.#tokens };
  }

  /** Replaces the tokens, for example when switching user. */
  setTokens(tokens: Tokens): void {
    this.#epoch++;
    this.#refreshing = undefined;
    this.#tokens = { ...tokens };
  }

  /** Whether a refresh token is available, so access tokens can be renewed without the user. */
  get canRefresh(): boolean {
    return Boolean(this.#tokens.refreshToken);
  }

  /** Whether the access token is missing or about to expire. */
  get isExpired(): boolean {
    const { accessToken, expiresAt } = this.#tokens;
    return !accessToken || (expiresAt !== undefined && expiresAt - 60_000 <= Date.now());
  }

  /** Scopes granted by the user, short names. Undefined when the tokens do not say. */
  get grantedScopes(): ReadonlySet<string> | undefined {
    const { scope } = this.#tokens;
    return scope ? new Set(scope.split(/\s+/).filter(Boolean).map(scopeName)) : undefined;
  }

  /** Subscribes to token changes. Returns a function that unsubscribes. */
  onTokens(listener: (tokens: Tokens) => void): () => void {
    return this.#events.on("tokens", listener);
  }

  /**
   * Builds the consent URL. Redirect the user to `url`, keep `state` and
   * `codeVerifier` for the way back.
   */
  async authUrl(options: AuthUrlOptions): Promise<AuthUrl> {
    const redirectUri = options.redirectUri ?? this.#redirectUri;
    if (!redirectUri) throw new YouTubeArgumentError("authUrl() needs a `redirectUri`, on the OAuth2 client or in the options.");
    if (!options.scopes?.length) throw new YouTubeArgumentError("authUrl() needs at least one scope.");
    const state = options.state ?? randomToken(16);
    const url = new URL(AUTH_URL);
    url.searchParams.set("client_id", this.clientId);
    url.searchParams.set("redirect_uri", redirectUri);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("scope", options.scopes.map(scopeUrl).join(" "));
    url.searchParams.set("access_type", options.accessType ?? "offline");
    url.searchParams.set("state", state);
    if (options.includeGrantedScopes ?? true) url.searchParams.set("include_granted_scopes", "true");
    if (options.prompt) url.searchParams.set("prompt", options.prompt);
    if (options.loginHint) url.searchParams.set("login_hint", options.loginHint);

    let codeVerifier: string | undefined;
    if (options.pkce ?? true) {
      codeVerifier = randomToken(48);
      url.searchParams.set("code_challenge", await challengeFor(codeVerifier));
      url.searchParams.set("code_challenge_method", "S256");
    }
    return { url: url.toString(), state, codeVerifier };
  }

  /**
   * Trades the `code` Google sent to the redirect URI for tokens, and keeps
   * them on this client.
   */
  async exchange(code: string, options: { codeVerifier?: string | undefined; redirectUri?: string } = {}): Promise<Tokens> {
    const redirectUri = options.redirectUri ?? this.#redirectUri;
    if (!code) throw new YouTubeArgumentError("exchange() needs the `code` query parameter Google sent back.");
    if (!redirectUri) throw new YouTubeArgumentError("exchange() needs the same `redirectUri` that was used to build the consent URL.");
    const body: Record<string, string> = { grant_type: "authorization_code", code, redirect_uri: redirectUri };
    if (options.codeVerifier) body.code_verifier = options.codeVerifier;
    return this.#grant(body);
  }

  /**
   * Returns a valid access token, refreshing it first when it is about to
   * expire. The client calls this before each request.
   */
  async getAccessToken(): Promise<string> {
    if (!this.isExpired) return this.#tokens.accessToken!;
    if (this.canRefresh) return this.refresh();
    if (this.#tokens.accessToken) {
      throw new YouTubeAuthError("OAUTH_ERROR", "The access token expired and there is no refresh token. Send the user through consent again with `accessType: \"offline\"` and `prompt: \"consent\"`.");
    }
    throw new YouTubeAuthError("MISSING_CREDENTIALS", "This OAuth2 client has no tokens yet. Call `exchange()` with an authorization code, or pass saved `tokens`.");
  }

  /** Gets a new access token from the refresh token. Concurrent calls share one request. */
  refresh(): Promise<string> {
    if (!this.#tokens.refreshToken) {
      return Promise.reject(new YouTubeAuthError("OAUTH_ERROR", "Cannot refresh: there is no refresh token."));
    }
    this.#refreshing ??= this.#grant({ grant_type: "refresh_token", refresh_token: this.#tokens.refreshToken })
      .then((tokens) => tokens.accessToken!)
      .finally(() => {
        this.#refreshing = undefined;
      });
    return this.#refreshing;
  }

  /** Revokes the tokens at Google and forgets them. The user has to consent again afterwards. */
  async revoke(): Promise<void> {
    const token = this.#tokens.refreshToken ?? this.#tokens.accessToken;
    if (!token) return;
    const response = await this.#post(REVOKE_URL, { token });
    if (!response.ok) await this.#fail(response, "revoke the token");
    this.#epoch++;
    this.#tokens = {};
    this.#events.emit("tokens", {});
  }

  /** Asks Google what an access token is good for: its client, scopes and remaining lifetime. */
  async tokenInfo(accessToken?: string): Promise<TokenInfo> {
    const token = accessToken ?? (await this.getAccessToken());
    const response = await this.#post(TOKENINFO_URL, { access_token: token });
    if (!response.ok) await this.#fail(response, "inspect the token");
    const info = (await response.json()) as { aud?: string; azp?: string; scope?: string; expires_in?: string | number; email?: string };
    return {
      clientId: info.azp ?? info.aud ?? "",
      scopes: (info.scope ?? "").split(/\s+/).filter(Boolean).map(scopeName),
      expiresIn: Number(info.expires_in ?? 0),
      email: info.email,
    };
  }

  /**
   * Starts the device flow, for TVs, consoles and command-line tools: show
   * `userCode` and `verificationUrl` to the user, then call
   * {@link pollDeviceToken}. The OAuth client must be of type "TVs and Limited
   * Input devices".
   *
   * @example
   * const device = await oauth.requestDeviceCode({ scopes: ["youtube.readonly"] });
   * console.log(`Open ${device.verificationUrl} and enter ${device.userCode}`);
   * await oauth.pollDeviceToken(device);
   */
  async requestDeviceCode(options: { scopes: readonly Scope[] }): Promise<DeviceCode> {
    const response = await this.#post(DEVICE_URL, { client_id: this.clientId, scope: options.scopes.map(scopeUrl).join(" ") });
    if (!response.ok) await this.#fail(response, "start the device flow");
    const data = (await response.json()) as { device_code: string; user_code: string; verification_url: string; expires_in: number; interval?: number };
    return {
      deviceCode: data.device_code,
      userCode: data.user_code,
      verificationUrl: data.verification_url,
      expiresIn: data.expires_in,
      interval: data.interval ?? 5,
    };
  }

  /** Waits until the user approves the device, then stores and returns the tokens. */
  async pollDeviceToken(device: DeviceCode, options: { signal?: AbortSignal } = {}): Promise<Tokens> {
    const deadline = Date.now() + device.expiresIn * 1000;
    let interval = device.interval;
    while (Date.now() < deadline) {
      await sleep(interval * 1000, options.signal);
      try {
        return await this.#grant({ grant_type: "urn:ietf:params:oauth:grant-type:device_code", device_code: device.deviceCode });
      } catch (error) {
        if (!(error instanceof YouTubeAuthError)) throw error;
        if (error.oauthError === "authorization_pending") continue;
        if (error.oauthError === "slow_down") {
          interval += 5;
          continue;
        }
        throw error;
      }
    }
    throw new YouTubeAuthError("OAUTH_ERROR", "The device code expired before the user approved it.", { oauthError: "expired_token" });
  }

  #post(url: string, fields: Record<string, string>): Promise<Response> {
    return this.#fetch(url, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
      body: new URLSearchParams(fields).toString(),
    });
  }

  async #fail(response: Response, action: string): Promise<never> {
    const data = (await response.json().catch(() => ({}))) as TokenResponse;
    const hint =
      data.error === "invalid_grant"
        ? " The code or refresh token is no longer valid: it was used twice, revoked, or expired. Send the user through consent again."
        : data.error === "redirect_uri_mismatch"
          ? " The redirect URI must match one configured on the OAuth client, character for character."
          : "";
    throw new YouTubeAuthError("OAUTH_ERROR", `Could not ${action}: ${(data.error_description ?? data.error ?? `HTTP ${response.status}`).replace(/\.$/, "")}.${hint}`, {
      oauthError: data.error,
    });
  }

  async #grant(fields: Record<string, string>): Promise<Tokens> {
    const body: Record<string, string> = { client_id: this.clientId, ...fields };
    if (this.#clientSecret) body.client_secret = this.#clientSecret;
    const epoch = this.#epoch;
    const before = this.#tokens;
    const response = await this.#post(TOKEN_URL, body);
    if (!response.ok) await this.#fail(response, fields.grant_type === "refresh_token" ? "refresh the access token" : "get tokens");
    const data = (await response.json()) as TokenResponse;
    const tokens: Tokens = {
      accessToken: data.access_token,
      // Google only sends the refresh token on first consent: keep the one we have.
      refreshToken: data.refresh_token ?? before.refreshToken,
      expiresAt: data.expires_in ? Date.now() + data.expires_in * 1000 : undefined,
      scope: data.scope ?? before.scope,
      tokenType: data.token_type ?? "Bearer",
      idToken: data.id_token ?? before.idToken,
    };
    // The tokens were replaced while this request was out (another user was
    // set): what came back belongs to the previous ones and must not mix in.
    if (epoch !== this.#epoch) return tokens;
    this.#tokens = tokens;
    if (this.#onTokens) {
      try {
        await this.#onTokens({ ...tokens });
      } catch (cause) {
        throw new YouTubeAuthError("OAUTH_ERROR", `The tokens were obtained but \`onTokens\` failed to store them (${(cause as Error)?.message ?? cause}).`, { cause });
      }
    }
    this.#events.emit("tokens", this.tokens);
    return this.tokens;
  }
}
