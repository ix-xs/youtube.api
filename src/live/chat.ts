import type { YouTube } from "../client.js";
import { YouTubeApiError, YouTubeArgumentError, YouTubeRequestError } from "../core/errors.js";
import type { RequestOptions } from "../core/rest.js";
import { type Duration, sleep, toMs } from "../core/time.js";
import { METHODS } from "../generated/methods.js";
import type { LiveChatMessagesStreamParams } from "../generated/params.js";
import { LiveChatMessagesApi } from "../generated/resources.js";
import type { LiveChatBan, LiveChatMessage, LiveChatMessageListResponse, LiveChatModerator } from "../generated/schemas.js";

/** A chat message with its content and its author, as the chat helpers deliver it. */
export type ChatMessage = LiveChatMessage<"snippet" | "authorDetails">;

/**
 * Finds complete top-level JSON objects in a byte stream, whatever wraps them:
 * a JSON array sent piece by piece, newline-delimited JSON or server-sent
 * events.
 */
async function* jsonObjects(stream: ReadableStream<Uint8Array>): AsyncGenerator<unknown, void, undefined> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let scanned = 0;
  let depth = 0;
  let start = -1;
  let inString = false;
  let escaped = false;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) return;
      buffer += decoder.decode(value, { stream: true });
      for (; scanned < buffer.length; scanned++) {
        const char = buffer[scanned];
        if (inString) {
          if (escaped) escaped = false;
          else if (char === "\\") escaped = true;
          else if (char === '"') inString = false;
        } else if (char === '"') inString = depth > 0;
        else if (char === "{") {
          if (depth++ === 0) start = scanned;
        } else if (char === "}" && depth > 0 && --depth === 0) {
          yield JSON.parse(buffer.slice(start, scanned + 1));
          start = -1;
        }
      }
      // Drop what was consumed, keep an object that is still arriving.
      buffer = start === -1 ? "" : buffer.slice(start);
      scanned = buffer.length;
      if (start !== -1) start = 0;
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
}

/** `yt.liveChatMessages`: the raw methods, plus the streaming variant of `list`. */
export class LiveChatMessages extends LiveChatMessagesApi {
  /**
   * Receives chat messages over one long-lived connection instead of polling.
   * Each value is a batch shaped like a `list` response; pass its
   * `nextPageToken` to resume after a disconnect.
   *
   * YouTube documents this method for gRPC. This goes through the HTTP
   * mapping of the same method, which Google does not document: treat it as
   * experimental, and prefer {@link LiveChat.messages}, which polls, when you
   * need something dependable.
   *
   * Quota: 5 units per connection.
   *
   * @see https://developers.google.com/youtube/v3/live/docs/liveChatMessages/streamList
   */
  async *stream(params: LiveChatMessagesStreamParams, options?: RequestOptions): AsyncGenerator<LiveChatMessageListResponse, void, undefined> {
    const response = await this.rest.raw(METHODS["liveChatMessages.stream"], { ...params }, options);
    if (!response.body) return;
    for await (const batch of jsonObjects(response.body)) yield batch as LiveChatMessageListResponse;
  }
}

/** Options of {@link LiveChat.messages} and {@link LiveChat.listen}. */
export interface ChatReadOptions {
  /** Stops reading. */
  signal?: AbortSignal | undefined;
  /**
   * Also deliver the messages already in the chat when reading starts.
   * Default false: only messages posted from now on.
   */
  history?: boolean | undefined;
  /**
   * Never ask more often than this, even when YouTube allows it. Each request
   * costs 5 units, so a slower pace stretches the quota. Default: the pace
   * YouTube gives, a few seconds. In `"stream"` mode it is the pause before
   * reconnecting when the connection closes.
   */
  minInterval?: Duration | undefined;
  /** Size in pixels of the authors' profile pictures, between 16 and 720. */
  profileImageSize?: number | undefined;
  /** Language of the system messages, for example `"fr"`. */
  hl?: string | undefined;
  /** `"poll"` (default) asks again at the pace YouTube gives. `"stream"` keeps one connection open, experimental. */
  mode?: "poll" | "stream" | undefined;
}

/** Handle returned by {@link LiveChat.listen}. */
export interface ChatSubscription {
  /** Stops listening. */
  stop(): void;
  /** Settles when listening is over: the chat ended, `stop()` was called, or reading failed. */
  done: Promise<void>;
}

const ENDED = new Set(["liveChatEnded", "liveChatDisabled"]);

/**
 * One live chat: read it, write to it, moderate it. Get one with
 * `yt.liveChat(liveChatId)` or `await yt.liveChatOf(video)`.
 *
 * Reading works with an API key. Everything else needs OAuth.
 *
 * @example
 * const chat = await yt.liveChatOf("https://www.youtube.com/watch?v=jfKfPfyJRdk");
 * for await (const message of chat.messages()) {
 *   console.log(`${message.authorDetails.displayName}: ${message.snippet.displayMessage}`);
 *   if (message.snippet.type === "superChatEvent") {
 *     console.log("Super Chat!", message.snippet.superChatDetails?.amountDisplayString);
 *   }
 * }
 */
export class LiveChat {
  /** The live chat id, `liveStreamingDetails.activeLiveChatId` on the video. */
  readonly id: string;
  readonly #yt: YouTube;

  /** @internal */
  constructor(yt: YouTube, liveChatId: string) {
    if (!liveChatId) throw new YouTubeArgumentError("A live chat id is required.");
    this.#yt = yt;
    this.id = liveChatId;
  }

