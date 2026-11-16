import { AsyncLocalStorage } from "node:async_hooks";
import type { Context } from "./context.js";

// Request-scoped context. xanout is server-only: it relies on AsyncLocalStorage
// (Node, Bun, Deno, Cloudflare Workers with nodejs_compat).
// const store = new AsyncLocalStorage<Context>();
const KEY = Symbol.for("xanix.server-context");

const stores = globalThis as typeof globalThis & Record<symbol, unknown>;
const contextStorage =
  (stores[KEY] as AsyncLocalStorage<Context> | undefined) ??
  (stores[KEY] = new AsyncLocalStorage<Context>());

/** Run `fn` with `ctx` as the current request context. */
export function runInContext<R>(ctx: Context, fn: () => R): R {
  return contextStorage.run(ctx, fn);
}

/** The context of the request currently being handled. Throws outside a request. */
export function currentContext(): Context {
  const c = contextStorage.getStore();
  if (!c) throw new Error("route.context() called outside of a request");
  return c;
}
