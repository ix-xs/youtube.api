// Prints a channel's latest videos with their length and view count.
//
//   YOUTUBE_API_KEY=... node examples/latest-videos.mjs @GoogleDevelopers

import { YouTube, formatCount, formatDuration } from "@ix-xs/youtube.api";

const channel = process.argv[2] ?? "@GoogleDevelopers";
const yt = new YouTube(); // reads YOUTUBE_API_KEY

const found = await yt.channels.get(channel, { part: ["snippet", "statistics"] });
if (!found) {
  console.error(`No channel found for ${channel}`);
  process.exit(1);
}
console.log(`${found.snippet.title}: ${formatCount(found.statistics.subscriberCount ?? 0)} subscribers\n`);

for (const video of await yt.channels.latestVideos(found.id, { limit: 5 })) {
  const length = formatDuration(video.contentDetails.duration).padStart(8);
  const views = formatCount(video.statistics.viewCount).padStart(6);
  console.log(`${length}  ${views} views  ${video.snippet.title}`);
}

console.log(`\nQuota spent: ${yt.quota.used} units`);
