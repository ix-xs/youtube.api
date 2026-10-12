// Checks the built CommonJS files the way a user's `require` sees them.
// Plain Node, no test runner, so it also runs on the oldest supported version.
const assert = require("node:assert/strict");
const api = require("../../dist/index.js");
const node = require("../../dist/node.js");

const calls = [];
const fetch = async (url, init) => {
  calls.push({ url: String(url), init });
  return new Response(JSON.stringify({ items: [{ id: "dQw4w9WgXcQ", snippet: { title: "ok" } }] }), { headers: { "content-type": "application/json" } });
};

(async () => {
  const yt = new api.YouTube({ apiKey: "key", fetch });
  const video = await yt.videos.get("https://youtu.be/dQw4w9WgXcQ", { part: "snippet" });
  assert.equal(video.snippet.title, "ok");
  assert.equal(calls[0].init.headers["x-goog-api-key"], "key");
  assert.equal(yt.quota.used, 1);

  for (const name of ["YouTube", "OAuth2", "Watcher", "websub", "fetchFeed", "oEmbed", "parseUrl", "parseDuration", "urls", "METHODS", "YouTubeApiError", "isYouTubeError", "Scopes"]) {
    assert.ok(api[name], `missing export ${name}`);
  }
  for (const name of ["authorize", "fileMedia", "tokenFile", "webSubListener"]) assert.equal(typeof node[name], "function", `missing node export ${name}`);
  assert.equal(api.parseDuration("PT1H2M3S"), 3723);
  assert.ok(new api.YouTubeApiError({ status: 404, message: "x", method: "videos.list", url: "u" }) instanceof api.YouTubeError);
  console.log(`cjs ok on Node ${process.versions.node} (${Object.keys(api).length} exports)`);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
