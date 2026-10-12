// Hand-written knowledge the discovery documents do not carry: what each method
// is for, what it costs, and a working example. The generator merges this with
// scripts/discovery/*.json. A method missing here fails the build, so a new API
// method cannot slip in undocumented.
//
// Quota costs come from https://developers.google.com/youtube/v3/determine_quota_cost
// and from the method pages for the ones the calculator does not list.

/** Methods that exist in the discovery document but are not part of the public API. */
export const omit = ["youtube.tests.insert"];

/** Schemas only used by omitted methods. */
export const omitSchemas = ["TestItem", "TestItemTestItemSnippet"];

/**
 * Parts the API always returns when they are requested. Every other part stays
 * optional in the narrowed type (for example `liveStreamingDetails` only
 * exists on live videos). Default: `["snippet"]`.
 */
export const alwaysReturned = {
  Video: ["snippet", "contentDetails", "statistics", "status", "player"],
  Channel: ["snippet", "contentDetails", "statistics", "status", "brandingSettings"],
  Playlist: ["snippet", "contentDetails", "status", "player"],
  PlaylistItem: ["snippet", "contentDetails", "status"],
  Subscription: ["snippet", "contentDetails", "subscriberSnippet"],
  Activity: ["snippet", "contentDetails"],
  CommentThread: ["snippet"],
  LiveBroadcast: ["snippet", "contentDetails", "status"],
  LiveStream: ["snippet", "cdn", "contentDetails", "status"],
  LiveChatMessage: ["snippet", "authorDetails"],
  ThirdPartyLink: ["snippet", "status", "linkingToken"],
  VideoStat: ["snippet", "contentDetails", "statistics"],
};

/**
 * Fields that are present whenever their parent object is. The discovery
 * document marks nothing as required, which would leave every field
 * `T | undefined`. This list is deliberately conservative: a field is only
 * here when the API returns it for every resource, including private or
 * deleted ones.
 */
export const required = {
  PageInfo: ["totalResults", "resultsPerPage"],
  Thumbnail: ["url"],
  ResourceId: ["kind"],
  LocalizedProperty: [],

  VideoSnippet: ["publishedAt", "channelId", "title", "description", "thumbnails", "channelTitle", "categoryId", "liveBroadcastContent", "localized"],
  VideoLocalization: ["title", "description"],
  VideoContentDetails: ["duration", "dimension", "definition", "caption", "licensedContent", "projection"],
  VideoStatistics: ["viewCount"],
  VideoStatus: ["uploadStatus", "privacyStatus", "license", "embeddable", "publicStatsViewable", "madeForKids"],
  VideoPlayer: ["embedHtml"],
  VideoRating: ["videoId", "rating"],
  VideoCategorySnippet: ["title", "assignable", "channelId"],
  VideoAbuseReportReasonSnippet: ["label"],

  ChannelSnippet: ["title", "description", "publishedAt", "thumbnails", "localized"],
  ChannelLocalization: ["title", "description"],
  ChannelContentDetails: ["relatedPlaylists"],
  "ChannelContentDetails.relatedPlaylists": ["uploads"],
  ChannelStatistics: ["viewCount", "hiddenSubscriberCount", "videoCount"],
  ChannelStatus: ["privacyStatus", "isLinked", "longUploadsStatus"],

  PlaylistSnippet: ["publishedAt", "channelId", "title", "description", "thumbnails", "channelTitle", "localized"],
  PlaylistLocalization: ["title", "description"],
  PlaylistContentDetails: ["itemCount"],
  PlaylistStatus: ["privacyStatus"],
  PlaylistPlayer: ["embedHtml"],
  PlaylistItemSnippet: ["publishedAt", "channelId", "title", "description", "thumbnails", "channelTitle", "playlistId", "position", "resourceId"],
  PlaylistItemContentDetails: ["videoId"],
  PlaylistItemStatus: ["privacyStatus"],

  SearchResultSnippet: ["publishedAt", "channelId", "title", "description", "thumbnails", "channelTitle", "liveBroadcastContent"],

  CommentSnippet: ["textDisplay", "authorDisplayName", "authorProfileImageUrl", "authorChannelUrl", "canRate", "viewerRating", "likeCount", "publishedAt", "updatedAt"],
  CommentThreadSnippet: ["topLevelComment", "canReply", "totalReplyCount", "isPublic"],
  CommentThreadReplies: ["comments"],

  SubscriptionSnippet: ["publishedAt", "title", "description", "resourceId", "channelId", "thumbnails"],
  SubscriptionContentDetails: ["totalItemCount", "newItemCount", "activityType"],
  SubscriptionSubscriberSnippet: ["title", "description", "channelId", "thumbnails"],

  ActivitySnippet: ["publishedAt", "channelId", "title", "description", "thumbnails", "channelTitle", "type"],
  CaptionSnippet: ["videoId", "lastUpdated", "trackKind", "language", "name", "status"],
  ChannelSectionSnippet: ["type", "channelId"],

  I18nLanguageSnippet: ["hl", "name"],
  I18nRegionSnippet: ["gl", "name"],

  LiveChatMessageSnippet: ["type", "liveChatId", "publishedAt", "hasDisplayContent"],
  LiveChatMessageAuthorDetails: ["channelId", "channelUrl", "displayName", "profileImageUrl", "isVerified", "isChatOwner", "isChatSponsor", "isChatModerator"],
  LiveBroadcastSnippet: ["publishedAt", "channelId", "title", "description", "thumbnails"],
  LiveBroadcastStatus: ["lifeCycleStatus", "privacyStatus", "recordingStatus"],
  LiveStreamSnippet: ["publishedAt", "channelId", "title", "description"],
  LiveStreamStatus: ["streamStatus"],

  VideoStatsStatistics: ["viewCount"],
};

