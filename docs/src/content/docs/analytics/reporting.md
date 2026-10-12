---
title: Reporting
description: Schedule bulk reports once and collect them as CSV files, one per day. For exporting everything about a channel into your own database.
sidebar:
  order: 2
---

```ts
// Once.
const job = await yt.reporting.jobs.create({ body: { reportTypeId: "channel_basic_a3", name: "Channel basics" } });

// A day or two later, and every day after that.
if (job.id) {
  for await (const report of yt.reporting.reports.list({ jobId: job.id })) {
    const csv = await yt.reporting.download(report);
    console.log(report.startTime, csv.length);
  }
}
```

## How bulk reports work

The Reporting API does not answer questions. It delivers files.

1. You pick a report type, a fixed set of columns that YouTube defines.
2. You create a job for it, once.
3. YouTube generates one CSV file a day for that job, the first within 48 hours.
4. You list the files of the job and download the new ones.

For a question such as "top videos this month", [Analytics](/analytics/analytics/) answers in one call. [Reporting or Analytics](#reporting-or-analytics) compares the two.

Everything here needs OAuth, and nothing is billed in quota units: see [Limits and errors](#limits-and-errors).

## Choosing a report type

`reportTypes.list` returns the types your channel or content owner can schedule.

```ts
const types = await yt.reporting.reportTypes.list().all();

for (const type of types) {
  console.log(type.id, type.name, type.deprecateTime ?? "");
}
```

`type.id` is what a job takes. `deprecateTime` is set on a type that was or will be deprecated.

`includeSystemManaged: true` also lists the system-managed types. YouTube creates the jobs of those itself, so they cannot be passed to `jobs.create`.

## Scheduling a job

```ts
const job = await yt.reporting.jobs.create({
  body: { reportTypeId: "channel_basic_a3", name: "Daily channel stats" },
});

console.log(job.id, job.createTime);
```

Create the job once and keep its id. The rest of the time you only list and download.

```ts
const jobs = await yt.reporting.jobs.list().all();
const one = await yt.reporting.jobs.get({ jobId });

await yt.reporting.jobs.delete({ jobId });
```

A job has an `expireTime`: after it, no new report is generated. Reports already generated for a deleted job stay downloadable for a while.

`jobs.list({ includeSystemManaged: true })` adds the jobs YouTube manages. Those can be neither changed nor deleted.

## Listing the files

`reports.list` returns the files generated for a job. Three filters keep the list short:

```ts
const lastWeek = new Date(Date.now() - 7 * 86_400_000);

for await (const report of yt.reporting.reports.list({ jobId, createdAfter: lastWeek })) {
  console.log(report.id, report.startTime, report.endTime, report.createTime);
}
```

| Filter | Keeps the reports |
| --- | --- |
| `createdAfter` | Created after this moment |
| `startTimeAtOrAfter` | Whose period starts at this moment or later |
| `startTimeBefore` | Whose period starts before this moment |

Each takes a `Date` or an ISO 8601 string.

A report covers the period from `startTime`, included, to `endTime`, excluded. `createTime` is when the file was generated.

Use `createdAfter` to collect only what is new. Store the `createTime` of the newest report you processed, and pass it next time:

```ts
const since: string | undefined = await db.get("reports:lastCreateTime");
let newest = since;

for await (const report of yt.reporting.reports.list({ jobId, ...(since ? { createdAfter: since } : {}) })) {
  await db.insert("reports", { id: report.id, day: report.startTime, csv: await yt.reporting.download(report) });
  if (report.createTime && (!newest || report.createTime > newest)) newest = report.createTime;
}

if (newest) await db.set("reports:lastCreateTime", newest);
```

`reports.get({ jobId, reportId })` fetches the metadata of one file.

## Downloading

`yt.reporting.download()` takes a report, or its `downloadUrl`, and resolves to the CSV text.

```ts
const report = await yt.reporting.reports.get({ jobId, reportId });
const csv = await yt.reporting.download(report);

const [header, ...lines] = csv.trim().split("\n");
console.log(header?.split(","), lines.length);
```

For a large file, `downloadResponse()` resolves to the raw `Response`. Stream its body to disk without holding it in memory:

```ts
import { createWriteStream } from "node:fs";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream } from "node:stream/web";

const report = await yt.reporting.reports.get({ jobId, reportId });
const response = await yt.reporting.downloadResponse(report);

if (response.body) {
  await pipeline(Readable.fromWeb(response.body as ReadableStream), createWriteStream(`report-${report.id}.csv`));
}
```

A download is a single request. It is not retried, and the client's `timeout` does not apply to it. Pass a `signal` to bound it:

```ts
const report = await yt.reporting.reports.get({ jobId, reportId });
const csv = await yt.reporting.download(report, { signal: AbortSignal.timeout(60_000) });
```

### The check on the download host

A download carries your access token. Before sending it, the client checks the URL: it must be `https` and its host must be `youtubereporting.googleapis.com`. Anything else throws a `YouTubeArgumentError` and nothing is sent.

```ts
try {
  await yt.reporting.download("https://example.com/report.csv");
} catch (error) {
  console.log(isYouTubeError(error, "INVALID_ARGUMENT")); // true
}
```

So a `downloadUrl` you stored yourself is safe to pass back: a tampered one cannot send the token elsewhere. A report without a `downloadUrl` throws the same error.

## Content owners

Every method of `reportTypes`, `jobs` and `reports` accepts `onBehalfOfContentOwner`, for YouTube content partners.

```ts
const owner = "CONTENT_OWNER_ID";

const types = await yt.reporting.reportTypes.list({ onBehalfOfContentOwner: owner }).all();
const jobs = await yt.reporting.jobs.list({ onBehalfOfContentOwner: owner }).all();

for (const job of jobs) {
  if (!job.id) continue;
  for await (const report of yt.reporting.reports.list({ jobId: job.id, onBehalfOfContentOwner: owner })) {
    console.log(job.name, report.startTime);
  }
}
```

Pass it on each call, or once with the `onBehalfOfContentOwner` option of the client, which applies to these methods too. `download` takes no such parameter: it uses the URL of the report as it is.

## Reporting or Analytics

| | Reporting | Analytics |
| --- | --- | --- |
| You get | CSV files, one a day per job | The rows of the report you asked for |
| When | The first file within 48 hours of creating the job, then daily | At once |
| Shape | The columns of the report type | Your choice of metrics, dimensions, filters and sort |
| Setup | A job to create and files to collect | None |
| Fits | A full export into your own database | A dashboard, a one-off question, a top 10 |

Start with Analytics. Move to Reporting when you want the whole data set every day and not the answer to one question.

## Reference

### Methods

| Method | What it does |
| --- | --- |
| `yt.reporting.reportTypes.list(params?)` | Lists the report types you can schedule |
| `yt.reporting.jobs.create({ body })` | Schedules a report: `body.reportTypeId` and `body.name` |
| `yt.reporting.jobs.list(params?)` | Lists your jobs |
| `yt.reporting.jobs.get({ jobId })` | Fetches one job |
| `yt.reporting.jobs.delete({ jobId })` | Deletes a job |
| `yt.reporting.reports.list({ jobId, ... })` | Lists the files generated for a job |
| `yt.reporting.reports.get({ jobId, reportId })` | Fetches the metadata of one file |
| `yt.reporting.download(report, options?)` | Downloads a file and resolves to its CSV text |
| `yt.reporting.downloadResponse(report, options?)` | Downloads a file and resolves to the raw `Response` |

The three `list` methods return a [list request](/basics/lists/): await it for a page, iterate it, or call `.all()`. They take `pageSize` where the Data API takes `maxResults`.

### `ReportingReportType`

| Field | Meaning |
| --- | --- |
| `id` | Id of the report type. This is `reportTypeId` in a job |
| `name` | Name of the report type |
| `deprecateTime` | When the type was or will be deprecated |
| `systemManaged` | True for a type whose jobs YouTube creates itself |

### `ReportingJob`

| Field | Meaning |
| --- | --- |
| `id` | Id of the job, generated by the server |
| `name` | The name you gave, 100 characters at most |
| `reportTypeId` | The report type the job produces |
| `createTime` | When the job was created |
| `expireTime` | When the job expires. No report is generated after it |
| `systemManaged` | True for a job YouTube manages. It cannot be changed |

### `ReportingReport`

| Field | Meaning |
| --- | --- |
| `id` | Id of the report, generated by the server |
| `jobId` | The job that created it |
| `startTime` | Start of the period covered, included |
| `endTime` | End of the period covered, excluded |
| `createTime` | When the file was generated |
| `downloadUrl` | Where to download it. Pass the report itself to `download` |
| `jobExpireTime` | When the job of this report expires |

Every field is optional in the types: check `id` before you rely on it.

## Limits and errors

Scopes, any one of:

| Scope | Constant |
| --- | --- |
| `yt-analytics.readonly` | `Scopes.analytics` |
| `yt-analytics-monetary.readonly` | `Scopes.analyticsMonetary` |

With an API key only, every call throws a `YouTubeAuthError` with the code `MISSING_CREDENTIALS` before anything is sent. A token that has neither scope throws `INSUFFICIENT_SCOPE`.

Google does not bill Reporting calls in quota units. The client counts them for your information, one per call and per download, under `yt.quota.usage.reporting`. They never touch the Data API bucket.

| Situation | What you get |
| --- | --- |
| A download URL on another host, or not `https` | `YouTubeArgumentError`, nothing sent |
| A report without `downloadUrl` | `YouTubeArgumentError`, nothing sent |
| A download the server refuses | `YouTubeApiError` with the status |
| A download that fails on the network | `YouTubeRequestError`, code `NETWORK`. Not retried |

## See also

- [Analytics](/analytics/analytics/) for reports on demand.
- [Lists](/basics/lists/) for `.all()`, `for await` and pages.
- [Scopes](/auth/scopes/) and [OAuth](/auth/oauth/) for the credentials.
- [Configuration](/basics/configuration/) for the options of the client.
