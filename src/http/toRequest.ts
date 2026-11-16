import { Readable } from "node:stream";
import type { IncomingMessage } from "node:http";
import { isWebRequest } from "../shared/utils.js";

export interface ToRequestOptions {
  /** Override the request origin. */
  baseUrl?: string;
  /** Trust the first X-Forwarded-Proto and X-Forwarded-Host values. */
  trustProxy?: boolean;
}

type Bag = Record<string, unknown>;

const isObject = (value: unknown): value is Bag =>
  value !== null && typeof value === "object";

function read(value: unknown, key: string): unknown {
  if (!isObject(value)) return undefined;
  try {
    return value[key];
  } catch {
    return undefined;
  }
}

function firstString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === "string" && value !== "") return value.trim();
  }
  return undefined;
}

function firstForwarded(value: string | null): string | undefined {
  return value?.split(",", 1)[0].trim() || undefined;
}

function requestHeaders(source: unknown): Headers {
  const headers = new Headers();
  const raw = read(source, "headers");
  if (!isObject(raw)) return headers;

  for (const [name, value] of Object.entries(raw)) {
    if (name.startsWith(":") || value === undefined || value === null) continue;
    const values = Array.isArray(value) ? value : [value];
    for (const item of values) {
      try {
        headers.append(name, String(item));
      } catch {
        // Node permits header names that Fetch Headers rejects; skip those entries.
      }
    }
  }
  return headers;
}

