import type { YouTube } from "../client.js";
import { Emitter } from "../core/emitter.js";
import { YouTubeArgumentError, isYouTubeError } from "../core/errors.js";
import { type Duration, toMs } from "../core/time.js";
import { bestThumbnail } from "../utils/format.js";
import { isChannelId, urls } from "../utils/ids.js";
import { fetchFeed } from "./feed.js";

/** A video found by a {@link Watcher}. */
export interface WatchedVideo {
  videoId: string;
  channelId: string;
  channelTitle: string;
  title: string;
  url: string;
  /** ISO 8601 date the video went public. */
  publishedAt: string;
  /** Largest thumbnail available, when there is one. */
  thumbnail: string | undefined;
  /** Whether it is a Short. Only known when the video came from the feed. */
  isShort: boolean | undefined;
  /** Where the watcher learnt about it. */
  source: "feed" | "api";
}

/** Options of a {@link Watcher}. */
export interface WatcherOptions {
  /** Time between two rounds. Default `"5m"`. */
  interval?: Duration;
  /**
   * Where to look for new videos.
   *
   * - `"auto"` (default): the public feed, which is free, and the API when
   *   the feed fails. Without an API client it is the feed only.
   * - `"feed"`: the public feed only. No quota, but YouTube does not guarantee it.
   * - `"api"`: the uploads playlist through the API. 1 unit per channel per round.
   */
  source?: "auto" | "feed" | "api";
  /**
   * Report videos published after this moment. Default: the moment the
   * watcher is created, so only uploads from now on. Give the time of your
   * last run to catch up after a restart.
   */
  since?: Date | string | number;
  /** Custom `fetch`, for the feed requests. */
  fetch?: typeof fetch;
}

/** Events of a {@link Watcher}. */
export interface WatcherEvents {
  /** A new video was found. */
  video: WatchedVideo;
  /** Checking a channel failed. The watcher keeps going. */
  error: { channel: string; error: unknown };
  /** A channel was checked. */
  poll: { channel: string; channelId: string; source: "feed" | "api"; found: number };
}

interface ChannelState {
  ref: string;
  id: string | undefined;
  seen: Set<string>;
  /** The feed of this channel failed: until then, the API is asked instead. */
  feedDownUntil: number;
}

/** How long the feed of a channel is left alone after it failed. Outages last hours. */
const FEED_COOLDOWN = 30 * 60_000;
const SEEN_LIMIT = 500;

/**
 * Watches channels for new uploads and tells you when one appears. This is
 * the polling approach: it needs no public endpoint. For push delivery, see
 * `websub`.
 *
 * Create one with `yt.watch(channels)` to accept handles and URLs and to fall
 * back on the API when the feed is down. `new Watcher(channelIds)` works
 * without any API key, from the public feed alone.
 *
 * @example
 * const watcher = yt.watch(["@GoogleDevelopers", "@YouTube"], { interval: "5m" });
 * watcher.on("video", (video) => console.log(`${video.channelTitle} uploaded ${video.title}: ${video.url}`));
 * watcher.on("error", ({ channel, error }) => console.warn(channel, error));
 * watcher.start();
 *
 * // Or as a stream:
 * for await (const video of yt.watch(["@GoogleDevelopers"])) {
 *   console.log(video.title);
 * }
 */
export class Watcher extends Emitter<WatcherEvents> implements AsyncIterable<WatchedVideo> {
  readonly #channels = new Map<string, ChannelState>();
  readonly #client: YouTube | undefined;
  readonly #interval: number;
  readonly #source: "auto" | "feed" | "api";
  readonly #fetch: typeof fetch | undefined;
  #since: number;
  #timer: ReturnType<typeof setTimeout> | undefined;
  #running = false;
  #checking: Promise<WatchedVideo[]> | undefined;

