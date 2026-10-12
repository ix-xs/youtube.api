---
title: Subscriptions
description: Subscribe and unsubscribe by handle, URL or id, list who a user follows and who follows them, and read the members of a channel.
sidebar:
  order: 6
---

```ts
const subscription = await yt.subscriptions.to("@GoogleDevelopers");

if (!subscription) {
  await yt.subscriptions.subscribe("@GoogleDevelopers");
}
```

Everything about the authenticated user's own subscriptions needs OAuth. An API key only lists the subscriptions of a channel that made them public.

## Checking a subscription

`yt.subscriptions.to` finds the authenticated user's subscription to a channel. It resolves to the subscription, or to `null` when they are not subscribed. The channel can be an id, a handle or a URL.

```ts
const subscription = await yt.subscriptions.to(
  "https://www.youtube.com/@GoogleDevelopers",
);

if (subscription) {
  const { title, publishedAt } = subscription.snippet;

  console.log(subscription.id); // the subscription id, needed to delete it
  console.log(title, "since", publishedAt);
}
```

It costs 1 quota unit, plus 1 the first time a handle or a name has to be turned into a channel id. A reference that matches no channel throws a `YouTubeArgumentError`.

## Subscribing and unsubscribing

`yt.subscriptions.subscribe` subscribes the authenticated user to a channel and resolves to the new subscription. It costs 50 units.

```ts
const subscription = await yt.subscriptions.subscribe("@GoogleDevelopers");

console.log(subscription.id, subscription.snippet.title);
```

`yt.subscriptions.unsubscribe` looks the subscription up, then deletes it. It resolves to `false` when the user was not subscribed, and that costs 1 unit. An actual removal costs 51: 1 to find the subscription, 50 to delete it.

```ts
const removed = await yt.subscriptions.unsubscribe("@GoogleDevelopers");

console.log(removed ? "Unsubscribed" : "Was not subscribed");
```

Subscribing to a channel the user already follows fails with the reason `subscriptionDuplicate`. Catch it, or check with `to` first for 1 unit:

```ts
try {
  await yt.subscriptions.subscribe(channelId);
} catch (error) {
  if (
    error instanceof YouTubeApiError &&
    error.reason === "subscriptionDuplicate"
  ) {
    console.log("Already subscribed");
  } else {
    throw error;
  }
}
```

## Listing your subscriptions

The raw `yt.subscriptions.list` with `mine: true` lists the channels the authenticated user follows. It costs 1 unit per page of 50.

```ts
const mine = yt.subscriptions.list({
  part: "snippet",
  mine: true,
  order: "alphabetical",
});

for await (const subscription of mine) {
  const { title, resourceId } = subscription.snippet;
  console.log(title, resourceId.channelId);
}
```

In the snippet of a subscription, `title`, `description` and `thumbnails` describe the channel subscribed to. Its id is `snippet.resourceId.channelId`. `snippet.channelId` is the other side: the subscriber's channel.

| `order` | Sorts by |
| --- | --- |
| `"alphabetical"` | Alphabetical order |
| `"relevance"` | Relevance |
| `"unread"` | Order of activity |

The `contentDetails` part adds counters:

```ts
const subscriptions = await yt.subscriptions
  .list({ part: ["snippet", "contentDetails"], mine: true, order: "unread" })
  .take(20);

for (const subscription of subscriptions) {
  const { newItemCount } = subscription.contentDetails;
  console.log(subscription.snippet.title, newItemCount, "new");
}
```

To test several channels at once, pass their ids to `forChannelId`, separated by commas. Only the ones the user follows come back:

```ts
const followed = await yt.subscriptions
  .list({ part: "snippet", mine: true, forChannelId: ids.join(",") })
  .all();

const followedIds = new Set(
  followed.map((subscription) => subscription.snippet.resourceId.channelId),
);
```

This is a raw method: awaited without `maxResults`, it returns the API's default page of 5. Iterating, `take` and `all` ask for pages of 50.

## Listing the subscriptions of a channel

With `channelId`, the same method lists who a channel follows. This works with an API key, but only when the channel made its subscriptions public.

```ts
const subscriptions = await yt.subscriptions
  .list({ part: "snippet", channelId })
  .take(50);

for (const subscription of subscriptions) {
  console.log(subscription.snippet.title);
}
```

When they are private, the call fails with the reason `subscriptionForbidden`:

```ts
try {
  await yt.subscriptions.list({ part: "snippet", channelId }).take(50);
} catch (error) {
  if (
    error instanceof YouTubeApiError &&
    error.reason === "subscriptionForbidden"
  ) {
    console.log("This channel keeps its subscriptions private");
  } else {
    throw error;
  }
}
```

## Listing your subscribers

`mySubscribers: true` turns the list around: it returns the subscriptions of other users to the authenticated user's channel. Ask for the `subscriberSnippet` part, which describes the subscriber.

```ts
const subscribers = yt.subscriptions.list({
  part: "subscriberSnippet",
  mySubscribers: true,
});

for await (const subscription of subscribers) {
  const subscriber = subscription.subscriberSnippet;
  console.log(subscriber.title, subscriber.channelId);
}
```

