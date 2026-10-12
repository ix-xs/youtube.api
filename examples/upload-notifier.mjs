// Posts to a Discord channel whenever one of the watched channels uploads.
// No Discord library needed: a channel webhook is enough.
//
//   YOUTUBE_API_KEY=... DISCORD_WEBHOOK_URL=... node examples/upload-notifier.mjs @GoogleDevelopers @YouTube

import { YouTube } from "@ix-xs/youtube.api";

const channels = process.argv.slice(2);
const webhook = process.env.DISCORD_WEBHOOK_URL;
if (!channels.length || !webhook) {
  console.error("Usage: DISCORD_WEBHOOK_URL=... node examples/upload-notifier.mjs <channel> [more channels]");
  process.exit(1);
}

const yt = new YouTube();
const watcher = yt.watch(channels, { interval: "5m" });

watcher.on("video", async (video) => {
  console.log(`${video.channelTitle} uploaded "${video.title}"`);
  const response = await fetch(webhook, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      embeds: [
        {
          title: video.title,
          url: video.url,
          author: { name: video.channelTitle, url: `https://www.youtube.com/channel/${video.channelId}` },
          image: video.thumbnail ? { url: video.thumbnail } : undefined,
          timestamp: video.publishedAt,
          color: 0xff0000,
        },
      ],
    }),
  });
  if (!response.ok) console.warn(`Discord answered ${response.status}`);
});

watcher.on("error", ({ channel, error }) => console.warn(`Could not check ${channel}:`, error.message));

watcher.start();
console.log(`Watching ${channels.join(", ")}. Ctrl+C to stop.`);
process.once("SIGINT", () => watcher.stop());
