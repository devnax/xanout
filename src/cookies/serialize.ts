import type { CookieOptions } from "./types.js";
const TOKEN = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;
const UNSAFE_ATTR = /[;\r\n]/;

/**
 * Build a `Set-Cookie` header value. The value is URL-encoded and `Path` defaults to "/".
 * Throws a TypeError for an invalid cookie name, or a path/domain containing `;` or a line break.
 */
export function serializeCookie(
  name: string,
  value: string,
  options: CookieOptions = {},
): string {
  if (!TOKEN.test(name))
    throw new TypeError(`Invalid cookie name: ${JSON.stringify(name)}`);
  const path = options.path ?? "/";
  if (
    UNSAFE_ATTR.test(path) ||
    (options.domain && UNSAFE_ATTR.test(options.domain))
  )
    throw new TypeError("Invalid cookie path/domain");
  let cookie = `${name}=${encodeURIComponent(value)}; Path=${path}`;
  if (options.domain) cookie += `; Domain=${options.domain}`;
  if (options.maxAge !== undefined)
    cookie += `; Max-Age=${Math.floor(options.maxAge)}`;
  if (options.expires) cookie += `; Expires=${options.expires.toUTCString()}`;
  if (options.httpOnly) cookie += "; HttpOnly";
  if (options.secure) cookie += "; Secure";
  if (options.sameSite)
    cookie += `; SameSite=${options.sameSite[0].toUpperCase()}${options.sameSite.slice(1)}`;
  if (options.partitioned) cookie += "; Partitioned";
  return cookie;
}
