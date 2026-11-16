import { Readable } from "node:stream";
import { toRequest } from "../src/http";

let fail = 0;
const t = (label: string, ok: boolean, info = "") => {
  console.log(ok ? "PASS" : "FAIL", label, ok ? "" : info);
  if (!ok) fail = 1;
};
const errName = (fn: () => unknown) => {
  try {
    fn();
    return "";
  } catch (e) {
    return (e as Error).constructor.name;
  }
};

// A fake Node IncomingMessage: a Readable with method/url/headers.
const node = (props: Record<string, any>, chunks: (string | Buffer)[] = []) =>
  Object.assign(Readable.from(chunks), {
    method: "GET",
    url: "/",
    headers: { host: "example.com" },
    ...props,
  });

// ---------- web Request passthrough / wrappers
{
  const req = new Request("http://x.com/a", { method: "POST", body: "hi" });
  t("web Request returned as is", toRequest(req) === req);
  const duck = {
    url: "http://x/",
    method: "GET",
    headers: new Headers(),
    arrayBuffer: async () => new ArrayBuffer(0),
  };
  t("duck-typed web request returned as is", toRequest(duck) === (duck as any));
  t("Hono-like c.req.raw", toRequest({ req: { raw: req } }) === req);
  t(
    "{ request } (SvelteKit/Astro/Remix/Elysia/Pages)",
    toRequest({ request: req, env: {} }) === req,
  );
  t("h3 v2 event.req", toRequest({ req }) === req);
}

// ---------- unsupported
{
  t("{} throws TypeError", errName(() => toRequest({})) === "TypeError");
  t(
    "null throws TypeError",
    errName(() => toRequest(null as any)) === "TypeError",
  );
  t(
    "string throws TypeError",
    errName(() => toRequest("http://x" as any)) === "TypeError",
  );
  t(
    "number throws TypeError",
    errName(() => toRequest(42 as any)) === "TypeError",
  );
  t(
    "Lambda-like event throws TypeError",
    errName(() => toRequest({ httpMethod: "GET", path: "/", headers: {} })) ===
      "TypeError",
  );
}

// ---------- Node-style: method, URL, headers, body stream
{
  const n = node(
    {
      method: "POST",
      url: "/x?y=1",
      headers: {
        host: "example.com:8080",
        "content-type": "application/json",
        "x-multi": ["a", "b"],
        "set-cookie": ["c=1", "d=2"],
      },
    },
    ['{"a":', "1}"],
  );
  const r = toRequest(n);
  t("url from Host + url", r.url === "http://example.com:8080/x?y=1", r.url);
  t("method", r.method === "POST");
  t(
    "headers incl. array values",
    r.headers.get("content-type") === "application/json" &&
      r.headers.get("x-multi") === "a, b" &&
      r.headers.getSetCookie().length === 2,
  );
  t("body streamed", JSON.stringify(await r.json()) === '{"a":1}');
}
{
  const r = toRequest(node({ method: "post" }, [Buffer.from("héllo")]));
  t(
    "lower-case method upper-cased + Buffer chunks",
    r.method === "POST" && (await r.text()) === "héllo",
  );
  const r2 = toRequest(node({ method: "POST" }, ["str chunk"]));
  t("string chunks (setEncoding)", (await r2.text()) === "str chunk");
  const r3 = toRequest(node({ method: "GET" }, ["ignored"]));
  t("GET has no body", r3.body === null);
  t(
    "HEAD has no body",
    toRequest(node({ method: "HEAD" }, ["ignored"])).body === null,
  );
}

