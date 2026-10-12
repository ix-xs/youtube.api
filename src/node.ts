// Helpers that need Node.js itself: files on disk, a local HTTP server, the
// default browser. Everything else lives in the main entry point and runs
// anywhere `fetch` does.

import { spawn } from "node:child_process";
import { openAsBlob } from "node:fs";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { type IncomingMessage, type ServerResponse, createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { dirname, extname } from "node:path";
import type { OAuth2, Tokens } from "./auth/oauth2.js";
import type { Scope } from "./auth/scopes.js";
import { YouTubeArgumentError, YouTubeAuthError } from "./core/errors.js";
import { type Duration, toMs } from "./core/time.js";
import type { MediaOptions, UploadProgress } from "./core/upload.js";
import { type WebSubNotification, type WebSubReceiveOptions, type WebSubResult, websub } from "./feeds/websub.js";

const MIME_TYPES: Record<string, string> = {
  ".mp4": "video/mp4",
  ".m4v": "video/x-m4v",
  ".mov": "video/quicktime",
  ".webm": "video/webm",
  ".mkv": "video/x-matroska",
  ".avi": "video/x-msvideo",
  ".wmv": "video/x-ms-wmv",
  ".flv": "video/x-flv",
  ".mpg": "video/mpeg",
  ".mpeg": "video/mpeg",
  ".3gp": "video/3gpp",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".srt": "application/x-subrip",
  ".vtt": "text/vtt",
  ".sbv": "text/plain",
  ".ttml": "application/ttml+xml",
};

/**
 * Prepares a file on disk for upload, without reading it into memory. The
 * MIME type comes from the extension unless you give one.
 *
 * @example
 * import { fileMedia } from "@ix-xs/youtube.api/node";
 *
 * await yt.videos.insert({
 *   body: { snippet: { title: "Holiday" }, status: { privacyStatus: "private" } },
 *   media: await fileMedia("./holiday.mp4", { onProgress: ({ percent }) => console.log(percent) }),
 * });
 */
export async function fileMedia(path: string, options: { mimeType?: string | undefined; chunkSize?: number | undefined; resumeUri?: string | undefined; onProgress?: ((progress: UploadProgress) => void) | undefined } = {}): Promise<MediaOptions> {
  const mimeType = options.mimeType ?? MIME_TYPES[extname(path).toLowerCase()] ?? "application/octet-stream";
  const body = await openAsBlob(path, { type: mimeType });
  return { ...options, body, mimeType };
}

/**
 * Keeps OAuth tokens in a JSON file. On Linux and macOS the file is created
 * readable by the current user only; Windows ignores that setting, so the
 * folder's own permissions apply there.
 *
 * @example
 * const store = tokenFile("./tokens.json");
 * const oauth = new OAuth2({ clientId, clientSecret, tokens: await store.load(), onTokens: store.save });
 */
export function tokenFile(path: string): { load(): Promise<Tokens | undefined>; save(tokens: Tokens): Promise<void> } {
  return {
    async load() {
      try {
        return JSON.parse(await readFile(path, "utf8")) as Tokens;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
        throw error;
      }
    },
    async save(tokens) {
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, `${JSON.stringify(tokens, null, 2)}\n`, { mode: 0o600 });
      // The mode above only applies when the file is created.
      await chmod(path, 0o600).catch(() => {});
    },
  };
}

function openBrowser(url: string): void {
  const [command, args] =
    process.platform === "win32"
      ? ["rundll32", ["url.dll,FileProtocolHandler", url]]
      : process.platform === "darwin"
        ? ["open", [url]]
        : ["xdg-open", [url]];
  try {
    const child = spawn(command as string, args as string[], { stdio: "ignore", detached: true });
    child.on("error", () => {});
    child.unref();
  } catch {
    // No browser to open: the URL is printed anyway.
  }
}

const page = (title: string, text: string) =>
  `<!doctype html><meta charset="utf-8"><title>${title}</title><body style="font:16px system-ui;margin:15vh auto;max-width:28rem;padding:0 1rem;text-align:center"><h1 style="font-size:1.4rem">${title}</h1><p>${text}</p>`;

/** Options of {@link authorize}. */
export interface AuthorizeOptions {
  /** Scopes to request. */
  scopes: readonly Scope[];
  /** Local port to listen on. Default: any free port, which the "Desktop app" client type accepts. */
  port?: number | undefined;
  /** Open the consent page in the default browser. Default true. The URL is printed either way. */
  open?: boolean | undefined;
  /** Called with the consent URL. Default: prints it. */
  onUrl?: ((url: string) => void) | undefined;
  /** How long to wait for the user. Default `"5m"`. */
  timeout?: Duration | undefined;
}