/**
 * Types the API description states too loosely. A comment nested in a thread
 * comes with its snippet, like the thread it belongs to.
 */
export const schemaTypes = {
  "CommentThreadSnippet.topLevelComment": 'Comment<"snippet">',
  "CommentThreadReplies.comments": 'Comment<"snippet">[]',
};

/**
 * Descriptions of resources (`Schema`) and of their fields (`Schema.field`)
 * whose text in the API description is wrong, outdated or missing.
 */
export const schemaDocs = {
  VideoStatus: "The upload, processing and privacy status of a video.",
  VideoAbuseReportReasonSnippet: "The label of a reason for reporting a video, and its secondary reasons.",
  SuperChatEvent: "A Super Chat or Super Sticker purchased during one of your live broadcasts.",
  LiveChatBan: "A ban of a user from a live chat, permanent or temporary.",
  "CaptionSnippet.isAutoSynced":
    "Whether YouTube timed the track to the audio itself. Tracks uploaded since April 2024 carry their own timing, so this is false for them: YouTube no longer syncs a transcript for you.",
};

const DATE = "string | Date";

/**
 * Per-method knowledge.
 *
 * - `summary`: one or two sentences, written for someone discovering the method in their editor.
 * - `quota`: units per call. `bucket` when the method has its own quota bucket.
 * - `auth: "oauth"`: a GET that an API key can never call. Writes always need OAuth.
 * - `example`: compiled by `npm run test:types`, so it cannot rot.
 * - `types`: TypeScript type of a parameter when the discovery document is too loose.
 * - `requires`: parameters the API requires although the discovery document does not say so.
 * - `response`: `"text"` for raw text bodies.
 * - `optionalBody`: the method declares a body it does not need.
 * - `handwritten`: the types and the method table are generated, the method itself lives in src/.
 * - `deprecated`: marks the method `@deprecated` with this reason.
 * - `docs`: description of a parameter, when the API description has none or a wrong one.
 * - `partOf`: the resource the `part` parameter belongs to, when it cannot be derived.
 */
