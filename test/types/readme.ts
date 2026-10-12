// The code samples of README.md, compiled by `npm run test:types` so the
// front page of the package cannot drift from the library.

import {
  OAuth2,
  YouTube,
  YouTubeApiError,
  bestThumbnail,
  channelPlaylistId,
  formatDuration,
  isYouTubeError,
  oEmbed,
  parseDuration,
  parseUrl,
  quotaCost,
  urls,
  websub,
} from "../../src/index.js";
import { authorize, fileMedia, tokenFile } from "../../src/node.js";

declare const apiKey: string, clientId: string, clientSecret: string, code: string, secret: string;
declare const channelId: string, videoId: string, ids: string[];
declare const request: Request;
declare function saveTokens(tokens: unknown): void;

export async function intro() {
  const yt = new YouTube({ apiKey: process.env.YOUTUBE_API_KEY });

  const channel = await yt.channels.get("@GoogleDevelopers");
  console.log(channel?.snippet.title, channel?.statistics.subscriberCount);

  const videos = await yt.channels.latestVideos("@GoogleDevelopers", { limit: 5 });

  for await (const item of yt.playlists.items("PLBCF2DAC6FFB574DE")) {
    console.log(item.snippet.position, item.snippet.title);
  }
  return videos;
}

export async function parts(yt: YouTube) {
  const { items } = await yt.videos.list({ part: ["snippet", "statistics"], id: "dQw4w9WgXcQ" });
  const video = items[0]!;

  const title: string = video.snippet.title;
  const views: string = video.statistics.viewCount;
  const likes: string | undefined = video.statistics.likeCount;
  // @ts-expect-error Property 'contentDetails' does not exist
  video.contentDetails;
  return [title, views, likes];
}

export async function lists(yt: YouTube) {
  const page = await yt.search.videos("lofi hip hop", { order: "viewCount" });
  void [page.items, page.nextPageToken, page.totalResults];

  for await (const thread of yt.commentThreads.forVideo("dQw4w9WgXcQ")) void thread;

  const first200 = await yt.channels.uploads("@GoogleDevelopers").take(200);
  const videos = await yt.videos.getMany(ids);
  return [first200, videos];
}

export function quota(yt: YouTube) {
  quotaCost("playlistItems.insert");
  void [yt.quota.used, yt.quota.remaining("search.list"), yt.quota.byMethod, yt.quota.resetsAt];
  const safe = new YouTube({ apiKey, quota: { enforce: true, limits: { default: 2000 } } });
  const cached = new YouTube({ apiKey, cache: { ttl: "10m", methods: { "videoCategories.list": "1d" } } });
  return [safe, cached];
}

export async function oauthFlow() {
  const oauth = new OAuth2({
    clientId: process.env.GOOGLE_CLIENT_ID!,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
    redirectUri: "https://example.com/oauth/callback",
    onTokens: (tokens) => saveTokens(tokens),
  });
  const { url, state, codeVerifier } = await oauth.authUrl({ scopes: ["youtube.readonly"] });
  await oauth.exchange(code, { codeVerifier });
  const yt = new YouTube({ oauth });
  const mine = await yt.channels.mine();
  return [url, state, mine];
}

export async function localOauth() {
  const store = tokenFile("./tokens.json");
  const oauth = new OAuth2({ clientId, clientSecret, tokens: await store.load(), onTokens: store.save });
  if (!oauth.canRefresh) await authorize(oauth, { scopes: ["youtube.upload"] });
}

export async function uploads(yt: YouTube) {
  const video = await yt.videos.insert({
    body: {
      snippet: { title: "Holiday 2026", description: "Uploaded from code", categoryId: "22" },
      status: { privacyStatus: "private", selfDeclaredMadeForKids: false },
    },
    media: await fileMedia("./holiday.mp4", { onProgress: ({ percent }) => console.log(`${percent}%`) }),
  });

  await yt.thumbnails.set({ videoId: video.id, media: await fileMedia("./cover.png") });
}

export async function liveChat(yt: YouTube) {
  const chat = await yt.liveChatOf("https://www.youtube.com/watch?v=jfKfPfyJRdk");

  for await (const message of chat.messages()) {
    console.log(`${message.authorDetails.displayName}: ${message.snippet.displayMessage}`);
    if (message.snippet.type === "superChatEvent") {
      console.log("Super Chat:", message.snippet.superChatDetails?.amountDisplayString);
    }
  }
}

export async function notifications(yt: YouTube) {
  const watcher = yt.watch(["@GoogleDevelopers", "@YouTube"], { interval: "5m" });
  watcher.on("video", (video) => console.log(`${video.channelTitle} uploaded ${video.title}: ${video.url}`));
  watcher.start();

  await websub.subscribe({ channelId, callbackUrl: "https://example.com/youtube", secret });
  const { response, notifications: received } = await websub.receive(request, { secret });
  return [response, received];
}

export async function analytics(yt: YouTube) {
  const report = await yt.analytics.query({
    startDate: "2026-01-01",
    endDate: "2026-01-31",
    metrics: ["views", "estimatedMinutesWatched", "subscribersGained"],
    dimensions: "day",
  });
  for (const row of report.rows) console.log(row.day, row.views, row.estimatedMinutesWatched);
}

export async function errors(yt: YouTube) {
  try {
    await yt.commentThreads.post(videoId, "Nice one");
  } catch (error) {
    if (error instanceof YouTubeApiError && error.reason === "commentsDisabled") {
      // comments are turned off on that video
    } else if (isYouTubeError(error, "QUOTA_EXCEEDED")) {
      // wait until yt.quota.resetsAt
    } else {
      throw error;
    }
  }
}

export async function smallThings(yt: YouTube) {
  const video = (await yt.videos.get(videoId))!;
  return [
    parseUrl("https://youtu.be/dQw4w9WgXcQ?t=42"),
    parseDuration("PT1H2M3S"),
    formatDuration("PT1H2M3S"),
    bestThumbnail(video.snippet.thumbnails)?.url,
    urls.embed("dQw4w9WgXcQ", { noCookie: true }),
    channelPlaylistId(channelId, "shorts"),
    await oEmbed("https://youtu.be/dQw4w9WgXcQ"),
  ];
}

export async function migration(yt: YouTube) {
  return [await yt.channels.get("GoogleDevelopers"), await yt.channels.latestVideo("GoogleDevelopers")];
}
