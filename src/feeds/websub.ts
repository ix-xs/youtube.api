import { YouTubeArgumentError, YouTubeRequestError } from "../core/errors.js";
import { type Duration, toMs } from "../core/time.js";
import { isChannelId } from "../utils/ids.js";
import { children, parseXml, textOf } from "../utils/xml.js";
import { parseEntry } from "./feed.js";

const HUB = "https://pubsubhubbub.appspot.com/subscribe";
const MAX_BODY = 1024 * 1024;

/** A push notification from YouTube. */
export type WebSubNotification =
  | {
      /** A video was published, or its title or description changed. YouTube does not say which. */
      type: "video";
      videoId: string;
      channelId: string;
      title: string;
      url: string;
      author: { name: string; url: string | undefined };
      /** ISO 8601 date the video went public. */
      publishedAt: string;
      /** ISO 8601 date of this notification's change. */
      updatedAt: string;
    }
  | {
      /** A video was deleted or made private. */
      type: "deleted";
      videoId: string;
      channelId: string | undefined;
      /** ISO 8601 date of the deletion. */
      deletedAt: string | undefined;
    };

/** Options of {@link websub.subscribe} and {@link websub.unsubscribe}. */
export interface WebSubSubscribeOptions {
  /** Channel to follow, as a `UC...` id. */
  channelId: string;
  /** Public HTTPS URL of your endpoint. The hub calls it to confirm, then for every notification. */
  callbackUrl: string;
  /**
   * Shared secret. When set, the hub signs every notification and
   * {@link websub.receive} rejects forged ones. Use one: the callback URL is public.
   */
  secret?: string;
  /** How long the subscription lasts. The hub caps it at about 10 days; renew before it lapses. Default `"5d"`. */
  lease?: Duration;
  signal?: AbortSignal;
  /** Custom `fetch`. */
  fetch?: typeof fetch;
}

/** What {@link websub.receive} read from a request. */
export interface WebSubResult {
  /** Send this back as the HTTP response. */
  response: Response;
  /** Notifications carried by the request. Empty for a confirmation or a rejected signature. */
  notifications: WebSubNotification[];
  /** Set when the request was the hub confirming a subscription or its removal. */
  confirmation: { mode: "subscribe" | "unsubscribe"; topic: string; channelId: string | undefined; leaseSeconds: number | undefined } | undefined;
  /** False when a secret was expected and the signature was missing or wrong. */
  verified: boolean;
}

/** Options of {@link websub.receive}. */
export interface WebSubReceiveOptions {
  /** The secret given to `subscribe()`. Notifications without a valid signature are dropped. */
  secret?: string;
  /**
   * Decides whether to confirm a subscription the hub asks about. Return
   * false for a topic you never asked for. Default: confirm everything.
   */
  confirm?: (request: { mode: "subscribe" | "unsubscribe"; topic: string; channelId: string | undefined }) => boolean | Promise<boolean>;
}

/** The topic URL of a channel, which identifies the subscription at the hub. */
function topicUrl(channelId: string): string {
  if (!isChannelId(channelId)) throw new YouTubeArgumentError(`"${channelId}" is not a channel id. Resolve a handle with yt.channels.resolveId() first.`);
  return `https://www.youtube.com/xml/feeds/videos.xml?channel_id=${channelId}`;
}

async function hubRequest(mode: "subscribe" | "unsubscribe", options: WebSubSubscribeOptions): Promise<void> {
  const body = new URLSearchParams({
    "hub.mode": mode,
    "hub.topic": topicUrl(options.channelId),
    "hub.callback": options.callbackUrl,
    "hub.verify": "async",
  });
  if (mode === "subscribe") body.set("hub.lease_seconds", String(Math.round(toMs(options.lease ?? "5d") / 1000)));
  if (options.secret) body.set("hub.secret", options.secret);
  const fetchImpl = options.fetch ?? globalThis.fetch;
  let response: Response;
  try {
    response = await fetchImpl(HUB, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: body.toString(),
      signal: options.signal ?? null,
    });
  } catch (cause) {
    throw new YouTubeRequestError(options.signal?.aborted ? "ABORTED" : "NETWORK", `websub.${mode}`, `could not reach the hub (${(cause as Error)?.message ?? cause}).`, { cause });
  }
  const text = await response.text().catch(() => "");
  if (!response.ok) throw new YouTubeRequestError("NETWORK", `websub.${mode}`, `the hub answered ${response.status}${text ? `: ${text.trim().slice(0, 200)}` : ""}.`);
}

function parse(xml: string): WebSubNotification[] {
  const feed = parseXml(xml).children.find((node) => node.name === "feed");
  if (!feed) return [];
  const notifications: WebSubNotification[] = [];
  for (const entry of children(feed, "entry")) {
    const video = parseEntry(entry);
    if (!video) continue;
    notifications.push({
      type: "video",
      videoId: video.videoId,
      channelId: video.channelId,
      title: video.title,
      url: video.url,
      author: video.author,
      publishedAt: video.publishedAt,
      updatedAt: video.updatedAt,
    });
  }
  for (const tombstone of children(feed, "at:deleted-entry")) {
    const videoId = tombstone.attributes.ref?.replace(/^yt:video:/, "");
    if (!videoId) continue;
    const by = tombstone.children.find((node) => node.name === "at:by");
    notifications.push({
      type: "deleted",
      videoId,
      channelId: textOf(by, "uri")?.split("/channel/")[1],
      deletedAt: tombstone.attributes.when,
    });
  }
  return notifications;
}

