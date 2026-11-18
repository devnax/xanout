import { StaticConfig } from "../types.js";

export function cacheControlHeader(options: StaticConfig): string {
  const cc: string[] = [];
  if (options.noStore) cc.push("no-store");
  else {
    cc.push(options.visibility ?? "public");
    if (options.noCache) cc.push("no-cache");
    cc.push(`max-age=${options.maxAge ?? 0}`);
    if (options.sMaxAge !== undefined) cc.push(`s-maxage=${options.sMaxAge}`);
    if (options.staleWhileRevalidate !== undefined)
      cc.push(`stale-while-revalidate=${options.staleWhileRevalidate}`);
    if (options.mustRevalidate) cc.push("must-revalidate");
    if (options.immutable) cc.push("immutable");
  }
  return cc.join(", ");
}
