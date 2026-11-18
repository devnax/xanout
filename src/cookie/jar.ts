import type { CookieOptions, Cookies } from "../shared/types.js";
import { parseCookie } from "./parse.js";
import { serializeCookie } from "./serialize.js";

export type CookieJar = Cookies & {
  /** Set-Cookie header values queued during this request (internal). */
  _out(): string[];
};

export function createCookies(header: string | null): CookieJar {
  let base: Record<string, string> | undefined;
  const read = () => (base ??= parseCookie(header));
  const view = new Map<string, string | undefined>();
  const out = new Map<string, string>();
  const key = (name: string, options: Pick<CookieOptions, "domain" | "path">) =>
    `${name};${options.domain ?? ""};${options.path ?? "/"}`;
  const jar: CookieJar = {
    get: (name) => (view.has(name) ? view.get(name) : read()[name]),
    has: (name) => jar.get(name) !== undefined,
    all: () => {
      const cookies = { ...read() };
      for (const [name, value] of view)
        value === undefined
          ? delete cookies[name]
          : (cookies[name] = value);
      return cookies;
    },
    set: (name, value, options = {}) => (
      out.set(key(name, options), serializeCookie(name, value, options)),
      view.set(name, value),
      jar
    ),
    delete: (name, options = {}) => (
      out.set(
        key(name, options),
        serializeCookie(name, "", {
          ...options,
          maxAge: 0,
          expires: new Date(0),
        }),
      ),
      view.set(name, undefined),
      jar
    ),
    _out: () => [...out.values()],
  };
  return jar;
}
