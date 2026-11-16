import type { Context } from "../context/context.js";
import type {
  Handler,
  Next,
  StaticConfig,
  StaticHandler,
} from "../shared/types.js";

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

export interface RouterInstance {
  /** Middleware, or mount another Router at the root. */
  use(handler: Handler | RouterInstance): RouterInstance;
  /** Middleware for a path prefix, or mount another Router under it (prefix is stripped for the sub-router). */
  use(path: string, handler: Handler | RouterInstance): RouterInstance;
  get(path: string, handler: Handler | RouterInstance): RouterInstance;
  post(path: string, handler: Handler | RouterInstance): RouterInstance;
  put(path: string, handler: Handler | RouterInstance): RouterInstance;
  patch(path: string, handler: Handler | RouterInstance): RouterInstance;
  delete(path: string, handler: Handler | RouterInstance): RouterInstance;
  head(path: string, handler: Handler | RouterInstance): RouterInstance;
  options(path: string, handler: Handler | RouterInstance): RouterInstance;
  all(path: string, handler: Handler | RouterInstance): RouterInstance;
  /** Serve the files in `config.dir` at a URL path ("/" for the root). */
  static(path: string, config: StaticConfig): RouterInstance;
  /** Custom static handler at a URL path. Return a Response, or undefined to continue. No `next`. */
  static(path: string, handler: StaticHandler): RouterInstance;
  /** Custom static handler for every path. Return a Response, or undefined to continue. No `next`. */
  static(handler: StaticHandler): RouterInstance;
  /** Context of the request currently being handled (safe under concurrency). */
  context(): Context;
  /**
   * Handle a request. Resolves to a web Response, or to undefined when nothing handled it.
   * Takes a web Request only. For a Node-style request (http, Express, Fastify, Koa, ...) convert
   * it first with `toRequest(req)`. Throws a TypeError for anything that isn't a web Request.
   */
  fetch(request: Request): Promise<Response | undefined>;
}
