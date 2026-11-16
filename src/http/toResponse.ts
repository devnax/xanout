import type { ServerResponse } from "node:http";

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

type ResponseWriter = ServerResponse & {
  destroyed?: boolean;
  writableEnded?: boolean;
  getHeaders?: () => Record<string, number | string | string[]>;
};

function responseWriter(target: unknown): {
  writer: ResponseWriter;
  koa?: Bag;
  fastify?: Bag;
} {
  const raw = read(target, "raw");
  const koa =
    read(target, "res") && read(target, "request") ? target : undefined;
  const writer = (raw ?? (koa ? read(koa, "res") : target)) as ResponseWriter;
  if (
    !writer ||
    typeof writer.setHeader !== "function" ||
    typeof writer.write !== "function" ||
    typeof writer.end !== "function" ||
    typeof writer.once !== "function"
  )
    throw new TypeError(
      "toResponse() expects a Node response, Fastify reply, or Koa context",
    );
  return {
    writer,
    koa: isObject(koa) ? koa : undefined,
    fastify:
      raw && typeof read(target, "hijack") === "function" && isObject(target)
        ? target
        : undefined,
  };
}

function setHeaders(
  writer: ResponseWriter,
  response: Response,
  targetHeaders?: unknown,
): void {
  if (targetHeaders instanceof Headers) {
    targetHeaders.forEach((value, name) => {
      if (name !== "set-cookie") writer.setHeader(name, value);
    });
    const cookies = targetHeaders.getSetCookie();
    if (cookies.length) writer.setHeader("set-cookie", cookies);
  } else if (isObject(targetHeaders)) {
    for (const [name, value] of Object.entries(targetHeaders)) {
      try {
        writer.setHeader(name, value as string | number | readonly string[]);
      } catch {
        // Framework header objects can contain values not accepted by Node.
      }
    }
  }
  response.headers.forEach((value, name) => {
    if (name !== "set-cookie") writer.setHeader(name, value);
  });
  const cookies = response.headers.getSetCookie();
  if (cookies.length) {
    const existing = writer.getHeader("set-cookie");
    const existingCookies = Array.isArray(existing)
      ? existing
      : existing === undefined
        ? []
        : [String(existing)];
    writer.setHeader("set-cookie", [...existingCookies, ...cookies]);
  } else {
    const cookie = response.headers.get("set-cookie");
    if (cookie) writer.setHeader("set-cookie", cookie);
  }
}

function waitForDrain(writer: ResponseWriter): Promise<boolean> {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      writer.off("drain", onDrain);
      writer.off("close", onClose);
      writer.off("error", onError);
    };
    const onDrain = () => {
      cleanup();
      resolve(true);
    };
    const onClose = () => {
      cleanup();
      resolve(false);
    };
    const onError = (error: Error) => {
      cleanup();
      reject(error);
    };
    writer.once("drain", onDrain);
    writer.once("close", onClose);
    writer.once("error", onError);
  });
}

/** Write a Fetch response to a Node response, Fastify reply, or Koa context. */
export async function toResponse(
  target: unknown,
  response: Response | undefined,
): Promise<boolean> {
  if (response === undefined) return false;
  const { writer, koa, fastify } = responseWriter(target);
  const getFastifyHeaders = fastify && read(fastify, "getHeaders");
  const priorHeaders =
    fastify && typeof getFastifyHeaders === "function"
      ? getFastifyHeaders.call(fastify)
      : koa && isObject(read(koa, "response"))
        ? read(read(koa, "response"), "headers")
        : writer.getHeaders?.();
  setHeaders(writer, response, priorHeaders);

  writer.statusCode = response.status;
  writer.statusMessage = response.statusText;
  if (koa) {
    koa.respond = false;
    if (typeof koa.status === "number") koa.status = response.status;
  }
  if (fastify) (read(fastify, "hijack") as () => void).call(fastify);

  const reader = response.body?.getReader();
  let closed = writer.destroyed === true || writer.writableEnded === true;
  const onClose = () => {
    if (!writer.writableEnded) {
      closed = true;
      void reader?.cancel();
    }
  };
  writer.once("close", onClose);

  try {
    if (reader) {
      while (!closed) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!writer.write(value) && !(await waitForDrain(writer))) {
          closed = true;
          break;
        }
      }
    }
    if (!closed) writer.end();
    return true;
  } catch (error) {
    writer.destroy(error as Error);
    throw error;
  } finally {
    writer.off("close", onClose);
    reader?.releaseLock();
  }
}
