import type { Context } from "../context/context.js";
import { ANY, type Dispatch, type Layer, type Next } from "./types.js";

export function createDispatch(layers: Layer[]): Dispatch {
  const dispatch: Dispatch = (ctx, path, base, baseParams, tail) => {
    const setParams = (params: Record<string, string>) => {
      (ctx as Context & { params: Map<string, string> }).params = new Map(
        Object.entries(params),
      );
    };

    const run = async (i: number): Promise<Response | undefined> => {
      for (; i < layers.length; i++) {
        const l = layers[i];
        if (
          l.method &&
          l.method !== "*" &&
          l.method !== ctx.method &&
          !(l.method === "GET" && ctx.method === "HEAD")
        )
          continue;
        const m = l.pattern.exec(path);
        if (!m) continue;

        const params: Record<string, string> = { ...baseParams };
        try {
          l.keys.forEach((k, idx) => {
            if (m[idx + 1] !== undefined)
              params[k] = decodeURIComponent(m[idx + 1]);
          });
        } catch (error) {
          if (error instanceof URIError)
            return new Response("Bad Request", { status: 400 });
          throw error;
        }

        if (l.staticHandler) {
          const consumed = l.pattern === ANY ? 0 : m[0].length;
          let rest = path.slice(consumed);
          if (!rest.startsWith("/")) rest = "/" + rest;
          ctx.pathname = rest;
          ctx.basePath = base + path.slice(0, consumed);
          setParams(params);
          const out = await l.staticHandler();
          if (out instanceof Response) return out;
          continue;
        }

        const enter = () => {
          ctx.pathname = path;
          ctx.basePath = base;
          setParams(params);
        };

        const idx = i;
        let downstream: Promise<Response | undefined> | undefined;
        const next: Next = () => (downstream ??= run(idx + 1).finally(enter));

        if (l.mount) {
          const consumed = l.pattern === ANY ? 0 : m[0].length;
          let rest = path.slice(consumed);
          if (!rest.startsWith("/")) rest = "/" + rest;
          return l.mount(
            ctx,
            rest,
            base + path.slice(0, consumed),
            params,
            next,
          );
        }

        enter();
        const out = await l.handler!(next);
        if (out instanceof Response) return out;
        if (downstream) return downstream;
        return undefined;
      }
      return tail();
    };
    return run(0);
  };
  return dispatch;
}
