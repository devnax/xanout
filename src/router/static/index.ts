import { currentContext } from "../../context/store.js";
import type { StaticConfig, StaticHandler } from "../types.js";
import { cacheControlHeader } from "./cache-control.js";
import { serveFile } from "./serve-file.js";

/**
 * Build a static handler that serves files from `options.dir`. It reads the request path from the
 * context (relative to the path it is mounted at) and returns undefined when it has no file for it.
 */
export function createStatic(options: StaticConfig): StaticHandler {
  if (!options || typeof options.dir !== "string" || options.dir === "")
    throw new TypeError(
      "static(path, config): config.dir (the directory to serve) is required",
    );
  const dir = options.dir;
  const index = options.index === undefined ? "index.html" : options.index;
  const cacheControl = cacheControlHeader(options);

  return () =>
    serveFile(
      { dir, index, dotfiles: options.dotfiles, cacheControl },
      currentContext(),
    );
}
