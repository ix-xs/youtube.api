import { describe, expect, it } from "vitest";
import { OAuth2, Scopes, YouTube, YouTubeAuthError, scopeName, scopeUrl } from "../src/index.js";
import { type Call, apiError, json, list, mockFetch } from "./helpers.js";

const form = (call: Call) => Object.fromEntries(new URLSearchParams(String(call.init.body)));
const tokenResponse = (extra: Record<string, unknown> = {}) => ({ access_token: "access-1", expires_in: 3600, token_type: "Bearer", scope: `${Scopes.readonly} ${Scopes.upload}`, ...extra });

describe("OAuth2", () => {
  it("builds a consent URL with PKCE", async () => {
    const oauth = new OAuth2({ clientId: "client", redirectUri: "https://app.example/callback" });
    const { url, state, codeVerifier } = await oauth.authUrl({ scopes: ["youtube.readonly", Scopes.upload, "openid"], prompt: "consent", loginHint: "me@example.com" });
    const parsed = new URL(url);
    expect(parsed.origin + parsed.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    const params = parsed.searchParams;
    expect(params.get("client_id")).toBe("client");
    expect(params.get("redirect_uri")).toBe("https://app.example/callback");
    expect(params.get("response_type")).toBe("code");
    expect(params.get("scope")).toBe("https://www.googleapis.com/auth/youtube.readonly https://www.googleapis.com/auth/youtube.upload openid");
    expect(params.get("access_type")).toBe("offline");
    expect(params.get("include_granted_scopes")).toBe("true");
    expect(params.get("prompt")).toBe("consent");
    expect(params.get("login_hint")).toBe("me@example.com");
    expect(params.get("state")).toBe(state);
    expect(params.get("code_challenge_method")).toBe("S256");
    expect(codeVerifier).toMatch(/^[\w-]{43,128}$/);

    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(codeVerifier!));
    const expected = btoa(String.fromCharCode(...new Uint8Array(digest))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    expect(params.get("code_challenge")).toBe(expected);
  });

  it("can skip PKCE and requires a redirect URI and scopes", async () => {
    const oauth = new OAuth2({ clientId: "client" });
    await expect(oauth.authUrl({ scopes: ["youtube"] })).rejects.toThrow(/redirectUri/);
    await expect(oauth.authUrl({ scopes: [], redirectUri: "https://x.example" })).rejects.toThrow(/scope/);
    const plain = await oauth.authUrl({ scopes: ["youtube"], redirectUri: "https://x.example", pkce: false, state: "mine" });
    expect(plain.codeVerifier).toBeUndefined();
    expect(plain.state).toBe("mine");
    expect(new URL(plain.url).searchParams.has("code_challenge")).toBe(false);
  });

  it("exchanges a code and reports the tokens", async () => {
    const { fetch, calls } = mockFetch(tokenResponse({ refresh_token: "refresh-1" }));
    const saved: unknown[] = [];
    const oauth = new OAuth2({ clientId: "client", clientSecret: "secret", redirectUri: "https://app.example/callback", fetch, onTokens: (tokens) => void saved.push(tokens) });
    const tokens = await oauth.exchange("the-code", { codeVerifier: "verifier" });
    expect(calls[0]!.url.href).toBe("https://oauth2.googleapis.com/token");
    expect(form(calls[0]!)).toEqual({
      client_id: "client",
      client_secret: "secret",
      grant_type: "authorization_code",
      code: "the-code",
      redirect_uri: "https://app.example/callback",
      code_verifier: "verifier",
    });
    expect(tokens).toMatchObject({ accessToken: "access-1", refreshToken: "refresh-1", tokenType: "Bearer" });
    expect(tokens.expiresAt).toBeGreaterThan(Date.now() + 3_500_000);
    expect(saved).toEqual([tokens]);
    expect(oauth.canRefresh).toBe(true);
    expect(oauth.isExpired).toBe(false);
    expect([...oauth.grantedScopes!]).toEqual(["youtube.readonly", "youtube.upload"]);
  });

  it("refreshes an expired token once for concurrent callers and keeps the refresh token", async () => {
    const { fetch, calls } = mockFetch(async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      return tokenResponse({ access_token: "access-2" });
    });
    const oauth = new OAuth2({ clientId: "client", fetch, tokens: { accessToken: "old", refreshToken: "refresh-1", expiresAt: Date.now() - 1 } });
    expect(oauth.isExpired).toBe(true);
    const [a, b] = await Promise.all([oauth.getAccessToken(), oauth.getAccessToken()]);
    expect([a, b]).toEqual(["access-2", "access-2"]);
    expect(calls).toHaveLength(1);
    expect(form(calls[0]!)).toMatchObject({ grant_type: "refresh_token", refresh_token: "refresh-1" });
    expect(oauth.tokens.refreshToken).toBe("refresh-1");
    expect(await oauth.getAccessToken()).toBe("access-2");
    expect(calls).toHaveLength(1);
  });

  it("explains OAuth failures", async () => {
    const { fetch } = mockFetch(json({ error: "invalid_grant", error_description: "Token has been expired or revoked." }, 400));
    const oauth = new OAuth2({ clientId: "client", fetch, tokens: { refreshToken: "dead" } });
    const error = (await oauth.getAccessToken().catch((e: unknown) => e)) as YouTubeAuthError;
    expect(error).toBeInstanceOf(YouTubeAuthError);
    expect(error).toMatchObject({ code: "OAUTH_ERROR", oauthError: "invalid_grant" });
    expect(error.message).toContain("consent again");

    await expect(new OAuth2({ clientId: "client" }).getAccessToken()).rejects.toMatchObject({ code: "MISSING_CREDENTIALS" });
    await expect(new OAuth2({ clientId: "client", tokens: { accessToken: "x", expiresAt: 1 } }).getAccessToken()).rejects.toMatchObject({ code: "OAUTH_ERROR" });
    expect(() => new OAuth2({} as never)).toThrow(/clientId/);
  });

  it("revokes and inspects tokens", async () => {
    const { fetch, calls } = mockFetch(json({ azp: "client", scope: `${Scopes.readonly} email`, expires_in: "3000", email: "me@example.com" }), new Response("{}"));
    const oauth = new OAuth2({ clientId: "client", fetch, tokens: { accessToken: "a", refreshToken: "r", expiresAt: Date.now() + 3_600_000 } });
    await expect(oauth.tokenInfo()).resolves.toEqual({ clientId: "client", scopes: ["youtube.readonly", "email"], expiresIn: 3000, email: "me@example.com" });
    await oauth.revoke();
    expect(calls[1]!.url.href).toBe("https://oauth2.googleapis.com/revoke");
    expect(form(calls[1]!)).toEqual({ token: "r" });
    expect(oauth.tokens).toEqual({});
  });

  it("runs the device flow", async () => {
    const { fetch, calls } = mockFetch(
      json({ device_code: "dev", user_code: "ABCD-EFGH", verification_url: "https://www.google.com/device", expires_in: 1800, interval: 0.001 }),
      json({ error: "authorization_pending" }, 428),
      tokenResponse({ refresh_token: "r" }),
    );
    const oauth = new OAuth2({ clientId: "client", clientSecret: "secret", fetch });
    const device = await oauth.requestDeviceCode({ scopes: ["youtube.readonly"] });
    expect(device).toMatchObject({ userCode: "ABCD-EFGH", verificationUrl: "https://www.google.com/device" });
    expect(form(calls[0]!)).toEqual({ client_id: "client", scope: Scopes.readonly });
    const tokens = await oauth.pollDeviceToken(device);
    expect(tokens.refreshToken).toBe("r");
    expect(form(calls[2]!)).toMatchObject({ grant_type: "urn:ietf:params:oauth:grant-type:device_code", device_code: "dev" });
  });

  it("converts scope names both ways", () => {
    expect(scopeUrl("youtube.force-ssl")).toBe(Scopes.forceSsl);
    expect(scopeUrl("email")).toBe("email");
    expect(scopeUrl(Scopes.analytics)).toBe(Scopes.analytics);
    expect(scopeName(Scopes.partner)).toBe("youtubepartner");
  });
});

