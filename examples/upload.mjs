// Uploads a video to your channel, with a progress bar. The first run opens
// the consent page in your browser and saves the tokens next to the script.
//
// Create an OAuth client of type "Desktop app" in the Google Cloud console:
// https://console.cloud.google.com/apis/credentials
//
//   GOOGLE_CLIENT_ID=... GOOGLE_CLIENT_SECRET=... node examples/upload.mjs ./video.mp4 "My title"

import { basename } from "node:path";
import { OAuth2, YouTube } from "@ix-xs/youtube.api";
import { authorize, fileMedia, tokenFile } from "@ix-xs/youtube.api/node";

const [path, title = path && basename(path)] = process.argv.slice(2);
if (!path) {
  console.error('Usage: node examples/upload.mjs <file> ["title"]');
  process.exit(1);
}

const store = tokenFile("./tokens.json");
const oauth = new OAuth2({
  clientId: process.env.GOOGLE_CLIENT_ID,
  clientSecret: process.env.GOOGLE_CLIENT_SECRET,
  tokens: await store.load(),
  onTokens: store.save,
});
if (!oauth.canRefresh) await authorize(oauth, { scopes: ["youtube.upload"] });

const yt = new YouTube({ oauth });

const video = await yt.videos.insert({
  body: {
    snippet: { title, description: "Uploaded with @ix-xs/youtube.api" },
    // Private by default: publish from YouTube Studio once you have checked it.
    status: { privacyStatus: "private", selfDeclaredMadeForKids: false },
  },
  media: await fileMedia(path, {
    onProgress: ({ percent }) => process.stdout.write(`\rUploading ${String(percent ?? 0).padStart(5)}%`),
  }),
});

console.log(`\nDone: https://youtu.be/${video.id}`);
