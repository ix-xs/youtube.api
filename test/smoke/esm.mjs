// Checks the built ES module files the way a user's `import` sees them.
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as api from "../../dist/index.mjs";
import { fileMedia, tokenFile } from "../../dist/node.mjs";

const fetch = async () => new Response(JSON.stringify({ items: [{ id: "UC_x5XG1OV2P6uZZ5FSM9Ttw" }] }), { headers: { "content-type": "application/json" } });
const yt = new api.YouTube({ apiKey: "key", fetch });
assert.equal(await yt.channels.resolveId("@GoogleDevelopers"), "UC_x5XG1OV2P6uZZ5FSM9Ttw");
assert.deepEqual(api.parseUrl("https://youtu.be/dQw4w9WgXcQ?t=42"), { type: "video", videoId: "dQw4w9WgXcQ", format: "watch", start: 42 });

const dir = await mkdtemp(join(tmpdir(), "youtube-api-"));
try {
  const store = tokenFile(join(dir, "nested", "tokens.json"));
  assert.equal(await store.load(), undefined);
  await store.save({ accessToken: "a", refreshToken: "r" });
  assert.deepEqual(await store.load(), { accessToken: "a", refreshToken: "r" });

  await writeFile(join(dir, "clip.mp4"), new Uint8Array(1024));
  const media = await fileMedia(join(dir, "clip.mp4"));
  assert.equal(media.mimeType, "video/mp4");
  assert.equal(media.body.size, 1024);
} finally {
  await rm(dir, { recursive: true, force: true });
}
console.log(`esm ok on Node ${process.versions.node} (${Object.keys(api).length} exports)`);
