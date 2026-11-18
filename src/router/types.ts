import type { Context } from "../context/context.js";

export type Method =
  | "GET"
  | "POST"
  | "PUT"
  | "PATCH"
  | "DELETE"
  | "HEAD"
  | "OPTIONS";

export type Next = () => Promise<Response | undefined>;

/** A status code, or a full ResponseInit (status, statusText, headers). */
export type ReplyInit = number | ResponseInit;

type Result =
  | Response
  | void
  | undefined
  | Promise<Response | void | undefined>;

export type Handler = (next: Next) => Result;

/** Options for `route.static(path, config)`. */
export interface StaticConfig {
  /** Directory to serve files from. */
  dir: string;
  /** Index file for directories (default "index.html"; false disables). */
  index?: string | false;
  /** Cache-Control max-age in seconds (default 0). */
  maxAge?: number;
  /** Cache-Control s-maxage in seconds (shared caches / CDNs). */
  sMaxAge?: number;
  /** Add "immutable": file never changes, skip revalidation (use with hashed filenames). */
  immutable?: boolean;
  /** "public" (default) or "private". */
  visibility?: "public" | "private";
  /** Add "no-cache": store, but revalidate every time. */
  noCache?: boolean;
  /** Send only "no-store": never cache. Overrides every other cache option. */
  noStore?: boolean;
  /** Add "must-revalidate". */
  mustRevalidate?: boolean;
  /** Add "stale-while-revalidate=<seconds>". */
  staleWhileRevalidate?: number;
  /** Serve files/folders starting with "." (default false). */
  dotfiles?: boolean;
}

/**
 * A custom static handler. There is no `next`: return a Response to serve the request, or
 * undefined to let it continue to middleware and routes. Read the request with `route.context()`;
 * `ctx.pathname` is relative to the path the handler is mounted at.
 */
export type StaticHandler = () => Result;

export interface Layer {
  method: string | null;
  keys: string[];
  pattern: RegExp;
  handler?: Handler;
  staticHandler?: StaticHandler;
  mount?: Dispatch;
}

export type Dispatch = (
  ctx: Context,
  path: string,
  base: string,
  baseParams: Record<string, string>,
  tail: Next,
) => Promise<Response | undefined>;

export const DISPATCH = Symbol.for("xanout.dispatch");
export const ANY = /^\/?.*$/;

export interface Router {
  /** Middleware, or mount another Router at the root. */
  use(handler: Handler | Router): Router;
  /** Middleware for a path prefix, or mount a Router under it (prefix is stripped for the sub-router). */
  use(path: string, handler: Handler | Router): Router;
  get(path: string, handler: Handler | Router): Router;
  post(path: string, handler: Handler | Router): Router;
  put(path: string, handler: Handler | Router): Router;
  patch(path: string, handler: Handler | Router): Router;
  delete(path: string, handler: Handler | Router): Router;
  head(path: string, handler: Handler | Router): Router;
  options(path: string, handler: Handler | Router): Router;
  all(path: string, handler: Handler | Router): Router;
  /** Serve the files in `config.dir` at a URL path ("/" for the root). */
  static(path: string, config: StaticConfig): Router;
  /** Custom static handler at a URL path. Return a Response, or undefined to continue. No `next`. */
  static(path: string, handler: StaticHandler): Router;
  /** Custom static handler for every path. Return a Response, or undefined to continue. No `next`. */
  static(handler: StaticHandler): Router;
  /** Context of the request currently being handled (safe under concurrency). */
  context(): Context;
  /**
   * Handle a request. Resolves to a web Response, or to undefined when nothing handled it.
   * Accepts a web Request or any Node-style / framework request that `toRequest` understands
   * (Express, Fastify, Koa, Hono, ...).
   */
  fetch(request: Request): Promise<Response | undefined>;
}