// ---------- URL building
{
  t(
    "originalUrl preferred (Express mounted app)",
    toRequest(node({ url: "/inner", originalUrl: "/api/inner?q=1" })).url ===
      "http://example.com/api/inner?q=1",
  );
  t(
    "src.protocol used",
    toRequest(node({ protocol: "https" })).url === "https://example.com/",
  );
  t(
    "socket.encrypted -> https",
    toRequest(node({ socket: { encrypted: true } })).url ===
      "https://example.com/",
  );
  t(
    "HTTP/2 pseudo-headers skipped, :authority used",
    (() => {
      const r = toRequest(
        node({
          url: "/p",
          headers: {
            ":method": "GET",
            ":path": "/p",
            ":authority": "h2.example.com",
            accept: "*/*",
          },
        }),
      );
      return (
        r.url === "http://h2.example.com/p" &&
        r.headers.get("accept") === "*/*" &&
        [...r.headers.keys()].every((k) => !k.startsWith(":"))
      );
    })(),
  );
  t(
    "absolute-form URL used as is",
    toRequest(node({ url: "http://proxy.example/abs?z=1" })).url ===
      "http://proxy.example/abs?z=1",
  );
  t(
    "missing url -> /",
    toRequest(node({ url: undefined })).url === "http://example.com/",
  );
  t(
    "'*' target -> /",
    toRequest(node({ method: "OPTIONS", url: "*" })).url ===
      "http://example.com/",
  );
}

// ---------- URL safety
{
  const evilHost = toRequest(node({ headers: { host: "evil.com/path?x=1#" } }));
  t(
    "hostile Host header -> localhost",
    new URL(evilHost.url).host === "localhost",
    evilHost.url,
  );
  t(
    "Host with space -> localhost",
    new URL(toRequest(node({ headers: { host: "a b" } })).url).host ===
      "localhost",
  );
  t(
    "missing Host -> localhost",
    new URL(toRequest(node({ headers: {} })).url).host === "localhost",
  );
  t(
    "IPv6 Host ok",
    toRequest(node({ headers: { host: "[::1]:3000" } })).url ===
      "http://[::1]:3000/",
  );
  const slashes = toRequest(node({ url: "//evil.com/x" }));
  t(
    "'//evil.com/x' path cannot change the host",
    new URL(slashes.url).host === "example.com" &&
      new URL(slashes.url).pathname === "//evil.com/x",
    slashes.url,
  );
  t(
    "bad protocol ignored",
    toRequest(node({ protocol: "javascript" })).url.startsWith("http://"),
  );
}

// ---------- options
{
  const n = () =>
    node({
      headers: {
        host: "real.com",
        "x-forwarded-proto": "https, http",
        "x-forwarded-host": "public.example.com, other",
      },
    });
  t(
    "forwarded headers ignored by default",
    toRequest(n()).url === "http://real.com/",
  );
  t(
    "trustProxy uses forwarded headers",
    toRequest(n(), { trustProxy: true }).url === "https://public.example.com/",
  );
  t(
    "baseUrl overrides everything",
    toRequest(n(), {
      baseUrl: "https://api.example.com/ignored/path",
      trustProxy: true,
    }).url === "https://api.example.com/",
  );
}

