import { describe, expect, it } from "vitest";
import { YouTubeArgumentError } from "../src/index.js";
import { type Call, VIDEO_ID, apiError, client, json, list } from "./helpers.js";

const message = (id: string, text: string, type = "textMessageEvent") => ({
  id,
  snippet: { type, liveChatId: "chat1", publishedAt: "2026-01-01T00:00:00Z", hasDisplayContent: true, displayMessage: text },
  authorDetails: { channelId: "UCauthor", displayName: "Ada" },
});

const chatPage = (items: unknown[], next: string, extra: Record<string, unknown> = {}) => list(items, { nextPageToken: next, pollingIntervalMillis: 1, ...extra });

describe("live chat", () => {
  it("polls for new messages, skips the backlog, and stops when the chat ends", async () => {
    const { yt, calls } = client([
      chatPage([message("old", "before you joined")], "T1"),
      chatPage([message("m1", "hello"), message("m2", "hi", "superChatEvent")], "T2"),
      chatPage([], "T3"),
      chatPage([message("m3", "bye")], "T4", { offlineAt: "2026-01-01T01:00:00Z" }),
    ]);
    const texts: string[] = [];
    for await (const chatMessage of yt.liveChat("chat1").messages()) texts.push(`${chatMessage.snippet.type}:${chatMessage.snippet.displayMessage}`);
    expect(texts).toEqual(["textMessageEvent:hello", "superChatEvent:hi", "textMessageEvent:bye"]);
    expect(calls.map((call) => call.url.searchParams.get("pageToken"))).toEqual([null, "T1", "T2", "T3"]);
    expect(calls[0]!.url.searchParams.get("part")).toBe("snippet,authorDetails");
    expect(calls[0]!.url.searchParams.get("liveChatId")).toBe("chat1");
    expect(yt.quota.used).toBe(20);
  });

  it("can replay the backlog, and ends quietly when the chat is closed", async () => {
    const { yt } = client([chatPage([message("old", "backlog")], "T1"), apiError(403, "liveChatEnded")]);
    const texts: string[] = [];
    for await (const chatMessage of yt.liveChat("chat1").messages({ history: true })) texts.push(chatMessage.snippet.displayMessage ?? "");
    expect(texts).toEqual(["backlog"]);
  });

  it("lets other errors through", async () => {
    const { yt } = client(apiError(404, "liveChatNotFound"));
    const read = async () => {
      for await (const _ of yt.liveChat("nope").messages()) void _;
    };
    await expect(read()).rejects.toMatchObject({ code: "NOT_FOUND", reason: "liveChatNotFound" });
  });

  it("stops on abort and through listen()", async () => {
    let served = 0;
    const { yt } = client(() => chatPage([message(`m${served}`, `text ${served++}`)], `T${served}`));
    const chat = yt.liveChat("chat1");
    const received: string[] = [];
    const subscription = chat.listen((chatMessage) => {
      received.push(chatMessage.id);
      if (received.length === 3) subscription.stop();
    });
    await subscription.done;
    expect(received).toEqual(["m1", "m2", "m3"]);

    const controller = new AbortController();
    controller.abort();
    const none: unknown[] = [];
    for await (const chatMessage of chat.messages({ signal: controller.signal })) none.push(chatMessage);
    expect(none).toEqual([]);
  });

  it("reports read errors through onError or the done promise", async () => {
    const { yt } = client(apiError(403, "forbidden"), { retry: false });
    const errors: unknown[] = [];
    await yt.liveChat("chat1").listen(() => {}, { onError: (error) => errors.push(error) }).done;
    expect(errors).toHaveLength(1);
    await expect(yt.liveChat("chat1").listen(() => {}).done).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("sends, deletes and moderates", async () => {
    const { yt, calls } = client((call: Call) => (call.method === "DELETE" ? new Response(null, { status: 204 }) : call.method === "GET" ? list([{ id: "mod1" }]) : json({ id: "created" })), {
      accessToken: "t",
    });
    const chat = yt.liveChat("chat1");
    await chat.send("Hello chat");
    expect(calls[0]!.body).toEqual({ snippet: { liveChatId: "chat1", type: "textMessageEvent", textMessageDetails: { messageText: "Hello chat" } } });
    await chat.ban("UCtroll", { duration: "5m" });
    expect(calls[1]!.body).toEqual({ snippet: { liveChatId: "chat1", type: "temporary", bannedUserDetails: { channelId: "UCtroll" }, banDurationSeconds: "300" } });
    await chat.ban("UCtroll");
    expect((calls[2]!.body as { snippet: { type: string } }).snippet.type).toBe("permanent");
    await chat.unban("ban1");
    await chat.delete("m1");
    await chat.addModerator("UCfriend");
    await chat.removeModerator("mod1");
    expect(await chat.moderators()).toEqual([{ id: "mod1" }]);
    expect(calls.slice(3).map((call) => `${call.method} ${call.url.pathname.replace("/youtube/v3/liveChat/", "")}`)).toEqual([
      "DELETE bans",
      "DELETE messages",
      "POST moderators",
      "DELETE moderators",
      "GET moderators",
    ]);
    expect(yt.quota.used).toBe(20 + 200 + 200 + 200 + 20 + 200 + 200 + 50);
  });

  it("opens the chat of a live video", async () => {
    const { yt, calls } = client([list([{ id: VIDEO_ID, liveStreamingDetails: { activeLiveChatId: "chat42" } }]), list([{ id: VIDEO_ID, liveStreamingDetails: {} }]), list([])]);
    expect((await yt.liveChatOf(`https://www.youtube.com/live/${VIDEO_ID}`)).id).toBe("chat42");
    expect(calls[0]!.url.searchParams.get("part")).toBe("liveStreamingDetails");
    await expect(yt.liveChatOf(VIDEO_ID)).rejects.toThrow(/no active live chat/);
    await expect(yt.liveChatOf(VIDEO_ID)).rejects.toThrow(/does not exist/);
    await expect(yt.liveChatOf("nope")).rejects.toBeInstanceOf(YouTubeArgumentError);
    expect(() => yt.liveChat("")).toThrow(YouTubeArgumentError);
  });

  it("reads a streamed response whatever the chunk boundaries", async () => {
    const batches = [chatPage([message("m1", 'brace } and "quote" in text')], "T1"), chatPage([message("m2", "second")], "T2")];
    const payload = new TextEncoder().encode(`[${JSON.stringify(batches[0])}\n,\n${JSON.stringify(batches[1])}]`);
    for (const size of [1, 7, 64, payload.length]) {
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          for (let offset = 0; offset < payload.length; offset += size) controller.enqueue(payload.subarray(offset, offset + size));
          controller.close();
        },
      });
      const { yt, calls } = client(new Response(stream));
      const seen: string[] = [];
      for await (const batch of yt.liveChatMessages.stream({ liveChatId: "chat1", part: ["snippet", "authorDetails"] })) {
        seen.push(...(batch.items ?? []).map((item) => item.snippet?.displayMessage ?? ""));
      }
      expect(seen, `chunks of ${size}`).toEqual(['brace } and "quote" in text', "second"]);
      expect(calls[0]!.url.pathname).toBe("/youtube/v3/liveChat/messages/stream");
    }
  });
});