/**
 * Runs the whole consent flow on this machine, for scripts and command-line
 * tools: starts a local server, opens the consent page, waits for Google to
 * come back with the code and trades it for tokens.
 *
 * Use an OAuth client of type "Desktop app", which accepts any loopback
 * redirect.
 *
 * @example
 * import { OAuth2, YouTube } from "@ix-xs/youtube.api";
 * import { authorize, tokenFile } from "@ix-xs/youtube.api/node";
 *
 * const store = tokenFile("./tokens.json");
 * const oauth = new OAuth2({ clientId, clientSecret, tokens: await store.load(), onTokens: store.save });
 * if (!oauth.canRefresh) await authorize(oauth, { scopes: ["youtube.upload"] });
 * const yt = new YouTube({ oauth });
 */
export async function authorize(oauth: OAuth2, options: AuthorizeOptions): Promise<Tokens> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(options.port ?? 0, "127.0.0.1", resolve);
  });
  const redirectUri = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    const { url, state, codeVerifier } = await oauth.authUrl({ scopes: options.scopes, redirectUri, prompt: "consent" });
    (options.onUrl ?? ((link) => console.log(`Open this page to authorize the app:\n${link}\n`)))(url);
    if (options.open ?? true) openBrowser(url);

    const code = await new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => reject(new YouTubeAuthError("OAUTH_ERROR", "Nobody completed the consent screen in time.")), toMs(options.timeout ?? "5m"));
      server.on("request", (request, response) => {
        const query = new URL(request.url ?? "/", redirectUri).searchParams;
        if (!query.has("code") && !query.has("error")) {
          response.writeHead(404).end();
          return;
        }
        response.setHeader("content-type", "text/html; charset=utf-8");
        if (query.get("state") !== state) {
          // Not the answer to this session: some other page on this machine. Keep waiting.
          response.writeHead(400).end(page("Authorization failed", "This response does not belong to the session that is waiting. Start again from the terminal."));
          return;
        }
        clearTimeout(timer);
        if (query.has("error")) {
          response.writeHead(400).end(page("Authorization refused", "You can close this tab."));
          reject(new YouTubeAuthError("OAUTH_ERROR", `Google returned "${query.get("error")}".`, { oauthError: query.get("error") ?? undefined }));
        } else {
          response.writeHead(200).end(page("All set", "You can close this tab and go back to the terminal."));
          resolve(query.get("code")!);
        }
      });
    });
    return await oauth.exchange(code, { codeVerifier, redirectUri });
  } finally {
    server.close();
    server.closeAllConnections?.();
  }
}

const MAX_BODY = 1024 * 1024;

/** Options of {@link webSubListener}. */
export interface WebSubListenerOptions extends WebSubReceiveOptions {
  /** Called for each notification with a valid signature. */
  onNotification: (notification: WebSubNotification) => void | Promise<void>;
  /** Called when the hub confirms a subscription or its removal. */
  onConfirmation?: ((confirmation: NonNullable<WebSubResult["confirmation"]>) => void) | undefined;
  /** Called when a handler throws. Default: logs to the console. */
  onError?: ((error: unknown) => void) | undefined;
}

/**
 * Turns `websub.receive` into a listener for `node:http`, Express, Fastify's
 * raw mode and anything else built on Node's request and response objects.
 *
 * @example
 * import { createServer } from "node:http";
 * import { webSubListener } from "@ix-xs/youtube.api/node";
 *
 * createServer(
 *   webSubListener({
 *     secret: process.env.WEBSUB_SECRET,
 *     onNotification: (notification) => console.log(notification),
 *   }),
 * ).listen(3000);
 */
export function webSubListener(options: WebSubListenerOptions): (request: IncomingMessage, response: ServerResponse) => void {
  if (typeof options?.onNotification !== "function") throw new YouTubeArgumentError("webSubListener() needs an `onNotification` function.");
  const onError = options.onError ?? ((error) => console.error("[youtube.api] WebSub handler failed:", error));
  return (request, response) => {
    void (async () => {
      const chunks: Buffer[] = [];
      let size = 0;
      for await (const chunk of request) {
        size += (chunk as Buffer).byteLength;
        // A notification is a few kilobytes. Anything huge is not one.
        if (size > MAX_BODY) {
          response.writeHead(413).end();
          request.destroy();
          return;
        }
        chunks.push(chunk as Buffer);
      }
      const headers = new Headers();
      for (const [name, value] of Object.entries(request.headers)) {
        if (value !== undefined) headers.set(name, Array.isArray(value) ? value.join(", ") : value);
      }
      const method = request.method ?? "GET";
      const result = await websub.receive(
        new Request(new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`), {
          method,
          headers,
          ...(method === "GET" || method === "HEAD" ? {} : { body: Buffer.concat(chunks) }),
        }),
        options,
      );
      response.writeHead(result.response.status, Object.fromEntries(result.response.headers));
      response.end(await result.response.text());
      // The hub only waits a few seconds: answer first, then run the handlers.
      if (result.confirmation) options.onConfirmation?.(result.confirmation);
      for (const notification of result.notifications) await options.onNotification(notification);
    })().catch((error) => {
      if (!response.headersSent) response.writeHead(500).end();
      onError(error);
    });
  };
}
