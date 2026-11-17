import type { HeaderJar } from "../shared/types.js";

export type HeaderJarInternal = HeaderJar & {
  /** Response headers queued during this request (internal). */
  _out(): Headers;
};

/** `get`/`has`/`all` read the request headers; `set`/`append`/`delete` change the response headers. */
export function createHeaders(request: Headers): HeaderJarInternal {
  const out = new Headers();
  const jar: HeaderJarInternal = {
    get: (name) => request.get(name),
    has: (name) => request.has(name),
    all: () => {
      const all: Record<string, string> = {};
      request.forEach((v, k) => (all[k] = v));
      return all;
    },
    set: (name, value) => (out.set(name, value), jar),
    append: (name, value) => (out.append(name, value), jar),
    delete: (name) => (out.delete(name), jar),
    _out: () => out,
  };
  return jar;
}