function hex(buffer: ArrayBuffer): string {
  return [...new Uint8Array(buffer)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function verify(body: string | Uint8Array, header: string | null | undefined, secret: string): Promise<boolean> {
  const match = /^(sha1|sha256|sha384|sha512)=([\da-f]+)$/i.exec(header?.trim() ?? "");
  if (!match) return false;
  const hash = { sha1: "SHA-1", sha256: "SHA-256", sha384: "SHA-384", sha512: "SHA-512" }[match[1]!.toLowerCase()]!;
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash }, false, ["sign"]);
  const data = typeof body === "string" ? encoder.encode(body) : body;
  const expected = hex(await crypto.subtle.sign("HMAC", key, data as unknown as ArrayBuffer));
  const given = match[2]!.toLowerCase();
  // Compare every character so the time taken says nothing about where they differ.
  let diff = expected.length ^ given.length;
  for (let index = 0; index < expected.length; index++) diff |= expected.charCodeAt(index) ^ (given.charCodeAt(index) || 0);
  return diff === 0;
}

const channelOf = (topic: string): string | undefined => /[?&]channel_id=([\w-]+)/.exec(topic)?.[1];

async function receive(request: Request, options: WebSubReceiveOptions = {}): Promise<WebSubResult> {
  const empty = { notifications: [] as WebSubNotification[], confirmation: undefined, verified: true };

  if (request.method === "GET") {
    const params = new URL(request.url).searchParams;
    const mode = params.get("hub.mode");
    const topic = params.get("hub.topic");
    const challenge = params.get("hub.challenge");
    if ((mode !== "subscribe" && mode !== "unsubscribe") || !topic || !challenge) {
      return { ...empty, response: new Response("Not a WebSub verification request.", { status: 400 }) };
    }
    const channelId = channelOf(topic);
    const accepted = options.confirm ? await options.confirm({ mode, topic, channelId }) : true;
    if (!accepted) return { ...empty, response: new Response("Unknown subscription.", { status: 404 }) };
    const lease = Number(params.get("hub.lease_seconds"));
    return {
      ...empty,
      confirmation: { mode, topic, channelId, leaseSeconds: Number.isFinite(lease) && lease > 0 ? lease : undefined },
      response: new Response(challenge, { status: 200, headers: { "content-type": "text/plain" } }),
    };
  }

  if (request.method !== "POST") {
    return { ...empty, response: new Response("Method not allowed.", { status: 405, headers: { allow: "GET, POST" } }) };
  }
  const body = await request.text();
  // A notification is a few kilobytes. Anything huge is not one.
  if (body.length > MAX_BODY) return { ...empty, verified: false, response: new Response("Payload too large.", { status: 413 }) };
  if (options.secret) {
    const signature = request.headers.get("x-hub-signature-256") ?? request.headers.get("x-hub-signature");
    if (!(await verify(body, signature, options.secret))) {
      // The spec asks for a success status here, so a forger learns nothing.
      return { ...empty, verified: false, response: new Response(null, { status: 202 }) };
    }
  }
  return { ...empty, notifications: parse(body), response: new Response(null, { status: 204 }) };
}

/**
 * Push notifications for new uploads, through the WebSub hub YouTube
 * publishes to. No API key, no quota, and no polling: the hub calls your
 * endpoint within seconds of an upload.
 *
 * You need a public HTTPS endpoint. Subscriptions expire, so renew them
 * before the lease ends (calling `subscribe` again is enough).
 *
 * @example
 * // 1. Ask the hub to notify your endpoint.
 * await websub.subscribe({
 *   channelId: "UC_x5XG1OV2P6uZZ5FSM9Ttw",
 *   callbackUrl: "https://example.com/youtube/webhook",
 *   secret: process.env.WEBSUB_SECRET,
 * });
 *
 * // 2. Handle the hub's calls. Works anywhere a Request comes in:
 * //    Hono, Next.js route handlers, Bun, Deno, Cloudflare Workers.
 * export async function handler(request: Request): Promise<Response> {
 *   const { response, notifications } = await websub.receive(request, { secret: process.env.WEBSUB_SECRET });
 *   for (const notification of notifications) {
 *     if (notification.type === "video") console.log("New or updated:", notification.title, notification.url);
 *   }
 *   return response;
 * }
 * @see https://developers.google.com/youtube/v3/guides/push_notifications
 */
export const websub = Object.freeze({
  /** Address of the hub. */
  hub: HUB,
  topicUrl,
  /**
   * Asks the hub to send a channel's notifications to your callback URL. The
   * hub then calls that URL to confirm, which {@link receive} answers.
   * Calling it again renews the lease.
   */
  subscribe: (options: WebSubSubscribeOptions): Promise<void> => hubRequest("subscribe", options),
  /** Asks the hub to stop notifying your callback URL. */
  unsubscribe: (options: WebSubSubscribeOptions): Promise<void> => hubRequest("unsubscribe", options),
  /**
   * Handles a request the hub sent to your callback URL: answers
   * confirmations, checks signatures and parses notifications. Always send
   * back `result.response`.
   */
  receive,
  /** Parses the Atom body of a notification. */
  parse,
  /** Checks the `X-Hub-Signature` header of a notification against your secret. */
  verify,
});