  /**
   * Yields chat messages as they arrive, until the chat ends or `signal`
   * aborts. Switch on `message.snippet.type` to tell text messages from Super
   * Chats, new members, polls and the rest.
   *
   * Quota: 5 units per request, one request every few seconds.
   */
  async *messages(options: ChatReadOptions = {}): AsyncGenerator<ChatMessage, void, undefined> {
    const { signal, history = false } = options;
    const minInterval = options.minInterval !== undefined ? toMs(options.minInterval) : 0;
    // A cached page would replay old messages as if they were new.
    const request: RequestOptions = { signal, cache: false };
    const base = {
      part: ["snippet", "authorDetails"] as const,
      liveChatId: this.id,
      ...(options.hl !== undefined ? { hl: options.hl } : {}),
      ...(options.profileImageSize !== undefined ? { profileImageSize: options.profileImageSize } : {}),
    };
    let pageToken: string | undefined;
    let first = true;

    while (!signal?.aborted) {
      const params = { ...base, ...(pageToken ? { pageToken } : {}) };
      try {
        if (options.mode === "stream") {
          for await (const batch of this.#yt.liveChatMessages.stream({ ...params, part: [...base.part] }, request)) {
            if (!first || history) yield* (batch.items ?? []) as ChatMessage[];
            first = false;
            pageToken = batch.nextPageToken ?? pageToken;
            if (batch.offlineAt) return;
          }
          // The server closed the connection: reconnect from the last token after a short pause.
          await sleep(Math.max(1000, minInterval), signal);
          continue;
        }
        const page = await this.#yt.liveChatMessages.list({ ...params, maxResults: 2000 }, request);
        if (!first || history) yield* page.items;
        first = false;
        if (page.raw.offlineAt) return;
        pageToken = page.nextPageToken ?? pageToken;
        await sleep(Math.max(page.raw.pollingIntervalMillis ?? 5000, minInterval), signal);
      } catch (error) {
        if (signal?.aborted) return;
        if (error instanceof YouTubeRequestError && error.code === "ABORTED") return;
        if (error instanceof YouTubeApiError && error.reason && ENDED.has(error.reason)) return;
        throw error;
      }
    }
  }

  /**
   * Callback flavour of {@link messages}: calls `onMessage` for each message
   * and returns a handle to stop.
   *
   * @example
   * const subscription = chat.listen((message) => {
   *   if (message.snippet.displayMessage === "!hello") void chat.send("Hello!");
   * });
   * // later
   * subscription.stop();
   */
  listen(onMessage: (message: ChatMessage) => void | Promise<void>, options: Omit<ChatReadOptions, "signal"> & { onError?: (error: unknown) => void } = {}): ChatSubscription {
    const controller = new AbortController();
    const { onError, ...read } = options;
    const done = (async () => {
      try {
        for await (const message of this.messages({ ...read, signal: controller.signal })) await onMessage(message);
      } catch (error) {
        if (!onError) throw error;
        onError(error);
      }
    })();
    // Without an error handler the failure surfaces through `done`.
    done.catch(() => {});
    return { stop: () => controller.abort(), done };
  }

  /**
   * Sends a text message to the chat as the authenticated user.
   *
   * Quota: 20 units.
   */
  send(text: string, options?: RequestOptions): Promise<ChatMessage> {
    return this.#yt.liveChatMessages.insert(
      { part: ["snippet", "authorDetails"], body: { snippet: { liveChatId: this.id, type: "textMessageEvent", textMessageDetails: { messageText: text } } } },
      options,
    );
  }

  /** Deletes a message. For the channel owner and moderators. Quota: 20 units. */
  delete(messageId: string, options?: RequestOptions): Promise<void> {
    return this.#yt.liveChatMessages.delete({ id: messageId }, options);
  }

  /**
   * Bans a user from the chat: for good, or for a while when `duration` is
   * given. Keep the returned ban's `id` to lift it with {@link unban}.
   *
   * Quota: 200 units.
   *
   * @example
   * await chat.ban(message.authorDetails.channelId, { duration: "5m" });
   */
  ban(channelId: string, options: RequestOptions & { duration?: Duration | undefined } = {}): Promise<LiveChatBan<"snippet">> {
    const { duration, ...request } = options;
    const snippet: Record<string, unknown> = { liveChatId: this.id, type: duration === undefined ? "permanent" : "temporary", bannedUserDetails: { channelId } };
    if (duration !== undefined) snippet.banDurationSeconds = String(Math.max(1, Math.round(toMs(duration) / 1000)));
    return this.#yt.liveChatBans.insert({ part: "snippet", body: { snippet } }, request);
  }

  /** Lifts a ban. Quota: 200 units. */
  unban(banId: string, options?: RequestOptions): Promise<void> {
    return this.#yt.liveChatBans.delete({ id: banId }, options);
  }

  /** Lists the moderators of the chat. Quota: 50 units per page. */
  moderators(options?: RequestOptions): Promise<LiveChatModerator<"snippet">[]> {
    return this.#yt.liveChatModerators.list({ part: "snippet", liveChatId: this.id }, options).all();
  }

  /** Makes a user a moderator. Quota: 200 units. */
  addModerator(channelId: string, options?: RequestOptions): Promise<LiveChatModerator<"snippet">> {
    return this.#yt.liveChatModerators.insert({ part: "snippet", body: { snippet: { liveChatId: this.id, moderatorDetails: { channelId } } } }, options);
  }

  /** Removes a moderator, by the id of the moderator resource. Quota: 200 units. */
  removeModerator(moderatorId: string, options?: RequestOptions): Promise<void> {
    return this.#yt.liveChatModerators.delete({ id: moderatorId }, options);
  }
}
