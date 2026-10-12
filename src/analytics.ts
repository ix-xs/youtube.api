import { YouTubeArgumentError } from "./core/errors.js";
import type { OneOrMany } from "./core/resource.js";
import type { RequestOptions, Rest } from "./core/rest.js";
import { AnalyticsGroupItemsApi, AnalyticsGroupsApi, type AnalyticsQueryResponse } from "./generated/analytics.js";
import { METHODS } from "./generated/methods.js";

/** Metrics of the YouTube Analytics API. The list covers the documented ones; the type stays open for new ones. */
export type AnalyticsMetric =
  | "views"
  | "engagedViews"
  | "redViews"
  | "comments"
  | "likes"
  | "dislikes"
  | "shares"
  | "videosAddedToPlaylists"
  | "videosRemovedFromPlaylists"
  | "estimatedMinutesWatched"
  | "estimatedRedMinutesWatched"
  | "averageViewDuration"
  | "averageViewPercentage"
  | "subscribersGained"
  | "subscribersLost"
  | "viewerPercentage"
  | "audienceWatchRatio"
  | "relativeRetentionPerformance"
  | "cardImpressions"
  | "cardClicks"
  | "cardClickRate"
  | "cardTeaserImpressions"
  | "cardTeaserClicks"
  | "cardTeaserClickRate"
  | "playlistStarts"
  | "playlistViews"
  | "playlistSaves"
  | "playlistEstimatedMinutesWatched"
  | "playlistAverageViewDuration"
  | "viewsPerPlaylistStart"
  | "averageTimeInPlaylist"
  | "averageConcurrentViewers"
  | "peakConcurrentViewers"
  | "estimatedRevenue"
  | "estimatedAdRevenue"
  | "estimatedRedPartnerRevenue"
  | "grossRevenue"
  | "monetizedPlaybacks"
  | "playbackBasedCpm"
  | "adImpressions"
  | "cpm"
  | (string & {});

/** Dimensions of the YouTube Analytics API. */
export type AnalyticsDimension =
  | "day"
  | "month"
  | "video"
  | "playlist"
  | "channel"
  | "group"
  | "country"
  | "province"
  | "city"
  | "dma"
  | "subscribedStatus"
  | "youtubeProduct"
  | "creatorContentType"
  | "liveOrOnDemand"
  | "insightTrafficSourceType"
  | "insightTrafficSourceDetail"
  | "insightPlaybackLocationType"
  | "insightPlaybackLocationDetail"
  | "deviceType"
  | "operatingSystem"
  | "ageGroup"
  | "gender"
  | "sharingService"
  | "elapsedVideoTimeRatio"
  | "audienceType"
  | "adType"
  | "claimedStatus"
  | "uploaderType"
  | "asset"
  | (string & {});

/** Parameters of {@link Analytics.query}. */
export interface AnalyticsQuery<M extends string, D extends string> {
  /**
   * Whose data to report on. Default `"channel==MINE"`, the authenticated
   * user's channel. Content owners use `"contentOwner==NAME"`.
   */
  ids?: "channel==MINE" | `channel==${string}` | `contentOwner==${string}`;
  /** First day of the report, `YYYY-MM-DD` or a Date. Days are in Pacific Time. */
  startDate: string | Date;
  /** Last day of the report, `YYYY-MM-DD` or a Date. */
  endDate: string | Date;
  /** What to measure. */
  metrics: OneOrMany<M>;
  /** How to split the numbers. Without dimensions the report is a single row of totals. */
  dimensions?: OneOrMany<D>;
  /**
   * Restricts the data. An object is the readable form:
   * `{ video: "dQw4w9WgXcQ", country: "FR" }`. An array value means any of.
   * The raw syntax (`"video==dQw4w9WgXcQ;country==FR"`) works too.
   */
  filters?: string | Record<string, string | readonly string[]>;
  /** Columns to sort by. Prefix with `-` for descending: `"-views"`. */
  sort?: OneOrMany<M | D | `-${M | D}`>;
  /** Rows to return at most. Some reports, such as top videos, require it. */
  maxResults?: number;
  /** 1-based index of the first row, to page through a long report. */
  startIndex?: number;
  /** Currency of revenue metrics, ISO 4217. Default `USD`. */
  currency?: string;
  /** Include data from before the channel was linked to its content owner. */
  includeHistoricalChannelData?: boolean;
}