describe("OAuth with the client", () => {
  const fresh = (scope: string) => ({ accessToken: "access-1", refreshToken: "refresh-1", expiresAt: Date.now() + 3_600_000, scope });

  it("sends the token and refreshes before a call when it is stale", async () => {
    const { fetch, calls } = mockFetch(tokenResponse({ access_token: "access-2" }), list([{ id: "UC1" }]));
    const yt = new YouTube({ fetch, oauth: { clientId: "client", clientSecret: "s", tokens: { ...fresh(Scopes.readonly), expiresAt: Date.now() + 1000 } } });
    await yt.channels.list({ part: "id", mine: true });
    expect(calls[0]!.url.href).toBe("https://oauth2.googleapis.com/token");
    expect(calls[1]!.headers.get("authorization")).toBe("Bearer access-2");
    expect(yt.oauth?.tokens.accessToken).toBe("access-2");
  });

  it("refreshes and replays once on a 401", async () => {
    const { fetch, calls } = mockFetch(apiError(401, "authError", "Invalid Credentials"), tokenResponse({ access_token: "access-2" }), list([{ id: "UC1" }]));
    const yt = new YouTube({ fetch, oauth: { clientId: "client", tokens: fresh(Scopes.readonly) } });
    const page = await yt.channels.list({ part: "id", mine: true });
    expect(page.items).toHaveLength(1);
    expect(calls.map((call) => call.url.hostname)).toEqual(["youtube.googleapis.com", "oauth2.googleapis.com", "youtube.googleapis.com"]);
    expect(calls[2]!.headers.get("authorization")).toBe("Bearer access-2");
    expect(yt.quota.used).toBe(1);
  });

  it("stops a call whose scopes were not granted, before it is sent", async () => {
    const { fetch, calls } = mockFetch(list([]));
    const oauth = new OAuth2({ clientId: "client", fetch, tokens: fresh(Scopes.readonly) });
    const yt = new YouTube({ fetch, oauth });
    const error = (await yt.videos.rate({ id: "dQw4w9WgXcQ", rating: "like" }).catch((e: unknown) => e)) as YouTubeAuthError;
    expect(error).toMatchObject({ code: "INSUFFICIENT_SCOPE" });
    expect(error.scopes).toEqual(["youtube", "youtube.force-ssl", "youtubepartner"]);
    expect(calls).toHaveLength(0);
    await expect(yt.channels.list({ part: "id", mine: true })).resolves.toBeDefined();
  });
});
