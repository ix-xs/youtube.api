import { YouTubeArgumentError } from "../core/errors.js";

const ISO_DURATION = /^P(?:(\d+(?:\.\d+)?)W)?(?:(\d+(?:\.\d+)?)D)?(?:T(?:(\d+(?:\.\d+)?)H)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)S)?)?$/;

/**
 * Converts an ISO 8601 duration, the format of `contentDetails.duration`, to
 * seconds. A live stream that has not ended reports `P0D`, which gives 0.
 *
 * @example
 * parseDuration("PT1H2M3S"); // 3723
 * parseDuration("PT45S");    // 45
 */
export function parseDuration(iso: string): number {
  // The form `videos.batchGetStats` uses: a number of seconds and an "s".
  const plain = /^(\d+(?:\.\d+)?)s$/.exec(iso);
  if (plain) return Number(plain[1]);
  const match = ISO_DURATION.exec(iso);
  if (!match || iso === "P" || iso === "PT") throw new YouTubeArgumentError(`"${iso}" is not an ISO 8601 duration such as "PT4M13S".`);
  const [, weeks, days, hours, minutes, secs] = match;
  return Number(weeks ?? 0) * 604_800 + Number(days ?? 0) * 86_400 + Number(hours ?? 0) * 3_600 + Number(minutes ?? 0) * 60 + Number(secs ?? 0);
}

/**
 * Formats a duration for display. Takes seconds or an ISO 8601 duration.
 *
 * - `"clock"` (default): `1:02:03`, `4:13`, `0:45`
 * - `"short"`: `1h 2m 3s`
 *
 * @example
 * formatDuration("PT1H2M3S");       // "1:02:03"
 * formatDuration(253);              // "4:13"
 * formatDuration("PT4M13S", "short"); // "4m 13s"
 */
export function formatDuration(duration: number | string, style: "clock" | "short" = "clock"): string {
  const total = Math.max(0, Math.floor(typeof duration === "string" ? parseDuration(duration) : duration));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  if (style === "short") {
    const parts = [hours && `${hours}h`, minutes && `${minutes}m`, (seconds || (!hours && !minutes)) && `${seconds}s`].filter(Boolean);
    return parts.join(" ");
  }
  const two = (value: number) => String(value).padStart(2, "0");
  return hours ? `${hours}:${two(minutes)}:${two(seconds)}` : `${minutes}:${two(seconds)}`;
}

/**
 * Formats a count the way YouTube shows it: `1.2M`, `34.1K`. Statistics come
 * back from the API as strings, so those are accepted as is.
 *
 * @example
 * formatCount("1234567");    // "1.2M"
 * formatCount(34_100);       // "34.1K"
 * formatCount(34_100, "fr"); // the same in French: 34,1 k, with the spacing French uses
 */
export function formatCount(count: number | string, locale: string | string[] = "en"): string {
  const value = Number(count);
  if (!Number.isFinite(value)) throw new YouTubeArgumentError(`"${count}" is not a number.`);
  return new Intl.NumberFormat(locale, { notation: "compact", maximumFractionDigits: 1 }).format(value);
}

/** Shape shared by the API's thumbnail objects. */
interface ThumbnailLike {
  url: string;
  width?: number;
  height?: number;
}

/** A `snippet.thumbnails` object: one image per size, any of them possibly missing. */
type ThumbnailSet<T extends ThumbnailLike> = { [K in "default" | "medium" | "high" | "standard" | "maxres" | "fhd" | "qhd" | "uhd"]?: T };

const THUMBNAIL_ORDER = ["uhd", "qhd", "fhd", "maxres", "standard", "high", "medium", "default"];

/**
 * Picks the largest thumbnail of a `snippet.thumbnails` object. Returns
 * `undefined` when there is none, which happens for deleted or private videos
 * in a playlist.
 *
 * @example
 * const image = bestThumbnail(video.snippet.thumbnails)?.url;
 */
export function bestThumbnail<T extends ThumbnailLike>(thumbnails: ThumbnailSet<T> | undefined | null): T | undefined {
  if (!thumbnails) return undefined;
  let best: T | undefined;
  for (const candidate of Object.values(thumbnails) as Array<T | undefined>) {
    if (candidate?.url && (candidate.width ?? 0) > (best?.width ?? 0)) best = candidate;
  }
  if (best) return best;
  for (const key of THUMBNAIL_ORDER) {
    const candidate = (thumbnails as Record<string, T | undefined>)[key];
    if (candidate?.url) return candidate;
  }
  return undefined;
}

/**
 * Ids of the video categories. They are the same in every region; only their
 * availability differs, which `videoCategories.list` tells.
 *
 * @example
 * yt.videos.list({ part: "snippet", chart: "mostPopular", videoCategoryId: VideoCategories.Gaming });
 */
export const VideoCategories = Object.freeze({
  FilmAndAnimation: "1",
  AutosAndVehicles: "2",
  Music: "10",
  PetsAndAnimals: "15",
  Sports: "17",
  TravelAndEvents: "19",
  Gaming: "20",
  PeopleAndBlogs: "22",
  Comedy: "23",
  Entertainment: "24",
  NewsAndPolitics: "25",
  HowtoAndStyle: "26",
  Education: "27",
  ScienceAndTechnology: "28",
  NonprofitsAndActivism: "29",
} as const);
