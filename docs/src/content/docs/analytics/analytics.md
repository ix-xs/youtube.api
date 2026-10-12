---
title: Analytics
description: Run YouTube Analytics reports on your channel. Views, watch time, subscribers and revenue, split by day, video, country or traffic source, come back as typed rows.
sidebar:
  order: 1
---

```ts
const report = await yt.analytics.query({
  startDate: "2026-01-01",
  endDate: "2026-01-31",
  metrics: ["views", "estimatedMinutesWatched", "subscribersGained"],
  dimensions: "day",
  sort: "day",
});

for (const row of report.rows) {
  console.log(row.day, row.views, row.estimatedMinutesWatched, row.subscribersGained);
}
```

## What a query is

A report answers one question: these `metrics`, between two dates, split by these `dimensions`.

- A metric is something measured: `views`, `likes`, `estimatedMinutesWatched`, `subscribersGained`.
- A dimension is how the numbers are split: `day`, `video`, `country`, `deviceType`.

Without dimensions the report is a single row of totals:

```ts
const totals = await yt.analytics.query({
  startDate: "2026-01-01",
  endDate: "2026-12-31",
  metrics: ["views", "likes", "comments"],
});

console.log(totals.rows[0]?.views);
```

Analytics needs OAuth: the data is private to the channel. See [Scopes](#scopes). Calls are not billed in quota units: see [Quota](#quota).

## Reading the result

`report.rows` holds one object per row, keyed by the names you asked for. Metrics are numbers. Dimensions are strings.

```ts
const report = await yt.analytics.query({
  startDate: "2026-01-01",
  endDate: "2026-01-31",
  metrics: ["views", "averageViewDuration"],
  dimensions: "country",
});

const first = report.rows[0];
if (first) {
  first.country; // string, for example "FR"
  first.views; // number
  first.averageViewDuration; // number
  // @ts-expect-error likes was not requested
  first.likes;
}
```

The row type follows `metrics` and `dimensions`, the same way a resource type follows `part`.

| On the report | Content |
| --- | --- |
| `rows` | One object per row. Empty when there is no data for the query |
| `columns` | `{ name, type, dataType }` per column, dimensions first, in the order of the request |
| `raw` | The response as the API sent it, with rows as arrays |

A report with the `day` dimension has no rows for the most recent days.

## Dates

`startDate` and `endDate` are both included. Each is a `YYYY-MM-DD` string or a `Date`. Analytics days are in Pacific Time.

A `Date` is read on your own calendar: the year, month and day it shows in the local time zone of the process. It is not converted to UTC, so "today" stays today wherever you run.

```ts
const today = new Date();
const monthAgo = new Date(today.getFullYear(), today.getMonth() - 1, today.getDate());

const lastMonth = await yt.analytics.query({ startDate: monthAgo, endDate: today, metrics: "views", dimensions: "day" });
```

A string in another format, or an invalid `Date`, throws a `YouTubeArgumentError` before anything is sent.

## Filtering and sorting

`filters` restricts the data. An object is the readable form. An array value means "any of".

```ts
const report = await yt.analytics.query({
  startDate: "2026-01-01",
  endDate: "2026-03-31",
  metrics: ["views", "estimatedMinutesWatched"],
  dimensions: "day",
  filters: { video: videoId, country: ["FR", "BE", "CH"] },
  sort: "-views",
});
```

The API's own syntax works too: `filters: "video==dQw4w9WgXcQ;country==FR"`.

`sort` takes one column or a list. Prefix a name with `-` for descending order: `sort: ["-views", "day"]`. Sort by columns that are in `metrics` or `dimensions`.

`maxResults` caps the number of rows, and `startIndex` is the 1-based index of the first row, to page through a long report.

## Worked examples

### Daily views for a month

```ts
const daily = await yt.analytics.query({
  startDate: "2026-03-01",
  endDate: "2026-03-31",
  metrics: ["views", "estimatedMinutesWatched"],
  dimensions: "day",
  sort: "day",
});

const total = daily.rows.reduce((sum, row) => sum + row.views, 0);
console.log(`${total} views over ${daily.rows.length} days`);
```

### Top 10 videos

The `video` dimension gives ids, not titles. Fetch the titles with one `videos.list` call, 1 unit:

```ts
const top = await yt.analytics.query({
  startDate: "2026-01-01",
  endDate: "2026-12-31",
  metrics: ["views", "likes", "estimatedMinutesWatched"],
  dimensions: "video",
  sort: "-views",
  maxResults: 10,
});

const videos = await yt.videos.getMany(
  top.rows.map((row) => row.video),
  { part: "snippet" },
);
const titles = new Map(videos.map((video) => [video.id, video.snippet.title]));

for (const row of top.rows) console.log(row.views, titles.get(row.video) ?? row.video);
```

Some reports require `maxResults`. Top videos is one of them.

### Traffic sources

```ts
const sources = await yt.analytics.query({
  startDate: "2026-01-01",
  endDate: "2026-03-31",
  metrics: ["views", "estimatedMinutesWatched"],
  dimensions: "insightTrafficSourceType",
  sort: "-views",
});

for (const row of sources.rows) console.log(row.insightTrafficSourceType, row.views);
```

### Audience by country

```ts
const countries = await yt.analytics.query({
  startDate: "2026-01-01",
  endDate: "2026-03-31",
  metrics: ["views", "averageViewDuration"],
  dimensions: "country",
  sort: "-views",
  maxResults: 25,
});

for (const row of countries.rows) console.log(row.country, row.views, `${Math.round(row.averageViewDuration)} s`);
```

### Revenue

Revenue metrics need the `yt-analytics-monetary.readonly` scope. `currency` is an ISO 4217 code, `USD` by default.

```ts
const revenue = await yt.analytics.query({
  startDate: "2026-01-01",
  endDate: "2026-01-31",
  metrics: ["estimatedRevenue", "estimatedAdRevenue", "cpm"],
  dimensions: "day",
  currency: "EUR",
});

const earned = revenue.rows.reduce((sum, row) => sum + row.estimatedRevenue, 0);
console.log(`${earned.toFixed(2)} EUR`);
```

## Not every combination exists

Not every combination of metrics and dimensions exists. The API answers 400 for one it does not support. The valid ones are listed in YouTube's [channel reports reference](https://developers.google.com/youtube/analytics/channel_reports).

```ts
try {
  await yt.analytics.query({
    startDate: "2026-01-01",
    endDate: "2026-01-31",
    metrics: ["viewerPercentage"],
    dimensions: ["ageGroup", "gender", "insightTrafficSourceType"],
  });
} catch (error) {
  if (error instanceof YouTubeApiError && error.status === 400) console.error("No such report:", error.message);
  else throw error;
}
```

The names are typed, so your editor completes the documented metrics and dimensions. The types stay open for names YouTube adds later. They do not know which combinations are valid: only the API does.

## Whose data

`ids` says whose data to report on. It defaults to `"channel==MINE"`, the channel of the authenticated user.

```ts
await yt.analytics.query({ ids: `channel==${channelId}`, startDate: "2026-01-01", endDate: "2026-01-31", metrics: "views" });
```

Content owners use `"contentOwner==NAME"`, with the name of the owner in YouTube's CMS. `includeHistoricalChannelData: true` adds the data from before a channel was linked to the owner.

## Groups

A group is a custom collection of up to 500 videos, playlists, channels or assets that you report on as one. Groups live under `yt.analytics.groups`, their content under `yt.analytics.groupItems`.

```ts
const group = await yt.analytics.groups.insert({
  body: { snippet: { title: "Tutorials" }, contentDetails: { itemType: "youtube#video" } },
});

if (group.id) {
  await yt.analytics.groupItems.insert({ body: { groupId: group.id, resource: { kind: "youtube#video", id: videoId } } });

  const report = await yt.analytics.query({
    startDate: "2026-01-01",
    endDate: "2026-03-31",
    metrics: ["views", "estimatedMinutesWatched"],
    filters: { group: group.id },
  });
  console.log(report.rows[0]?.views);
}
```

`itemType` is `youtube#video`, `youtube#playlist`, `youtube#channel` or `youtubePartner#asset`. A group holds one type.

```ts
const { items } = await yt.analytics.groups.list({ mine: true });
for (const group of items) console.log(group.id, group.snippet?.title, group.contentDetails?.itemCount);

const content = await yt.analytics.groupItems.list({ groupId });
for (const item of content.items) console.log(item.id, item.resource?.id);

await yt.analytics.groups.update({ body: { id: groupId, snippet: { title: "Tutorials 2026" } } });
await yt.analytics.groups.delete({ id: groupId });
```

`groupItems.delete` takes the id of the group item, `item.id` above, not the id of the video.

## Reference

### `yt.analytics.query(query, options?)`

| Field | Type | Meaning |
| --- | --- | --- |
| `startDate` | `string \| Date` | First day, included. Required |
| `endDate` | `string \| Date` | Last day, included. Required |
| `metrics` | one name or a list | What to measure. Required |
| `dimensions` | one name or a list | How to split the numbers. Without it, one row of totals |
| `filters` | object or string | Restricts the data |
| `sort` | one name or a list | Columns to sort by, `-` for descending |
| `maxResults` | `number` | Rows to return at most. Some reports require it |
| `startIndex` | `number` | 1-based index of the first row |
| `currency` | `string` | Currency of revenue metrics, ISO 4217. Default `USD` |
| `ids` | `string` | `"channel==MINE"` by default, `channel==ID` or `contentOwner==NAME` |
| `includeHistoricalChannelData` | `boolean` | For content owners: include data from before the channel was linked |

### Groups

| Method | What it does |
| --- | --- |
| `yt.analytics.groups.list({ mine: true })` | Lists your groups, or some by `id` |
| `yt.analytics.groups.insert({ body })` | Creates a group |
| `yt.analytics.groups.update({ body })` | Renames a group |
| `yt.analytics.groups.delete({ id })` | Deletes a group |
| `yt.analytics.groupItems.list({ groupId })` | Lists the items of a group |
| `yt.analytics.groupItems.insert({ body })` | Adds a video, playlist, channel or asset to a group |
| `yt.analytics.groupItems.delete({ id })` | Removes an item from a group |

### Types

| Type | What it is |
| --- | --- |
| `AnalyticsMetric` | The documented metric names, open to others |
| `AnalyticsDimension` | The documented dimension names, open to others |
| `AnalyticsQuery<M, D>` | The parameters of `query` |
| `AnalyticsReport<M, D>` | The result: `rows`, `columns`, `raw` |

## Limits and errors

### Scopes

| Scope | Gives |
| --- | --- |
| `yt-analytics.readonly` | YouTube Analytics reports |
| `yt-analytics-monetary.readonly` | Monetary reports: the revenue metrics |

Ask for them when you build the consent URL: see [OAuth](/auth/oauth/) and [Scopes](/auth/scopes/).

With an API key only, every Analytics call throws a `YouTubeAuthError` with the code `MISSING_CREDENTIALS` before anything is sent. With a token that lacks the scope, it throws `INSUFFICIENT_SCOPE`.

### Quota

Google does not bill Analytics calls in quota units. They do not draw from the 10,000 daily units of the Data API.

The client still counts them, one per call, in a bucket of its own with no limit. That count is for your information:

```ts
yt.quota.usage.analytics; // calls made today
yt.quota.used; // unchanged: this is the Data API bucket
```

### Errors

| Situation | What you get |
| --- | --- |
| A combination of metrics and dimensions the API does not support | `YouTubeApiError`, status 400, code `BAD_REQUEST` |
| A date that is not `YYYY-MM-DD`, or an invalid `Date` | `YouTubeArgumentError`, nothing sent |
| An API key and no OAuth | `YouTubeAuthError`, code `MISSING_CREDENTIALS`, nothing sent |

Read `error.message` on a 400: it is the API's own explanation of what the report does not accept.

## See also

- [Reporting](/analytics/reporting/) for bulk exports as daily CSV files.
- [Scopes](/auth/scopes/) for the two Analytics scopes.
- [Errors](/basics/errors/) for `error.code` and `error.reason`.
- [Videos](/resources/videos/) to turn the ids of a report into titles.