`myRecentSubscribers: true` lists them most recent first:

```ts
const recent = await yt.subscriptions
  .list({ part: ["snippet", "subscriberSnippet"], myRecentSubscribers: true })
  .take(20);

for (const subscription of recent) {
  const { title } = subscription.subscriberSnippet;
  console.log(title, subscription.snippet.publishedAt);
}
```

Both need OAuth and cost 1 unit per page of 50. For the number of subscribers, read `statistics.subscriberCount` on the [channel](/resources/channels/) instead.

## Using the raw insert and delete

`subscribe` and `unsubscribe` are built on `yt.subscriptions.insert` and `yt.subscriptions.delete`. Use them when you already hold the ids. Each costs 50 units.

```ts
const created = await yt.subscriptions.insert({
  part: "snippet",
  body: { snippet: { resourceId: { kind: "youtube#channel", channelId } } },
});

await yt.subscriptions.delete({ id: created.id });
```

`delete` takes the id of the subscription, not the id of the channel. Keep it when you create the subscription, or find it with `yt.subscriptions.to`.

## Reading channel members

Channel members are the paying members of a channel, which is something else than its subscribers. Two methods read them, for the channel of the authenticated user only:

- `yt.members.list` lists the members.
- `yt.membershipsLevels.list` lists the levels the channel offers.

Both need prior approval from YouTube for your project. Both need OAuth with the `youtube.channel-memberships.creator` scope, and cost 1 unit.

```ts
const members = await yt.members
  .list({ part: "snippet", mode: "all_current" })
  .all();

for (const member of members) {
  const details = member.snippet.memberDetails;
  const membership = member.snippet.membershipsDetails;
  const months = membership?.membershipsDuration?.memberTotalDurationMonths;

  console.log(details?.displayName, details?.channelId);
  console.log(membership?.highestAccessibleLevelDisplayName, months, "months");
}
```

| Option of `members.list` | What it does |
| --- | --- |
| `mode: "all_current"` | All current members, from newest to oldest |
| `mode: "updates"` | Only the members that joined after the first call made with this mode |
| `hasAccessToLevel` | Only the members that have access to this level id |
| `filterByMemberChannelId` | Only these members: channel ids separated by commas |
| `maxResults` | 0-1000, default 5. Iterating or `all` uses 1000 |

```ts
const { items } = await yt.membershipsLevels.list({ part: "snippet" });

for (const level of items) {
  console.log(level.id, level.snippet.levelDetails?.displayName);
}
```

The `snippet` of a member or a level is there when you ask for it. Every field inside is optional in the type: read them with `?.`.

## Reference

Helpers:

| Helper | What it does | Quota |
| --- | --- | --- |
| `yt.subscriptions.to(channel)` | The user's subscription to a channel, or `null`. OAuth | 1 |
| `yt.subscriptions.subscribe(channel)` | Subscribes the user to a channel. OAuth | 50 |
| `yt.subscriptions.unsubscribe(channel)` | Unsubscribes. `false` when not subscribed. OAuth | 1, plus 50 when a subscription is deleted |

The three helpers add 1 unit the first time they resolve a handle or a name, as [`yt.channels.resolveId`](/resources/channels/#getting-only-the-id) does. Pass a `UC...` id to avoid it.

Raw methods:

| Method | Quota | Auth |
| --- | --- | --- |
| `yt.subscriptions.list` | 1 | Key with `channelId`. OAuth for `mine`, `mySubscribers` and `myRecentSubscribers` |
| `yt.subscriptions.insert` | 50 | OAuth |
| `yt.subscriptions.delete` | 50 | OAuth |
| `yt.members.list` | 1 | OAuth, `youtube.channel-memberships.creator` |
| `yt.membershipsLevels.list` | 1 | OAuth, `youtube.channel-memberships.creator` |

`insert` and `delete` accept the scopes `youtube`, `youtube.force-ssl` and `youtubepartner`. `list` also accepts `youtube.readonly`. [Scopes](/auth/scopes/) lists what each one grants.

Parts of a subscription:

| Part | What it holds | Always returned when requested |
| --- | --- | --- |
| `snippet` | The channel subscribed to (`title`, `description`, `thumbnails`, `resourceId`), the subscriber's `channelId`, the date | Yes |
| `contentDetails` | `totalItemCount`, `newItemCount`, `activityType` | Yes |
| `subscriberSnippet` | The subscriber: `title`, `description`, `channelId`, `thumbnails` | Yes |
| `id` | Nothing more: `kind`, `etag` and `id` are on every result | Yes |

A member and a membership level carry their data in a single part, `snippet`.

## See also

- [Channels](/resources/channels/) for the subscriber count and for resolving handles.
- [Scopes](/auth/scopes/) for what each scope grants.
- [OAuth](/auth/oauth/) to get a token for the user.
- [Watching uploads](/notifications/watching-uploads/) to follow channels without subscribing to them.
