import { YouTubeArgumentError } from "./core/errors.js";
import type { RequestOptions, Rest } from "./core/rest.js";
import { METHODS } from "./generated/methods.js";
import { ReportingJobsApi, type ReportingReport, ReportingReportTypesApi, ReportingReportsApi } from "./generated/reporting.js";

/**
 * `yt.reporting`: the YouTube Reporting API, which delivers bulk reports as
 * daily CSV files. Schedule a job once, then collect its reports. Needs OAuth
 * with the `yt-analytics.readonly` scope.
 *
 * @example
 * const job = await yt.reporting.jobs.create({ body: { reportTypeId: "channel_basic_a3", name: "Channel basics" } });
 * // A day or two later:
 * for await (const report of yt.reporting.reports.list({ jobId: job.id! })) {
 *   const csv = await yt.reporting.download(report);
 * }
 */
export class Reporting {
  /** The report types your account can schedule. */
  readonly reportTypes: ReportingReportTypesApi;
  /** Scheduled reports. */
  readonly jobs: ReportingJobsApi;
  /** The files generated for a job. */
  readonly reports: ReportingReportsApi;
  readonly #rest: Rest;

  /** @internal */
  constructor(rest: Rest) {
    this.#rest = rest;
    this.reportTypes = new ReportingReportTypesApi(rest);
    this.jobs = new ReportingJobsApi(rest);
    this.reports = new ReportingReportsApi(rest);
  }

  #url(report: ReportingReport | string): string {
    const url = typeof report === "string" ? report : report.downloadUrl;
    if (!url) throw new YouTubeArgumentError("This report has no download URL.");
    const { protocol, hostname } = new URL(url);
    if (protocol !== "https:" || hostname !== "youtubereporting.googleapis.com") {
      // The access token goes with the request: never send it anywhere else, nor in the clear.
      throw new YouTubeArgumentError(`Refusing to download a report from "${protocol}//${hostname}": expected https://youtubereporting.googleapis.com.`);
    }
    return url;
  }

  /**
   * Downloads a report file and resolves to its CSV text. Takes a report or
   * its `downloadUrl`.
   *
   * @example
   * const csv = await yt.reporting.download(report);
   * const [header, ...lines] = csv.trim().split("\n");
   */
  async download(report: ReportingReport | string, options?: RequestOptions): Promise<string> {
    return (await this.downloadResponse(report, options)).text();
  }

  /**
   * Downloads a report file and resolves to the raw `Response`, to stream a
   * large file to disk instead of holding it in memory.
   *
   * @example
   * const response = await yt.reporting.downloadResponse(report);
   * await pipeline(Readable.fromWeb(response.body), createWriteStream("report.csv"));
   */
  downloadResponse(report: ReportingReport | string, options?: RequestOptions): Promise<Response> {
    return this.#rest.raw(METHODS["reporting.media.download"], {}, options, this.#url(report));
  }
}
