import { parseCookie } from "./parse.js";
import { serializeCookie } from "./serialize.js";

/** Cookie helpers usable on their own, outside a router. */
export const Cookie = {
  parse: parseCookie,
  serialize: serializeCookie,
};

export { createCookies } from "./jar.js";
export type { CookieJar } from "./jar.js";
export { parseCookie } from "./parse.js";
export { serializeCookie } from "./serialize.js";
