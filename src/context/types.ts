export interface HeaderJar {
  /** Request header (null when absent). */
  get(name: string): string | null;
  /** Whether the request has the header. */
  has(name: string): boolean;
  /** All request headers (names lower-cased). */
  all(): Record<string, string>;
  /** Set a response header. It wins over the same header set by the handler's own Response. */
  set(name: string, value: string): HeaderJar;
  /** Add a response header value (e.g. several `Vary` values). */
  append(name: string, value: string): HeaderJar;
  /** Remove a response header set earlier with `set`/`append`. */
  delete(name: string): HeaderJar;
}