function validHost(value: string | undefined): string | undefined {
  if (!value || /[\s/?#@\\]/.test(value)) return undefined;
  try {
    const parsed = new URL(`http://${value}`);
    if (
      parsed.pathname !== "/" ||
      parsed.search ||
      parsed.hash ||
      parsed.username ||
      parsed.password
    )
      return undefined;
    return parsed.host;
  } catch {
    return undefined;
  }
}

function originFor(
  outer: unknown,
  source: unknown,
  headers: Headers,
  options: ToRequestOptions,
): string {
  if (options.baseUrl !== undefined) {
    const base = new URL(options.baseUrl);
    if (base.protocol !== "http:" && base.protocol !== "https:")
      throw new TypeError("baseUrl must use HTTP or HTTPS");
    return base.origin;
  }

  const forwardedProto = options.trustProxy
    ? firstForwarded(headers.get("x-forwarded-proto") ?? null)
    : null;
  const protocolCandidate =
    firstString(
      forwardedProto,
      read(outer, "protocol"),
      read(source, "protocol"),
    ) ?? (read(read(source, "socket"), "encrypted") ? "https" : "http");
  const protocol =
    protocolCandidate.replace(/:$/, "").toLowerCase() === "https"
      ? "https"
      : "http";
  const hostCandidate =
    (options.trustProxy
      ? firstForwarded(headers.get("x-forwarded-host"))
      : undefined) ??
    firstString(
      read(outer, "host"),
      read(source, "host"),
      read(read(source, "headers"), ":authority"),
      headers.get("host"),
    );
  const host = validHost(hostCandidate) ?? "localhost";
  return `${protocol}://${host}`;
}

function requestUrl(outer: unknown, source: unknown, origin: string): URL {
  const absolute = firstString(read(outer, "url"), read(source, "url"));
  const original = firstString(
    read(outer, "originalUrl"),
    read(source, "originalUrl"),
  );
  let path = original ?? absolute ?? "/";

  if (/^https?:\/\//i.test(path)) {
    const parsed = new URL(path);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:")
      throw new TypeError("Unsupported request URL protocol");
    return parsed;
  }
  if (path === "*") path = "/";
  if (!path.startsWith("/")) path = `/${path}`;
  return new URL(`${origin}${path}`);
}

function nodeRequest(value: unknown):
  | {
      outer: unknown;
      source: IncomingMessage;
    }
  | undefined {
  const raw =
    read(value, "raw") ??
    read(value, "req") ??
    read(read(value, "node"), "req") ??
    value;
  if (
    isObject(raw) &&
    typeof read(raw, "method") === "string" &&
    isObject(read(raw, "headers")) &&
    typeof read(raw, "on") === "function"
  )
    return { outer: value, source: raw as unknown as IncomingMessage };
  return undefined;
}

function formBody(value: unknown): string {
  const params = new URLSearchParams();
  const append = (key: string, item: unknown) => {
    if (Array.isArray(item)) {
      for (const entry of item) append(key, entry);
    } else if (item !== undefined) {
      params.append(
        key,
        item !== null && typeof item === "object"
          ? JSON.stringify(item)
          : String(item),
      );
    }
  };
  if (isObject(value))
    for (const [key, item] of Object.entries(value)) append(key, item);
  return params.toString();
}

function parsedBody(
  value: unknown,
  rawBody: unknown,
  contentType: string | null,
): BodyInit | null {
  const body = rawBody ?? value;
  if (body === undefined || body === null) return null;
  if (typeof body === "string") return body;
  if (body instanceof Uint8Array) {
    const copy = new Uint8Array(body.byteLength);
    copy.set(body);
    return copy.buffer;
  }
  if (typeof body === "object") {
    if (
      /^application\/x-www-form-urlencoded(?:\s*;|$)/i.test(contentType ?? "")
    )
      return formBody(body);
    if (/^application\/(?:[\w.-]+\+)?json(?:\s*;|$)/i.test(contentType ?? ""))
      return JSON.stringify(body);
    return null;
  }
  return String(body);
}

function streamedBody(source: IncomingMessage): ReadableStream<Uint8Array> {
  const normalized = Readable.from(
    (async function* () {
      for await (const chunk of source) {
        if (typeof chunk === "string") yield Buffer.from(chunk);
        else if (chunk instanceof Uint8Array) yield chunk;
        else yield Buffer.from(String(chunk));
      }
    })(),
  );
  return Readable.toWeb(normalized) as ReadableStream<Uint8Array>;
}

/**
 * Convert a Node-style request or framework context to a Fetch Request. Existing Fetch requests
 * (including supported framework wrappers) are returned unchanged.
 */
export function toRequest(
  input: unknown,
  options: ToRequestOptions = {},
): Request {
  if (isWebRequest(input)) return input;
  for (const candidate of [
    read(read(input, "req"), "raw"),
    read(input, "request"),
    read(input, "req"),
  ]) {
    if (isWebRequest(candidate)) return candidate;
  }

  const found = nodeRequest(input);
  if (!found)
    throw new TypeError(
      "toRequest() expects a Request or a Node-style request",
    );

  const { outer, source } = found;
  const headers = requestHeaders(source);
  const origin = originFor(outer, source, headers, options);
  let url: URL;
  if (options.baseUrl) {
    let path =
      firstString(
        read(outer, "originalUrl"),
        read(outer, "url"),
        read(source, "originalUrl"),
        read(source, "url"),
      ) ?? "/";
    if (/^https?:\/\//i.test(path)) {
      const absolute = new URL(path);
      path = absolute.pathname + absolute.search;
    }
    url = requestUrl({ url: path }, undefined, origin);
  } else {
    url = requestUrl(outer, source, origin);
  }
  const method = (
    firstString(read(outer, "method"), read(source, "method")) ?? "GET"
  ).toUpperCase();
  const init: RequestInit & { duplex?: "half" } = { method, headers };

  if (method !== "GET" && method !== "HEAD") {
    if (read(source, "readableEnded") === true) {
      const requestBody =
        read(outer, "rawBody") ??
        read(outer, "body") ??
        read(read(outer, "request"), "body") ??
        read(source, "rawBody") ??
        read(source, "body");
      const body = parsedBody(
        requestBody,
        undefined,
        headers.get("content-type"),
      );
      if (body !== null) {
        init.body = body;
        init.duplex = "half";
        headers.delete("content-length");
        headers.delete("content-encoding");
        headers.delete("transfer-encoding");
      }
    } else {
      init.body = streamedBody(source);
      init.duplex = "half";
    }
  }

  return new Request(url, init);
}