/** A report with its rows turned into objects. */
export interface AnalyticsReport<M extends string, D extends string> {
  /** One object per row, keyed by dimension and metric name. Metrics are numbers, dimensions strings. */
  rows: Array<{ [K in D]: string } & { [K in M]: number }>;
  /** The columns, dimensions first, in the order of the request. */
  columns: Array<{ name: string; type: "DIMENSION" | "METRIC"; dataType: string }>;
  /** The response as the API sent it, rows as arrays. */
  raw: AnalyticsQueryResponse;
}

function day(value: string | Date): string {
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) throw new YouTubeArgumentError("Invalid Date in an Analytics query.");
    // The day on the caller's own calendar: converting to UTC would shift it for half the planet.
    return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new YouTubeArgumentError(`"${value}" is not a date in YYYY-MM-DD format.`);
  return value;
}

function filterString(filters: string | Record<string, string | readonly string[]> | undefined): string | undefined {
  if (filters === undefined || typeof filters === "string") return filters;
  const parts = Object.entries(filters).map(([name, value]) => `${name}==${typeof value === "string" ? value : value.join(",")}`);
  return parts.length ? parts.join(";") : undefined;
}

/**
 * `yt.analytics`: the YouTube Analytics API. Needs OAuth with the
 * `yt-analytics.readonly` scope (`yt-analytics-monetary.readonly` for revenue).
 */
export class Analytics {
  /** Custom groups of videos, playlists, channels or assets to report on as one. */
  readonly groups: AnalyticsGroupsApi;
  /** The items of those groups. */
  readonly groupItems: AnalyticsGroupItemsApi;
  readonly #rest: Rest;

  /** @internal */
  constructor(rest: Rest) {
    this.#rest = rest;
    this.groups = new AnalyticsGroupsApi(rest);
    this.groupItems = new AnalyticsGroupItemsApi(rest);
  }

  /**
   * Runs a report. Rows come back as objects keyed by the metrics and
   * dimensions you asked for, with metrics already converted to numbers.
   *
   * Not every combination of metrics and dimensions exists: the API answers
   * 400 for one it does not support. The valid ones are listed in the
   * channel reports reference.
   *
   * @example
   * const report = await yt.analytics.query({
   *   startDate: "2026-01-01",
   *   endDate: "2026-01-31",
   *   metrics: ["views", "estimatedMinutesWatched", "subscribersGained"],
   *   dimensions: "day",
   *   sort: "day",
   * });
   * for (const row of report.rows) console.log(row.day, row.views, row.estimatedMinutesWatched);
   *
   * // Top 10 videos of the year in France
   * const top = await yt.analytics.query({
   *   startDate: "2026-01-01",
   *   endDate: "2026-12-31",
   *   metrics: ["views", "likes"],
   *   dimensions: "video",
   *   filters: { country: "FR" },
   *   sort: "-views",
   *   maxResults: 10,
   * });
   * @see https://developers.google.com/youtube/analytics/channel_reports
   */
  async query<M extends AnalyticsMetric, D extends AnalyticsDimension = never>(query: AnalyticsQuery<M, D>, options?: RequestOptions): Promise<AnalyticsReport<M, D>> {
    const raw = await this.#rest.request<AnalyticsQueryResponse>(
      METHODS["analytics.reports.query"],
      {
        ids: query.ids ?? "channel==MINE",
        startDate: day(query.startDate),
        endDate: day(query.endDate),
        metrics: query.metrics,
        dimensions: query.dimensions,
        filters: filterString(query.filters),
        sort: query.sort,
        maxResults: query.maxResults,
        startIndex: query.startIndex,
        currency: query.currency,
        includeHistoricalChannelData: query.includeHistoricalChannelData,
      },
      options,
    );
    const columns = (raw.columnHeaders ?? []).map((header) => ({
      name: header.name ?? "",
      type: (header.columnType === "DIMENSION" ? "DIMENSION" : "METRIC") as "DIMENSION" | "METRIC",
      dataType: header.dataType ?? "STRING",
    }));
    const rows = (raw.rows ?? []).map((row) => {
      const out: Record<string, string | number> = {};
      columns.forEach((column, index) => {
        const value = row[index];
        out[column.name] = column.type === "METRIC" ? Number(value) : String(value);
      });
      return out as { [K in D]: string } & { [K in M]: number };
    });
    return { rows, columns, raw };
  }
}