export const methods = {
  // ----- activities
  "youtube.activities.list": {
    summary: "Lists what a channel did recently: uploads, likes made public, playlist additions and so on.",
    quota: 1,
    types: { publishedAfter: DATE, publishedBefore: DATE },
    docs: {
      channelId: "Channel whose activities to list.",
      mine: "List the activities of the authenticated user instead of a given channel.",
      publishedAfter: "Only activities that happened at or after this moment.",
      publishedBefore: "Only activities that happened before this moment.",
      regionCode: "ISO 3166-1 alpha-2 country code, used when the user's activity alone gives too few results.",
    },
    example: `const { items } = await yt.activities.list({ part: ["snippet", "contentDetails"], channelId, maxResults: 10 });
for (const activity of items) console.log(activity.snippet.type, activity.snippet.title);`,
  },

  // ----- captions
  "youtube.captions.list": {
    summary: "Lists the caption tracks of a video. The tracks themselves are fetched with `download`.",
    quota: 50,
    auth: "oauth",
    example: `const { items } = await yt.captions.list({ part: "snippet", videoId });
const english = items.find((track) => track.snippet.language === "en");`,
  },
  "youtube.captions.insert": {
    summary: "Uploads a caption track for one of your videos. The file must carry its own timing.",
    quota: 400,
    docs: { sync: "No longer supported: since April 2024 YouTube does not time a transcript for you. The file must carry its own timing." },
    example: `await yt.captions.insert({
  body: { snippet: { videoId, language: "en", name: "English" } },
  media: { body: srtText, mimeType: "application/x-subrip" },
});`,
  },
  "youtube.captions.update": {
    summary: "Updates a caption track: its draft status, its file, or both.",
    quota: 450,
    docs: { sync: "No longer supported: since April 2024 YouTube does not time a transcript for you. The file must carry its own timing." },
    example: `await yt.captions.update({ body: { id: captionId, snippet: { isDraft: false } } });`,
  },
  "youtube.captions.download": {
    summary: "Downloads a caption track as text, in its original format or converted with `tfmt`. Only works on videos you can edit.",
    quota: 200,
    auth: "oauth",
    response: "text",
    types: { tfmt: `"sbv" | "scc" | "srt" | "ttml" | "vtt"` },
    docs: { tfmt: "Converts the track to this format. Left out, the track comes in the format it was uploaded in." },
    example: `const vtt = await yt.captions.download({ id: captionId, tfmt: "vtt" });`,
  },
  "youtube.captions.delete": {
    summary: "Deletes a caption track.",
    quota: 50,
    example: `await yt.captions.delete({ id: captionId });`,
  },

  // ----- channelBanners
  "youtube.channelBanners.insert": {
    summary:
      "Uploads a channel banner image and returns its URL. The banner only goes live once that URL is saved to `brandingSettings.image.bannerExternalUrl` with `channels.update`.",
    quota: 50,
    optionalBody: true,
    example: `const { url } = await yt.channelBanners.insert({ media: image });
await yt.channels.update({ body: { id: channelId, brandingSettings: { image: { bannerExternalUrl: url } } } });`,
  },

  // ----- channels
  "youtube.channels.list": {
    summary:
      "Fetches channels by id, handle, legacy username, or the authenticated user's own channel. Pass one filter: `id`, `forHandle`, `forUsername`, `mine`, `managedByMe` or `mySubscribers`.",
    quota: 1,
    example: `const channel = await yt.channels.list({ part: ["snippet", "statistics"], forHandle: "@GoogleDevelopers" }).first();
console.log(channel?.snippet.title, channel?.statistics.subscriberCount);`,
  },
  "youtube.channels.update": {
    summary: "Updates a channel's branding settings, localizations or made-for-kids status. A part you send replaces the whole part, so include every field you want to keep.",
    quota: 50,
    example: `await yt.channels.update({
  body: { id: channelId, brandingSettings: { channel: { description: "New description", keywords: "typescript api" } } },
});`,
  },

  // ----- channelSections
  "youtube.channelSections.list": {
    summary: "Lists the shelves shown on a channel's home tab.",
    quota: 1,
    example: `const { items } = await yt.channelSections.list({ part: ["snippet", "contentDetails"], channelId });`,
  },
  "youtube.channelSections.insert": {
    summary: "Adds a shelf to your channel's home tab. A channel can have at most 10.",
    quota: 50,
    example: `await yt.channelSections.insert({
  body: { snippet: { type: "singlePlaylist", position: 0 }, contentDetails: { playlists: [playlistId] } },
});`,
  },
  "youtube.channelSections.update": {
    summary: "Updates a shelf of your channel's home tab.",
    quota: 50,
    example: `await yt.channelSections.update({ body: { id: sectionId, snippet: { type: "singlePlaylist", position: 2 } } });`,
  },
  "youtube.channelSections.delete": {
    summary: "Removes a shelf from your channel's home tab.",
    quota: 50,
    example: `await yt.channelSections.delete({ id: sectionId });`,
  },

  // ----- comments
  "youtube.comments.list": {
    summary: "Fetches comments by id, or the replies to a top-level comment with `parentId`. To read the comments of a video, use `commentThreads.list`.",
    quota: 1,
    example: `for await (const reply of yt.comments.list({ part: "snippet", parentId: commentId })) {
  console.log(reply.snippet.authorDisplayName, reply.snippet.textDisplay);
}`,
  },
  "youtube.comments.insert": {
    summary: "Replies to an existing comment. To start a new thread, use `commentThreads.insert`.",
    quota: 50,
    example: `await yt.comments.insert({ body: { snippet: { parentId: commentId, textOriginal: "Thanks for watching!" } } });`,
  },
  "youtube.comments.update": {
    summary: "Edits the text of one of your comments.",
    quota: 50,
    example: `await yt.comments.update({ body: { id: commentId, snippet: { textOriginal: "Edited" } } });`,
  },
  "youtube.comments.setModerationStatus": {
    summary: "Publishes, holds for review or rejects comments on your channel or videos. `banAuthor` also blocks the author when rejecting.",
    quota: 50,
    types: { moderationStatus: `"published" | "heldForReview" | "rejected"` },
    docs: { moderationStatus: "The status to give the comments: `published` shows them, `heldForReview` hides them until a moderator decides, `rejected` removes them from view." },
    example: `await yt.comments.setModerationStatus({ id: [commentId], moderationStatus: "rejected", banAuthor: true });`,
  },
  "youtube.comments.markAsSpam": {
    summary: "Flags comments as spam.",
    quota: 50,
    deprecated: "YouTube no longer supports this method. Use `setModerationStatus` to reject a comment instead.",
  },
  "youtube.comments.delete": {
    summary: "Deletes a comment.",
    quota: 50,
    example: `await yt.comments.delete({ id: commentId });`,
  },

  // ----- commentThreads
  "youtube.commentThreads.list": {
    summary:
      "Lists comment threads: the top-level comments of a video (`videoId`), everything on a channel (`allThreadsRelatedToChannelId`), or specific threads (`id`). Ask for the `replies` part to get up to five replies inline.",
    quota: 1,
    types: { moderationStatus: `"published" | "heldForReview" | "likelySpam"` },
    docs: { moderationStatus: "Only threads in this moderation state. `heldForReview` and `likelySpam` are only visible to the owner of the channel or video. Default `published`." },
    example: `for await (const thread of yt.commentThreads.list({ part: ["snippet", "replies"], videoId, order: "relevance" })) {
  const top = thread.snippet.topLevelComment.snippet;
  console.log(top.authorDisplayName, top.textDisplay, thread.snippet.totalReplyCount);
}`,
  },
  "youtube.commentThreads.insert": {
    summary: "Posts a new top-level comment on a video.",
    quota: 50,
    example: `await yt.commentThreads.insert({
  body: { snippet: { videoId, topLevelComment: { snippet: { textOriginal: "First!" } } } },
});`,
  },

  // ----- i18n
  "youtube.i18nLanguages.list": {
    summary: "Lists the interface languages YouTube supports. Their `hl` codes are what the `hl` parameter of other methods accepts.",
    quota: 1,
    example: `const { items } = await yt.i18nLanguages.list({ part: "snippet", hl: "fr" });`,
  },
  "youtube.i18nRegions.list": {
    summary: "Lists the content regions YouTube supports. Their `gl` codes are what `regionCode` accepts.",
    quota: 1,
    example: `const { items } = await yt.i18nRegions.list({ part: "snippet" });`,
  },

  // ----- members
  "youtube.members.list": {
    summary: "Lists the paying members of your channel. Needs prior approval from YouTube for your project.",
    quota: 1,
    auth: "oauth",
    example: `const members = await yt.members.list({ part: "snippet", mode: "all_current" }).all();`,
  },
  "youtube.membershipsLevels.list": {
    summary: "Lists the membership levels of your channel. Needs prior approval from YouTube for your project.",
    quota: 1,
    auth: "oauth",
    example: `const { items } = await yt.membershipsLevels.list({ part: ["id", "snippet"] });`,
  },

  // ----- playlistImages
  "youtube.playlistImages.list": {
    summary: "Lists the custom thumbnail images of a playlist.",
    quota: 1,
    requires: ["parent"],
    example: `const { items } = await yt.playlistImages.list({ part: "snippet", parent: playlistId });`,
  },
  "youtube.playlistImages.insert": {
    summary: "Sets a custom thumbnail image on a playlist. JPEG or PNG, 50 MB at most.",
    quota: 50,
    example: `await yt.playlistImages.insert({
  body: { snippet: { playlistId, type: "hero", width: 1080, height: 1080 } },
  media: image,
});`,
  },
  "youtube.playlistImages.update": {
    summary: "Replaces the custom thumbnail image of a playlist.",
    quota: 50,
    example: `await yt.playlistImages.update({ body: { id: playlistImageId, snippet: { playlistId, type: "hero" } }, media: image });`,
  },
  "youtube.playlistImages.delete": {
    summary: "Removes a custom thumbnail image from a playlist.",
    quota: 50,
    requires: ["id"],
    example: `await yt.playlistImages.delete({ id: playlistImageId });`,
  },

  // ----- playlistItems
  "youtube.playlistItems.list": {
    summary:
      "Lists the videos of a playlist. It is also the cheap way to list a channel's uploads: read its uploads playlist instead of searching (1 unit for 50 videos).",
    quota: 1,
    example: `for await (const item of yt.playlistItems.list({ part: ["snippet", "contentDetails"], playlistId })) {
  console.log(item.snippet.position, item.contentDetails.videoId, item.snippet.title);
}`,
  },
  "youtube.playlistItems.insert": {
    summary: "Adds a video to one of your playlists.",
    quota: 50,
    example: `await yt.playlistItems.insert({
  body: { snippet: { playlistId, resourceId: { kind: "youtube#video", videoId } } },
});`,
  },
  "youtube.playlistItems.update": {
    summary: "Moves a playlist item to another position, or edits its note.",
    quota: 50,
    example: `await yt.playlistItems.update({
  body: { id: playlistItemId, snippet: { playlistId, position: 0, resourceId: { kind: "youtube#video", videoId } } },
});`,
  },
  "youtube.playlistItems.delete": {
    summary: "Removes an item from a playlist. Takes the playlist item id, not the video id.",
    quota: 50,
    example: `await yt.playlistItems.delete({ id: playlistItemId });`,
  },

  // ----- playlists
  "youtube.playlists.list": {
    summary: "Fetches playlists by id, the playlists of a channel, or your own with `mine`.",
    quota: 1,
    example: `const playlists = await yt.playlists.list({ part: ["snippet", "contentDetails"], channelId }).all();
for (const playlist of playlists) console.log(playlist.snippet.title, playlist.contentDetails.itemCount);`,
  },
  "youtube.playlists.insert": {
    summary: "Creates a playlist on your channel.",
    quota: 50,
    example: `const playlist = await yt.playlists.insert({
  part: ["snippet", "status"],
  body: { snippet: { title: "Watch later, for real" }, status: { privacyStatus: "private" } },
});
console.log(playlist.id);`,
  },
  "youtube.playlists.update": {
    summary: "Updates a playlist's title, description, privacy or localizations. `snippet.title` is required whenever you send the snippet.",
    quota: 50,
    example: `await yt.playlists.update({ body: { id: playlistId, snippet: { title: "Renamed" }, status: { privacyStatus: "public" } } });`,
  },
  "youtube.playlists.delete": {
    summary: "Deletes a playlist.",
    quota: 50,
    example: `await yt.playlists.delete({ id: playlistId });`,
  },

  // ----- search
  "youtube.search.list": {
    summary:
      "Searches videos, channels and playlists. Results only carry ids and a snippet: pass the ids to `videos.list` for durations or statistics. Search has its own quota bucket, 100 calls a day by default, and never returns more than about 500 results for a query.",
    quota: 1,
    bucket: "search.list",
    types: {
      type: `OneOrMany<"video" | "channel" | "playlist">`,
      publishedAfter: DATE,
      publishedBefore: DATE,
    },
    example: `const { items } = await yt.search.list({ part: "snippet", q: "typescript tutorial", type: "video", maxResults: 25 });
for (const result of items) console.log(result.id.videoId, result.snippet.title);`,
  },

  // ----- subscriptions
  "youtube.subscriptions.list": {
    summary: "Lists the channels someone is subscribed to (`channelId` or `mine`), or who subscribes to you (`mySubscribers`).",
    quota: 1,
    docs: { myRecentSubscribers: "List the subscribers of the authenticated user's channel, most recent first." },
    example: `for await (const subscription of yt.subscriptions.list({ part: "snippet", mine: true, order: "alphabetical" })) {
  console.log(subscription.snippet.title, subscription.snippet.resourceId.channelId);
}`,
  },
  "youtube.subscriptions.insert": {
    summary: "Subscribes the authenticated user to a channel.",
    quota: 50,
    example: `await yt.subscriptions.insert({ body: { snippet: { resourceId: { kind: "youtube#channel", channelId } } } });`,
  },
  "youtube.subscriptions.delete": {
    summary: "Unsubscribes. Takes the subscription id, not the channel id.",
    quota: 50,
    example: `await yt.subscriptions.delete({ id: subscriptionId });`,
  },

  // ----- superChatEvents
  "youtube.superChatEvents.list": {
    summary: "Lists the Super Chats and Super Stickers your channel received during the last 30 days.",
    quota: 1,
    auth: "oauth",
    example: `for await (const event of yt.superChatEvents.list({ part: "snippet" })) {
  console.log(event.snippet.displayString, event.snippet.commentText);
}`,
  },

  // ----- thumbnails
  "youtube.thumbnails.set": {
    summary: "Uploads a custom thumbnail for a video. JPEG or PNG, 50 MB at most.",
    quota: 50,
    example: `await yt.thumbnails.set({ videoId, media: image });`,
  },

  // ----- video metadata lists
  "youtube.videoAbuseReportReasons.list": {
    summary: "Lists the reasons accepted by `videos.reportAbuse`.",
    quota: 1,
    docs: { hl: "Language of the labels, for example `fr`." },
    example: `const { items } = await yt.videoAbuseReportReasons.list({ part: ["id", "snippet"], hl: "en" });`,
  },
  "youtube.videoCategories.list": {
    summary: "Lists the video categories available in a region, or fetches categories by id.",
    quota: 1,
    docs: { hl: "Language of the category titles, for example `fr`.", regionCode: "ISO 3166-1 alpha-2 country code whose categories to list." },
    example: `const { items } = await yt.videoCategories.list({ part: "snippet", regionCode: "FR", hl: "fr" });
const assignable = items.filter((category) => category.snippet.assignable);`,
  },

  // ----- videos
  "youtube.videos.list": {
    summary:
      "Fetches videos by id, the most popular chart, or the ones you rated. Pass exactly one of `id`, `chart` or `myRating`. Any number of ids works: they are split into calls of 50.",
    quota: 1,
    types: { myRating: `"like" | "dislike"` },
    docs: {
      maxWidth: "Largest width of the embedded player returned in the `player` part.",
      maxHeight: "Largest height of the embedded player returned in the `player` part.",
    },
    example: `const { items } = await yt.videos.list({ part: ["snippet", "statistics", "contentDetails"], id: [videoId] });
for (const video of items) {
  console.log(video.snippet.title, video.statistics.viewCount, video.contentDetails.duration);
}`,
  },
  "youtube.videos.insert": {
    summary:
      "Uploads a video to your channel. Large files go up in chunks over a resumable session, with progress. Videos uploaded by an unverified API project are locked as private until the project passes an audit.",
    quota: 1,
    bucket: "videos.insert",
    example: `const video = await yt.videos.insert({
  part: ["snippet", "status"],
  body: {
    snippet: { title: "My video", description: "Uploaded from code", categoryId: "22" },
    status: { privacyStatus: "private", selfDeclaredMadeForKids: false },
  },
  media: { body: file, onProgress: ({ percent }) => console.log(percent, "%") },
});
console.log(video.id);`,
  },
  "youtube.videos.update": {
    summary:
      "Updates a video's metadata. A part you send replaces the whole part: when sending `snippet`, include `title` and `categoryId` along with what you change.",
    quota: 50,
    example: `await yt.videos.update({
  body: { id: videoId, snippet: { title: "Better title", categoryId: "22" }, status: { privacyStatus: "public" } },
});`,
  },
  "youtube.videos.rate": {
    summary: "Likes or dislikes a video, or removes the rating with `none`.",
    quota: 50,
    example: `await yt.videos.rate({ id: videoId, rating: "like" });`,
  },
  "youtube.videos.getRating": {
    summary: "Tells how the authenticated user rated each of the given videos.",
    quota: 1,
    auth: "oauth",
    example: `const { items } = await yt.videos.getRating({ id: [videoId] });
console.log(items[0]?.rating);`,
  },
  "youtube.videos.reportAbuse": {
    summary: "Reports a video for abusive content. Reason ids come from `videoAbuseReportReasons.list`.",
    quota: 50,
    example: `await yt.videos.reportAbuse({ body: { videoId, reasonId: "S" } });`,
  },
  "youtube.videos.delete": {
    summary: "Deletes one of your videos. There is no undo.",
    quota: 50,
    example: `await yt.videos.delete({ id: videoId });`,
  },
  "youtube.videos.batchGetStats": {
    summary: "Fetches fresh statistics for many videos in one call. It has its own quota bucket, so polling view counts does not eat into the main one.",
    quota: 1,
    bucket: "videos.batchGetStats",
    requires: ["id"],
    docs: { id: "The videos to fetch statistics for. Any number of ids: lists longer than 50 are split across calls." },
    example: `const { items } = await yt.videos.batchGetStats({ part: ["statistics"], id: [videoId] });`,
  },
  "youtube.videoTrainability.get": {
    summary: "Tells which third parties, if any, the owner allows to train AI models on a video.",
    quota: 1,
    requires: ["id"],
    example: `const { permitted } = await yt.videoTrainability.get({ id: videoId });`,
  },

  // ----- watermarks
  "youtube.watermarks.set": {
    summary: "Uploads a watermark image shown over every video of a channel.",
    quota: 50,
    example: `await yt.watermarks.set({
  channelId,
  body: { timing: { type: "offsetFromStart", offsetMs: "15000", durationMs: "10000" } },
  media: image,
});`,
  },
  "youtube.watermarks.unset": {
    summary: "Removes the watermark of a channel.",
    quota: 50,
    example: `await yt.watermarks.unset({ channelId });`,
  },

  // ----- live broadcasts
  "youtube.liveBroadcasts.list": {
    summary: "Lists your broadcasts, by status or by id.",
    quota: 1,
    auth: "oauth",
    docs: { mine: "Set to true to list the broadcasts of the authenticated user." },
    example: `const { items } = await yt.liveBroadcasts.list({ part: ["snippet", "status"], broadcastStatus: "upcoming" });`,
  },
  "youtube.liveBroadcasts.insert": {
    summary: "Schedules a broadcast. Bind it to a stream with `bind` before going live.",
    quota: 1,
    example: `const broadcast = await yt.liveBroadcasts.insert({
  part: ["snippet", "status", "contentDetails"],
  body: {
    snippet: { title: "Friday stream", scheduledStartTime: "2027-01-01T18:00:00Z" },
    status: { privacyStatus: "unlisted", selfDeclaredMadeForKids: false },
    contentDetails: { enableAutoStart: true, enableAutoStop: true },
  },
});`,
  },
  "youtube.liveBroadcasts.update": {
    summary: "Updates a broadcast's title, schedule, privacy or settings.",
    quota: 1,
    example: `await yt.liveBroadcasts.update({
  body: { id: broadcastId, snippet: { title: "New title", scheduledStartTime: "2027-01-01T19:00:00Z" } },
});`,
  },
  "youtube.liveBroadcasts.bind": {
    summary: "Attaches a broadcast to a stream, or detaches it when `streamId` is left out. A broadcast has one stream, a stream can feed several broadcasts.",
    quota: 1,
    example: `await yt.liveBroadcasts.bind({ id: broadcastId, streamId, part: ["id", "contentDetails"] });`,
  },
  "youtube.liveBroadcasts.transition": {
    summary: "Moves a broadcast to `testing`, `live` or `complete`. The bound stream must be active before going to `testing` or `live`.",
    quota: 1,
    docs: { broadcastStatus: "Where to move the broadcast: `testing` shows it to you only, `live` shows it to its audience, `complete` ends it." },
    example: `await yt.liveBroadcasts.transition({ id: broadcastId, broadcastStatus: "live", part: ["status"] });`,
  },
  "youtube.liveBroadcasts.insertCuepoint": {
    summary: "Inserts an ad break into a live broadcast.",
    quota: 1,
    requires: ["id"],
    example: `await yt.liveBroadcasts.insertCuepoint({ id: broadcastId, body: { cueType: "cueTypeAd", durationSecs: 30 } });`,
  },
  "youtube.liveBroadcasts.delete": {
    summary: "Deletes a broadcast.",
    quota: 1,
    example: `await yt.liveBroadcasts.delete({ id: broadcastId });`,
  },

  // ----- live streams
  "youtube.liveStreams.list": {
    summary: "Lists your video streams, the ingestion endpoints an encoder sends video to.",
    quota: 1,
    auth: "oauth",
    example: `const { items } = await yt.liveStreams.list({ part: ["snippet", "cdn", "status"], mine: true });
console.log(items[0]?.cdn.ingestionInfo?.streamName);`,
  },
  "youtube.liveStreams.insert": {
    summary: "Creates a video stream and returns the ingestion address and stream key for your encoder.",
    quota: 1,
    example: `const stream = await yt.liveStreams.insert({
  part: ["snippet", "cdn"],
  body: { snippet: { title: "Main encoder" }, cdn: { ingestionType: "rtmp", resolution: "variable", frameRate: "variable" } },
});`,
  },
  "youtube.liveStreams.update": {
    summary: "Updates a video stream. Only the title, description and a few CDN settings can change once it exists.",
    quota: 1,
    example: `await yt.liveStreams.update({ body: { id: streamId, snippet: { title: "Backup encoder" } } });`,
  },
  "youtube.liveStreams.delete": {
    summary: "Deletes a video stream.",
    quota: 1,
    example: `await yt.liveStreams.delete({ id: streamId });`,
  },

  // ----- live chat
  "youtube.liveChatMessages.list": {
    summary:
      "Reads the messages of a live chat. Each answer says how long to wait before asking again (`pollingIntervalMillis`). `yt.liveChat()` does that loop for you.",
    quota: 5,
    example: `const page = await yt.liveChatMessages.list({ part: ["snippet", "authorDetails"], liveChatId });
for (const message of page.items) console.log(message.authorDetails.displayName, message.snippet.displayMessage);
console.log("ask again in", page.raw.pollingIntervalMillis, "ms");`,
  },
  "youtube.youtube.v3.liveChat.messages.stream": {
    summary: "Receives live chat messages over one long-lived connection.",
    quota: 5,
    partOf: "LiveChatMessage",
    requires: ["liveChatId"],
    handwritten: true,
  },
  "youtube.liveChatMessages.insert": {
    summary: "Sends a message to a live chat.",
    quota: 20,
    example: `await yt.liveChatMessages.insert({
  body: { snippet: { liveChatId, type: "textMessageEvent", textMessageDetails: { messageText: "Hello chat!" } } },
});`,
  },
  "youtube.liveChatMessages.delete": {
    summary: "Deletes a chat message. Only the channel owner and moderators can.",
    quota: 20,
    example: `await yt.liveChatMessages.delete({ id: messageId });`,
  },
  "youtube.liveChatMessages.transition": {
    summary: "Closes a running poll in a live chat.",
    quota: 20,
    requires: ["id", "status"],
    example: `await yt.liveChatMessages.transition({ id: messageId, status: "closed" });`,
  },
  "youtube.liveChatBans.insert": {
    summary: "Bans a user from a live chat, for good (`permanent`) or for a while (`temporary` with `banDurationSeconds`).",
    quota: 200,
    example: `await yt.liveChatBans.insert({
  body: { snippet: { liveChatId, type: "temporary", banDurationSeconds: "300", bannedUserDetails: { channelId } } },
});`,
  },
  "youtube.liveChatBans.delete": {
    summary: "Lifts a live chat ban.",
    quota: 200,
    example: `await yt.liveChatBans.delete({ id: banId });`,
  },
  "youtube.liveChatModerators.list": {
    summary: "Lists the moderators of a live chat.",
    quota: 50,
    auth: "oauth",
    example: `const moderators = await yt.liveChatModerators.list({ part: "snippet", liveChatId }).all();`,
  },
  "youtube.liveChatModerators.insert": {
    summary: "Makes a user a moderator of a live chat.",
    quota: 200,
    example: `await yt.liveChatModerators.insert({ body: { snippet: { liveChatId, moderatorDetails: { channelId } } } });`,
  },
  "youtube.liveChatModerators.delete": {
    summary: "Removes a moderator from a live chat.",
    quota: 200,
    example: `await yt.liveChatModerators.delete({ id: moderatorId });`,
  },

  // ----- partner and undocumented methods
  "youtube.abuseReports.insert": {
    summary: "Files an abuse report about a channel or another entity. Not covered by the public reference, the shape may change.",
    quota: 50,
  },
  "youtube.thirdPartyLinks.list": {
    summary: "Lists the links between a channel and a third party, such as a merchant store. For approved commerce partners.",
    quota: 1,
    auth: "oauth",
  },
  "youtube.thirdPartyLinks.insert": {
    summary: "Links a channel to a third party, such as a merchant store. For approved commerce partners.",
    quota: 50,
  },
  "youtube.thirdPartyLinks.update": {
    summary: "Updates a link between a channel and a third party. For approved commerce partners.",
    quota: 50,
  },
  "youtube.thirdPartyLinks.delete": {
    summary: "Removes a link between a channel and a third party. For approved commerce partners.",
    quota: 50,
  },

  // ----- YouTube Analytics API
  "youtubeAnalytics.reports.query": {
    summary: "Runs an Analytics report: metrics such as views or watch time, split by dimensions such as day or country. `yt.analytics.query()` is the typed, friendlier way in.",
    quota: 1,
    requires: ["ids", "startDate", "endDate", "metrics"],
    handwritten: true,
  },
  "youtubeAnalytics.groups.list": {
    summary: "Lists your Analytics groups, the custom collections of up to 500 videos, playlists, channels or assets you can report on as one.",
    quota: 1,
    example: `const { items } = await yt.analytics.groups.list({ mine: true });`,
  },
  "youtubeAnalytics.groups.insert": {
    summary: "Creates an Analytics group.",
    quota: 1,
    example: `const group = await yt.analytics.groups.insert({
  body: { snippet: { title: "Tutorials" }, contentDetails: { itemType: "youtube#video" } },
});`,
  },
  "youtubeAnalytics.groups.update": {
    summary: "Renames an Analytics group.",
    quota: 1,
    example: `await yt.analytics.groups.update({ body: { id: groupId, snippet: { title: "Tutorials 2026" } } });`,
  },
  "youtubeAnalytics.groups.delete": {
    summary: "Deletes an Analytics group.",
    quota: 1,
    requires: ["id"],
    example: `await yt.analytics.groups.delete({ id: groupId });`,
  },
  "youtubeAnalytics.groupItems.list": {
    summary: "Lists the items of an Analytics group.",
    quota: 1,
    requires: ["groupId"],
    example: `const { items } = await yt.analytics.groupItems.list({ groupId });`,
  },
  "youtubeAnalytics.groupItems.insert": {
    summary: "Adds a video, playlist, channel or asset to an Analytics group.",
    quota: 1,
    example: `await yt.analytics.groupItems.insert({ body: { groupId, resource: { kind: "youtube#video", id: videoId } } });`,
  },
  "youtubeAnalytics.groupItems.delete": {
    summary: "Removes an item from an Analytics group.",
    quota: 1,
    requires: ["id"],
    example: `await yt.analytics.groupItems.delete({ id: groupItemId });`,
  },

  // ----- YouTube Reporting API
  "youtubereporting.reportTypes.list": {
    summary: "Lists the bulk report types your channel or content owner can schedule.",
    quota: 1,
    example: `const types = await yt.reporting.reportTypes.list().all();`,
  },
  "youtubereporting.jobs.create": {
    summary: "Schedules a bulk report. YouTube then generates one file a day, the first within 48 hours.",
    quota: 1,
    example: `const job = await yt.reporting.jobs.create({ body: { reportTypeId: "channel_basic_a3", name: "Daily channel stats" } });`,
  },
  "youtubereporting.jobs.list": {
    summary: "Lists your reporting jobs.",
    quota: 1,
    example: `const jobs = await yt.reporting.jobs.list().all();`,
  },
  "youtubereporting.jobs.get": {
    summary: "Fetches one reporting job.",
    quota: 1,
    example: `const job = await yt.reporting.jobs.get({ jobId });`,
  },
  "youtubereporting.jobs.delete": {
    summary: "Deletes a reporting job. Reports already generated stay downloadable for a while.",
    quota: 1,
    example: `await yt.reporting.jobs.delete({ jobId });`,
  },
  "youtubereporting.jobs.reports.list": {
    summary: "Lists the report files generated for a job. Download one with `yt.reporting.download()`.",
    quota: 1,
    types: { createdAfter: DATE, startTimeAtOrAfter: DATE, startTimeBefore: DATE },
    example: `for await (const report of yt.reporting.reports.list({ jobId })) {
  console.log(report.startTime, report.downloadUrl);
}`,
  },
  "youtubereporting.jobs.reports.get": {
    summary: "Fetches the metadata of one report file.",
    quota: 1,
    example: `const report = await yt.reporting.reports.get({ jobId, reportId });`,
  },
  "youtubereporting.media.download": {
    summary: "Downloads a report file.",
    quota: 1,
    handwritten: true,
  },
};

/** Names the examples can use without declaring them. */
export const exampleScope = `declare const yt: YouTube;
declare const videoId: string, channelId: string, playlistId: string, playlistItemId: string, playlistImageId: string;
declare const commentId: string, captionId: string, sectionId: string, subscriptionId: string;
declare const broadcastId: string, streamId: string, liveChatId: string, messageId: string, banId: string, moderatorId: string;
declare const groupId: string, groupItemId: string, jobId: string, reportId: string;
declare const file: Blob, image: Blob, srtText: string;`;
