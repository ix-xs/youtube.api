import { ListRequest } from "./pagination.js";
import type { MethodSpec, RequestOptions, Rest } from "./rest.js";

/** Flattens an intersection so editors show the final shape. */
export type Simplify<T> = { [K in keyof T]: T[K] } & {};

/**
 * Narrows a resource to the parts that were requested.
 *
 * - `kind`, `etag` and `id` are always there.
 * - A requested part the API always returns becomes required.
 * - A requested part the API may leave out (for example
 *   `liveStreamingDetails` on a regular video) stays optional.
 * - Parts that were not requested are absent from the type, so reading them is
 *   a compile error instead of an `undefined` at runtime.
 *
 * Without a part list, the full resource with every part optional is returned.
 *
 * @typeParam T - The full resource.
 * @typeParam Part - Every part name of the resource.
 * @typeParam P - Parts that were requested.
 * @typeParam Always - Parts the API returns whenever they are requested.
 */
export type WithParts<T, Part extends keyof T, P extends Part, Always extends Part> = [P] extends [never]
  ? T
  : Simplify<
      { [K in Extract<keyof T, "kind" | "etag" | "id">]-?: NonNullable<T[K]> } & {
        [K in Exclude<Extract<P, Always>, "id">]-?: NonNullable<T[K]>;
      } & { [K in Exclude<P, Always | "id">]?: T[K] }
    >;

/**
 * A resource the API just created or updated: its `kind`, `etag` and `id` are
 * known, every part stays optional. This is what a write returns when it was
 * called without an explicit `part`.
 */
export type Identified<T> = Simplify<{ [K in Extract<keyof T, "kind" | "etag" | "id">]-?: NonNullable<T[K]> } & Omit<T, "kind" | "etag" | "id">>;

/** A request body: the resource with every field optional, at any depth. */
export type Body<T> = T extends (infer U)[]
  ? Body<U>[]
  : T extends object
    ? { [K in keyof T]?: Body<T[K]> }
    : T;

/** One value or a list of them. */
export type OneOrMany<T> = T | readonly T[];

/** Parameters shared by the methods YouTube content partners can call for a content owner. */
export interface OnBehalfOfContentOwner {
  /**
   * For YouTube content partners only. Runs the request on behalf of this
   * content owner. The authenticated CMS account must be linked to it.
   */
  onBehalfOfContentOwner?: string;
}

/** Same as {@link OnBehalfOfContentOwner}, plus the channel the request applies to. */
export interface OnBehalfOfContentOwnerChannel extends OnBehalfOfContentOwner {
  /**
   * For YouTube content partners only. Channel the request acts on, among the
   * channels linked to `onBehalfOfContentOwner`. Both parameters go together.
   */
  onBehalfOfContentOwnerChannel?: string;
}

type Params = Record<string, unknown>;

/**
 * Base class of every resource (`yt.videos`, `yt.channels`, and so on).
 *
 * @internal
 */
export abstract class ResourceBase {
  /** @internal */
  protected readonly rest: Rest;

  /** @internal */
  constructor(rest: Rest) {
    this.rest = rest;
  }

  /** @internal */
  protected _call<T>(spec: MethodSpec, params: object | undefined, options?: RequestOptions): Promise<T> {
    const input = (params as Params | undefined) ?? {};
    return this.rest.request<T>(spec, spec.autoPart ? withDefaultPart(input) : input, options);
  }

  /** @internal */
  protected _list<T, R>(spec: MethodSpec, params: object | (() => Promise<object>) | undefined, options?: RequestOptions, fullPages = false): ListRequest<T, R> {
    const input = typeof params === "function" ? (params as () => Promise<Params>) : { ...(params as Params | undefined) };
    return new ListRequest<T, R>(this.rest, spec, input, options, fullPages);
  }
}

const NOT_PARTS = new Set(["kind", "etag", "id"]);

/** A write without `part` sends the parts found in its body. */
function withDefaultPart(params: Params): Params {
  if (params.part !== undefined || typeof params.body !== "object" || params.body === null) return params;
  const part = Object.keys(params.body).filter((key) => !NOT_PARTS.has(key));
  return { ...params, part: part.length ? part : ["id"] };
}