  constructor(channels: readonly string[] = [], options: WatcherOptions = {}, client?: YouTube) {
    super();
    this.#client = client;
    this.#interval = toMs(options.interval ?? "5m");
    this.#source = options.source ?? "auto";
    this.#fetch = options.fetch;
    this.#since = options.since !== undefined ? new Date(options.since).getTime() : Date.now();
    if (Number.isNaN(this.#since)) throw new YouTubeArgumentError("Watcher: `since` is not a valid date.");
    if (this.#source === "api" && !client) throw new YouTubeArgumentError('Watcher: `source: "api"` needs an API client. Create the watcher with yt.watch().');
    for (const channel of channels) this.add(channel);
  }

  /** The channels being watched, as they were given. */
  get channels(): string[] {
    return [...this.#channels.values()].map((state) => state.ref);
  }

  /** Whether the watcher is polling. */
  get running(): boolean {
    return this.#running;
  }

  /** Starts watching another channel. Its current videos are not reported, only later ones. */
  add(channel: string): this {
    const key = channel.trim().toLowerCase();
    if (!key) throw new YouTubeArgumentError("Watcher: empty channel.");
    if (!this.#client && !isChannelId(channel.trim())) {
      throw new YouTubeArgumentError(`Watcher: "${channel}" is not a channel id. Handles and URLs need an API client to be resolved: create the watcher with yt.watch().`);
    }
    if (!this.#channels.has(key)) this.#channels.set(key, { ref: channel.trim(), id: undefined, seen: new Set(), feedDownUntil: 0 });
    return this;
  }

  /** Stops watching a channel. */
  remove(channel: string): this {
    this.#channels.delete(channel.trim().toLowerCase());
    return this;
  }

  /** Starts polling: one round now, then one per interval. */
  start(): this {
    if (this.#running) return this;
    this.#running = true;
    const tick = async () => {
      await this.check().catch(() => {});
      if (this.#running) this.#timer = setTimeout(tick, this.#interval);
    };
    void tick();
    return this;
  }

  /** Stops polling. */
  stop(): void {
    this.#running = false;
    if (this.#timer) clearTimeout(this.#timer);
    this.#timer = undefined;
  }

  /**
   * Runs one round now and resolves to the new videos, oldest first. They are
   * also emitted as `video` events. Useful from a cron job, where there is no
   * long-lived process: pass `since` to the watcher and call `check()`.
   */
  check(): Promise<WatchedVideo[]> {
    this.#checking ??= this.#round().finally(() => {
      this.#checking = undefined;
    });
    return this.#checking;
  }

  async #round(): Promise<WatchedVideo[]> {
    const states = [...this.#channels.values()];
    const found: WatchedVideo[] = [];
    let cursor = 0;
    const worker = async () => {
      while (cursor < states.length) {
        const state = states[cursor++]!;
        try {
          found.push(...(await this.#poll(state)));
        } catch (error) {
          this.emit("error", { channel: state.ref, error });
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(4, states.length) }, worker));
    found.sort((a, b) => Date.parse(a.publishedAt) - Date.parse(b.publishedAt));
    for (const video of found) this.emit("video", video);
    return found;
  }

  async #poll(state: ChannelState): Promise<WatchedVideo[]> {
    if (!state.id) {
      const id = isChannelId(state.ref) ? state.ref : await this.#client?.channels.resolveId(state.ref);
      if (!id) throw new YouTubeArgumentError(`No channel found for "${state.ref}".`);
      state.id = id;
    }
    const { videos, source } = await this.#read(state, state.id);
    const fresh = videos.filter((video) => !state.seen.has(video.videoId) && Date.parse(video.publishedAt) > this.#since);
    for (const video of videos) state.seen.add(video.videoId);
    if (state.seen.size > SEEN_LIMIT) {
      state.seen = new Set([...state.seen].slice(-SEEN_LIMIT));
    }
    this.emit("poll", { channel: state.ref, channelId: state.id, source, found: fresh.length });
    return fresh;
  }

  async #read(state: ChannelState, channelId: string): Promise<{ videos: WatchedVideo[]; source: "feed" | "api" }> {
    const useFeed = this.#source === "feed" || (this.#source === "auto" && (!this.#client || Date.now() >= state.feedDownUntil));
    if (useFeed) {
      try {
        return { videos: await this.#fromFeed(channelId), source: "feed" };
      } catch (error) {
        if (this.#source === "feed" || !this.#client) throw error;
        state.feedDownUntil = Date.now() + FEED_COOLDOWN;
      }
    }
    return { videos: await this.#fromApi(channelId), source: "api" };
  }

  async #fromFeed(channelId: string): Promise<WatchedVideo[]> {
    const feed = await fetchFeed(channelId, this.#fetch ? { fetch: this.#fetch } : {});
    return feed.entries.map((entry) => ({
      videoId: entry.videoId,
      channelId,
      channelTitle: entry.author.name || feed.title,
      title: entry.title,
      url: entry.url,
      publishedAt: entry.publishedAt,
      thumbnail: entry.thumbnail?.url,
      isShort: entry.isShort,
      source: "feed" as const,
    }));
  }

  async #fromApi(channelId: string): Promise<WatchedVideo[]> {
    try {
      const items = await this.#client!.channels.uploads(channelId, { part: ["snippet", "contentDetails"], cache: false }).take(15);
      return items.map((item) => ({
        videoId: item.contentDetails.videoId,
        channelId,
        channelTitle: item.snippet.videoOwnerChannelTitle ?? item.snippet.channelTitle,
        title: item.snippet.title,
        url: urls.video(item.contentDetails.videoId),
        publishedAt: item.contentDetails.videoPublishedAt ?? item.snippet.publishedAt,
        thumbnail: bestThumbnail(item.snippet.thumbnails)?.url,
        isShort: undefined,
        source: "api" as const,
      }));
    } catch (error) {
      // A channel without uploads has no uploads playlist yet.
      if (isYouTubeError(error, "NOT_FOUND")) return [];
      throw error;
    }
  }

  /** Streams new videos. Starts the watcher, and stops it when the loop is left. */
  async *[Symbol.asyncIterator](): AsyncGenerator<WatchedVideo, void, undefined> {
    const queue: WatchedVideo[] = [];
    let wake: (() => void) | undefined;
    const off = this.on("video", (video) => {
      queue.push(video);
      wake?.();
    });
    this.start();
    try {
      while (this.#running) {
        while (queue.length) yield queue.shift()!;
        await new Promise<void>((resolve) => {
          wake = resolve;
          // Wake up regularly to notice a stop() from elsewhere.
          setTimeout(resolve, Math.min(this.#interval, 1000));
        });
      }
    } finally {
      off();
      this.stop();
    }
  }
}
