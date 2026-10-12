import { YouTubeArgumentError } from "./errors.js";

/**
 * A length of time: milliseconds as a number, or a short string such as
 * `"30s"`, `"5m"`, `"2h"` or `"1d"`.
 */
export type Duration = number | `${number}${"ms" | "s" | "m" | "h" | "d"}`;

const UNITS: Record<string, number> = { ms: 1, s: 1_000, m: 60_000, h: 3_600_000, d: 86_400_000 };

/** Converts a {@link Duration} to milliseconds. */
export function toMs(value: Duration): number {
  if (typeof value === "number") {
    if (!Number.isFinite(value) || value < 0) throw new YouTubeArgumentError(`Invalid duration: ${value}`);
    return value;
  }
  const match = /^(\d+(?:\.\d+)?)(ms|s|m|h|d)$/.exec(value);
  if (!match) throw new YouTubeArgumentError(`Invalid duration "${value}". Use milliseconds or a string like "30s", "5m", "2h".`);
  return Number(match[1]) * UNITS[match[2]!]!;
}

/** Resolves after `ms` milliseconds, or rejects as soon as `signal` aborts. */
export function sleep(ms: number, signal?: AbortSignal | null): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason);
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal!.reason);
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}
