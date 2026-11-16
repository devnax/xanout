import { parse } from "regexparam";
import { Context } from "../context/context.js";
import { currentContext, runInContext } from "../context/store.js";
import { createStatic } from "../static/index.js";
import type { Handler, StaticConfig, StaticHandler } from "../shared/types.js";
import { isWebRequest } from "../shared/utils.js";
import { createDispatch } from "./dispatch.js";
import {
  ANY,
  DISPATCH,
  type Dispatch,
  type Layer,
  type RouterInstance,
} from "./types.js";

export interface Router extends RouterInstance {}

export function Router(): Router {
  const layers: Layer[] = [];
  // Order of calls: static first, then use, then everything else.
  // layers: [static | middleware | use-mounted routers | routes]
  let staticCount = 0;
  let middlewareCount = 0;
  let mountCount = 0;

  const add = (
    method: string | null,
    path: string | null,
    handler: Handler | Router,
    loose: boolean,
  ) => {
    const mount: Dispatch | undefined =
      typeof handler === "function" ? undefined : (handler as any)?.[DISPATCH];
    if (typeof handler !== "function" && typeof mount !== "function") {
      throw new TypeError("Expected a handler function or a Router");
    }
    if (handler === (router as unknown))
      throw new Error("A router cannot be mounted on itself");
    const h = typeof handler === "function" ? handler : undefined;
    let layer: Layer;
    if (path === null) {
      layer = { method, keys: [], pattern: ANY, handler: h, mount };
    } else {
      // a mounted Router matches by prefix
      const { keys, pattern } = parse(path, loose || !!mount);
      layer = { method, keys, pattern, handler: h, mount };
    }
    // After static layers, use() always runs before routes, wherever it is declared:
    //   2. middleware: use(fn) / use(path, fn)
    //   3. mounted routers: use(router) / use(path, router)
    //   4. routes: get / post / ... / all, and verb-mounted routers
    // Each group keeps declaration order.
    if (method === null && h)
      layers.splice(staticCount + middlewareCount++, 0, layer);
    else if (method === null)
      layers.splice(staticCount + middlewareCount + mountCount++, 0, layer);
    else layers.push(layer);
  };

  const router = {} as Router;

  router.use = ((a: string | Handler | Router, b?: Handler | Router) => {
    typeof a === "string"
      ? add(null, a, b as Handler | Router, true)
      : add(null, null, a, true);
    return router;
  }) as Router["use"];

  const verb = (m: string) => (path: string, handler: Handler | Router) => {
    add(m, path, handler, false);
    return router;
  };
  router.get = verb("GET");
  router.post = verb("POST");
  router.put = verb("PUT");
  router.patch = verb("PATCH");
  router.delete = verb("DELETE");
  router.head = verb("HEAD");
  router.options = verb("OPTIONS");
  router.all = (path, handler) => (add("*", path, handler, false), router);

  // static(path, config) | static(path, handler) | static(handler)
  router.static = ((
    a: string | StaticHandler,
    b?: StaticConfig | StaticHandler,
  ) => {
    let path: string | null = null;
    let staticHandler: StaticHandler;
    if (typeof a === "function") {
      staticHandler = a;
    } else if (typeof a === "string") {
      if (typeof b === "function") staticHandler = b;
      else if (b && typeof b === "object") staticHandler = createStatic(b);
      else
        throw new TypeError(
          "static(path, ...) needs a config object ({ dir }) or a handler function",
        );
      const p = "/" + a.replace(/^\/+|\/+$/g, "");
      path = p === "/" ? null : p;
    } else {
      throw new TypeError(
        "static(...) takes (path, config), (path, handler) or (handler)",
      );
    }
    const { keys, pattern } =
      path === null
        ? { keys: [] as string[], pattern: ANY }
        : parse(path, true);
    // GET only (HEAD falls through to GET); static layers always come first
    layers.splice(staticCount++, 0, {
      method: "GET",
      keys,
      pattern,
      staticHandler,
    });
    return router;
  }) as Router["static"];

  router.context = currentContext;

  const dispatch = createDispatch(layers);
  (router as any)[DISPATCH] = dispatch;

  router.fetch = async (request) => {
    if (!isWebRequest(request))
      throw new TypeError(
        "xanout: fetch() takes a web Request. Convert Node-style requests with toRequest(req) first.",
      );
    const ctx = new Context(request);
    const pathname = ctx.pathname;
    try {
      return await runInContext(ctx, async () => {
        const res = await dispatch(
          ctx,
          pathname,
          "",
          {},
          async () => undefined,
        );
        return res ? ctx.finalize(res) : undefined;
      });
    } catch (err) {
      console.error(err);
      return new Response("Internal Server Error", { status: 500 });
    }
  };

  return router;
}