// ---------- body already consumed by a body parser (Express json(), Fastify, Koa bodyparser, Next.js pages)
{
  const consumedNode = (props: Record<string, any>) => {
    const n = node({ method: "POST", ...props });
    n.resume();
    // a real stream sets this itself after it has been read to the end (see frameworks.test.ts)
    Object.defineProperty(n, "readableEnded", { value: true });
    return n;
  };
  const hdr = (o: Record<string, string>) => ({ host: "example.com", ...o });

  let r = toRequest(
    consumedNode({
      headers: hdr({
        "content-type": "application/json",
        "content-length": "7",
        "content-encoding": "gzip",
      }),
      body: { a: 1 },
    }),
  );
  t("parsed JSON body rebuilt", (await r.text()) === '{"a":1}');
  t(
    "stale content-length / content-encoding removed",
    r.headers.get("content-length") === null &&
      r.headers.get("content-encoding") === null,
  );

  r = toRequest(
    consumedNode({
      headers: hdr({
        "content-type": "application/x-www-form-urlencoded",
        "content-length": "9",
      }),
      body: { a: "1", b: ["2", "3"], c: { d: 1 } },
    }),
  );
  t(
    "parsed urlencoded body rebuilt",
    (await r.text()) === "a=1&b=2&b=3&c=%7B%22d%22%3A1%7D",
  );
  t(
    "urlencoded keeps content-type",
    r.headers.get("content-type") === "application/x-www-form-urlencoded",
  );

  r = toRequest(
    consumedNode({
      headers: hdr({ "content-type": "text/plain", "content-length": "2" }),
      body: "hi",
    }),
  );
  t("parsed string body", (await r.text()) === "hi");

  r = toRequest(
    consumedNode({
      headers: hdr({
        "content-type": "application/octet-stream",
        "content-length": "3",
      }),
      body: Buffer.from([1, 2, 3]),
    }),
  );
  t(
    "parsed Buffer body",
    [...new Uint8Array(await r.arrayBuffer())].join() === "1,2,3",
  );

  r = toRequest(
    consumedNode({
      headers: hdr({
        "content-type": "application/json",
        "content-length": "9",
      }),
      body: { parsed: true },
      rawBody: Buffer.from('{ "raw" : 1 }'),
    }),
  );
  t("rawBody preferred over parsed body", (await r.text()) === '{ "raw" : 1 }');

  r = toRequest(consumedNode({ headers: hdr({}), body: {} }));
  t("no declared body -> no body ({} from Express 4 ignored)", r.body === null);

  r = toRequest(
    consumedNode({
      headers: hdr({
        "transfer-encoding": "chunked",
        "content-type": "application/json",
      }),
      body: { t: 1 },
    }),
  );
  t(
    "chunked body rebuilt",
    (await r.text()) === '{"t":1}' &&
      r.headers.get("transfer-encoding") === null,
  );

  // Fastify-like: { raw, body, url, protocol }
  const raw = consumedNode({
    url: "/ignored",
    headers: hdr({ "content-type": "application/json", "content-length": "7" }),
  });
  r = toRequest({
    raw,
    body: { f: 1 },
    url: "/fastify?x=1",
    protocol: "https",
  });
  t(
    "Fastify-like shape",
    r.url === "https://example.com/fastify?x=1" &&
      (await r.text()) === '{"f":1}',
    r.url,
  );

  // Koa-like: { req, request: { body }, originalUrl, protocol }
  const kreq = consumedNode({
    url: "/inner",
    headers: hdr({ "content-type": "application/json", "content-length": "7" }),
  });
  r = toRequest({
    req: kreq,
    res: {},
    request: { body: { k: 1 } },
    originalUrl: "/koa?y=2",
    protocol: "http",
  });
  t(
    "Koa-like shape (body on ctx.request)",
    r.url === "http://example.com/koa?y=2" && (await r.text()) === '{"k":1}',
    r.url,
  );

  // Koa-like, stream not consumed
  const kfresh = node(
    { method: "POST", headers: hdr({ "content-type": "text/plain" }) },
    ["raw koa"],
  );
  r = toRequest({
    req: kfresh,
    res: {},
    request: {},
    originalUrl: "/k",
    protocol: "http",
  });
  t("Koa-like shape, unread stream", (await r.text()) === "raw koa");

  // h3 v1 / Nitro: { node: { req } }
  r = toRequest({ node: { req: node({ url: "/h3" }) } });
  t("h3 v1-like event.node.req", r.url === "http://example.com/h3");
}

// ---------- contexts with throwing getters (Hono's c.event / c.executionCtx)
{
  const req = new Request("http://x.com/a");
  const honoLike = {
    req: { raw: req },
    get event(): never {
      throw new Error("This context has no FetchEvent");
    },
    get executionCtx(): never {
      throw new Error("This context has no ExecutionContext");
    },
  };
  t(
    "throwing getters on a framework context are harmless",
    toRequest(honoLike) === req,
  );
  const n = node({ url: "/t" });
  Object.defineProperty(n, "protocol", {
    get() {
      throw new Error("boom");
    },
  });
  Object.defineProperty(n, "originalUrl", {
    get() {
      throw new Error("boom");
    },
  });
  t(
    "throwing protocol/originalUrl getters on a Node request are tolerated",
    toRequest(n).url === "http://example.com/t",
  );
}

// ---------- tolerant of junk
{
  const r = toRequest(
    node({ headers: { host: "example.com", "bad header": "x", ok: "1" } }),
  );
  t("invalid header names skipped, not thrown", r.headers.get("ok") === "1");
}

process.exitCode = fail;
