// Prints the chat of a live stream as it happens. Reading only needs an API key.
// Each request costs 5 quota units, so a default key lasts a few hours of chat.
//
//   YOUTUBE_API_KEY=... node examples/live-chat.mjs https://www.youtube.com/watch?v=jfKfPfyJRdk

import { YouTube } from "@ix-xs/youtube.api";

const video = process.argv[2];
if (!video) {
  console.error("Usage: node examples/live-chat.mjs <url or id of a live video>");
  process.exit(1);
}

const yt = new YouTube();
const chat = await yt.liveChatOf(video);
const stop = new AbortController();
process.once("SIGINT", () => stop.abort());

console.log("Reading the chat. Ctrl+C to stop.\n");
for await (const message of chat.messages({ signal: stop.signal, minInterval: "5s" })) {
  const author = message.authorDetails.displayName;
  switch (message.snippet.type) {
    case "superChatEvent":
      console.log(`[Super Chat ${message.snippet.superChatDetails?.amountDisplayString}] ${author}: ${message.snippet.superChatDetails?.userComment ?? ""}`);
      break;
    case "newSponsorEvent":
      console.log(`[New member] ${author}`);
      break;
    default:
      if (message.snippet.displayMessage) console.log(`${author}: ${message.snippet.displayMessage}`);
  }
}

console.log(`\nChat closed. Quota spent: ${yt.quota.used} units`);
