import { createCookies, type CookieJar } from "../cookies/index.js";
import { mergeIntoResponse } from "./finalize.js";
import { createHeaders, type HeaderJarInternal } from "./headers.js";
import { Cookies } from "../cookies/types.js";
import { HeaderJar } from "./types.js";
import { ReplyInit } from "../router/types.js";

const JSON_TYPE = "application/json; charset=utf-8";
const NO_BODY = new Set([204, 205, 304]);
const REDIRECTS = new Set([301, 302, 303, 307, 308]);

/** Everything about the request being handled. Get it anywhere with `route.context()`. */
export class Context {
  readonly request: Request;
  readonly method: string;
  readonly url: URL;
  readonly query: URLSearchParams;
  readonly states: Map<string, unknown> = new Map();
  readonly headers: HeaderJar;
  readonly cookies: Cookies;
  readonly params: Map<string, string> = new Map();
  readonly #jar: CookieJar;
  readonly #headers: HeaderJarInternal;
  pathname: string;
  basePath = "";

  constructor(request: Request) {
    this.request = request;
    this.method = request.method.toUpperCase();
    this.url = new URL(request.url);
    this.query = this.url.searchParams;
    this.pathname = this.url.pathname;
    this.#jar = createCookies(request.headers.get("cookie"));
    this.#headers = createHeaders(request.headers);
    this.cookies = this.#jar;
    this.headers = this.#headers;
  }

  /** JSON response. `init` is a status code or a ResponseInit. Default status 200. */
  json(data: unknown, init?: ReplyInit): Response {
    return this.#reply(JSON.stringify(data) ?? "null", JSON_TYPE, init);
  }

  /** Plain text response. */
  text(body: string, init?: ReplyInit): Response {
    return this.#reply(body, "text/plain; charset=utf-8", init);
  }

  /** HTML response. */
  html(body: string, init?: ReplyInit): Response {
    return this.#reply(body, "text/html; charset=utf-8", init);
  }

  /** Redirect to a path or URL. Status 301, 302 (default), 303, 307 or 308. */
  redirect(url: string | URL, status = 302): Response {
    if (!REDIRECTS.has(status))
      throw new RangeError(`Invalid redirect status: ${status}`);
    return new Response(null, {
      status,
      headers: { Location: String(url) },
    });
  }

  /** JSON `{ success: true, data }` (`data` is left out when undefined). Default status 200. */
  success(data?: unknown, init?: ReplyInit): Response {
    return this.json({ success: true, data }, init);
  }

  /** JSON `{ success: false, error: message }`. Default status 500. */
  error(message = "Internal Server Error", init?: ReplyInit): Response {
    return this.#reply(
      JSON.stringify({ success: false, error: message }),
      JSON_TYPE,
      init,
      500,
    );
  }

  /** @internal Merge `headers` and queued cookies into the final response. */
  finalize(res: Response): Response {
    return mergeIntoResponse(res, this.#headers._out(), this.#jar._out());
  }

  #reply(
    body: string,
    type: string,
    init?: ReplyInit,
    defaultStatus = 200,
  ): Response {
    const o: ResponseInit =
      typeof init === "number" ? { status: init } : { ...init };
    o.status ??= defaultStatus;
    const headers = new Headers(o.headers);
    if (!headers.has("content-type")) headers.set("content-type", type);
    o.headers = headers;
    return new Response(NO_BODY.has(o.status) ? null : body, o);
  }
}
