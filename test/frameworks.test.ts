import http from "node:http";
import type { AddressInfo } from "node:net";
import { fileURLToPath } from "node:url";
import express from "express";
import Fastify from "fastify";
import { Hono } from "hono";
import Koa from "koa";
import { Router } from "../src/index";
import { toRequest, toResponse } from "../src/http";

const PUB = fileURLToPath(new URL("./fixtures/", import.meta.url));
let fail = 0;
const check = (label: string, ok: boolean, info = "") => {
  console.log(ok ? "PASS" : "FAIL", label, ok ? "" : info);
  if (!ok) fail = 1;
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// One router, served through every framework below.
function makeRoute() {
  const state = { foreverCancelled: false };
  const route = Router();
  route.use((next) => {
    route.context().headers.set("x-via", "xanout");
    return next();
  });
  route.get("/hello/:name", () =>
    route.context().text("hi " + route.context().params.name),
  );
  route.post("/echo", async () => {
    const c = route.context();
    return c.json(
      {
        ct: c.request.headers.get("content-type"),
        body: await c.request.text(),
      },
      201,
    );
  });
  route.get("/cookie", () => {
    const c = route.context();
    c.cookies.set("a", "1").set("b", "2", { httpOnly: true });
    return c.text("ok");
  });
  route.get("/big", () => {
    let i = 0;
    return new Response(
      new ReadableStream({
        pull(controller) {
          if (i++ < 64) controller.enqueue(new Uint8Array(32768).fill(97));
          else controller.close();
        },
      }),
    );
  });
  route.get("/forever", () => {
    return new Response(
      new ReadableStream({
        async pull(controller) {
          await sleep(5);
          controller.enqueue(new Uint8Array(1024));
        },
        cancel() {
          state.foreverCancelled = true;
        },
      }),
    );
  });
  route.get("/redirect", () => route.context().redirect("/hello/redirected"));
  route.get("/url", () => {
    const c = route.context();
    return c.json({
      path: c.url.pathname + c.url.search,
      query: c.query.get("x"),
    });
  });
  route.get("/slow/:n", async () => {
    const n = route.context().params.n;
    await sleep(25 - (+n % 5) * 5);
    return route.context().text("slow " + n + ":" + route.context().params.n);
  });
  route.static("/assets", { dir: PUB });
  return { route, state };
}

type Call = (path: string, init?: RequestInit) => Promise<Response>;

async function suite(
  label: string,
  call: Call,
  o: { form?: boolean } = { form: true },
) {
  const t = (name: string, ok: boolean, info = "") =>
    check(`${label}: ${name}`, ok, info);

  let r = await call("/hello/Naxrul");
  t(
    "GET route + middleware header",
    r.status === 200 &&
      (await r.text()) === "hi Naxrul" &&
      r.headers.get("x-via") === "xanout",
  );

  r = await call("/echo", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: '{"a":1}',
  });
  let j: any = await r.json();
  t(
    "POST JSON body",
    r.status === 201 && j.body === '{"a":1}' && j.ct === "application/json",
    JSON.stringify(j),
  );

  r = await call("/echo", {
    method: "POST",
    headers: { "content-type": "text/plain" },
    body: "plain text ✓",
  });
  j = await r.json();
  t("POST text body", j.body === "plain text ✓", JSON.stringify(j));

  if (o.form !== false) {
    r = await call("/echo", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: "a=1&b=2&b=3",
    });
    j = await r.json();
    t("POST form body", j.body === "a=1&b=2&b=3", JSON.stringify(j));
  }

  r = await call("/cookie");
  t(
    "multiple Set-Cookie",
    JSON.stringify(r.headers.getSetCookie()) ===
      '["a=1; Path=/","b=2; Path=/; HttpOnly"]',
    JSON.stringify(r.headers.getSetCookie()),
  );

  r = await call("/big");
  t(
    "2 MB streamed body arrives intact",
    (await r.arrayBuffer()).byteLength === 64 * 32768,
  );

  r = await call("/redirect", { redirect: "manual" });
  t(
    "redirect",
    r.status === 302 && r.headers.get("location") === "/hello/redirected",
  );

  r = await call("/nope");
  t("404 notFound", r.status === 404 && (await r.text()) === "Not Found");

  r = await call("/assets/app.css");
  t(
    "static file",
    r.status === 200 &&
      (await r.text()) === "body{}\n" &&
      r.headers.get("content-type")!.startsWith("text/css"),
  );
  r = await call("/assets/app.css", { method: "HEAD" });
  t(
    "static HEAD",
    r.status === 200 &&
      r.headers.get("content-length") === "7" &&
      (await r.text()) === "",
  );
  r = await call("/assets/app.css", { headers: { range: "bytes=0-3" } });
  t("static Range", r.status === 206 && (await r.text()) === "body");

  r = await call("/url?x=1");
  j = await r.json();
  t(
    "URL and query rebuilt",
    j.path === "/url?x=1" && j.query === "1",
    JSON.stringify(j),
  );

  const rs = await Promise.all(
    Array.from({ length: 20 }, (_, n) => call("/slow/" + n)),
  );
  const texts = await Promise.all(rs.map((x) => x.text()));
  t(
    "20 concurrent requests keep their own context",
    texts.every((x, n) => x === `slow ${n}:${n}`),
    texts.join("|"),
  );
}

const listen = (server: http.Server) =>
  new Promise<string>((resolve) =>
    server.listen(0, "127.0.0.1", () =>
      resolve(`http://127.0.0.1:${(server.address() as AddressInfo).port}`),
    ),
  );
const over =
  (base: string): Call =>
  (p, init) =>
    fetch(base + p, init);
const close = (server: http.Server) =>
  new Promise<void>(
    (r) => (server.closeAllConnections?.(), server.close(() => r())),
  );

// ---------- plain Node http
{
  const { route, state } = makeRoute();
  const server = http.createServer((req, res) => {
    route
      .fetch(toRequest(req))
      .then(async (r) => {
        if (!(await toResponse(res, r))) {
          res.statusCode = 404;
          res.setHeader("content-type", "text/plain");
          res.end("Not Found");
        }
      })
      .catch((e) => {
        res.statusCode = 500;
        res.end(String(e));
      });
  });
  const base = await listen(server);
  await suite("node:http", over(base));

  // client hangs up mid-stream: the Response body must be cancelled, the server keeps working
  const ac = new AbortController();
  const res = await fetch(base + "/forever", { signal: ac.signal });
  await res.body!.getReader().read();
  ac.abort();
  await sleep(150);
  check(
    "node:http: client disconnect cancels the response body",
    state.foreverCancelled === true,
  );
  const after = await fetch(base + "/hello/after");
  check(
    "node:http: server still healthy after disconnect",
    (await after.text()) === "hi after",
  );
  await close(server);
}

// ---------- Express: no body parser (raw stream)
{
  const { route } = makeRoute();
  const app = express();
  app.use(async (req, res, next) => {
    if (!(await toResponse(res, await route.fetch(toRequest(req))))) next();
  });
  app.use((_req, res) => {
    res.status(404).send("Not Found");
  });
  const server = http.createServer(app);
  await suite("express (no parsers)", over(await listen(server)));
  await close(server);
}

// ---------- Express: json/urlencoded/text parsers ran first and consumed the stream
{
  const { route } = makeRoute();
  const app = express();
  app.use(
    express.json(),
    express.urlencoded({ extended: false }),
    express.text(),
  );
  app.use(async (req, res, next) => {
    if (!(await toResponse(res, await route.fetch(toRequest(req))))) next();
  });
  app.use((_req, res) => {
    res.status(404).send("Not Found");
  });
  const server = http.createServer(app);
  await suite(
    "express (json/urlencoded/text parsers)",
    over(await listen(server)),
  );
  await close(server);
}

// ---------- Fastify: default parsers (JSON + text consumed by Fastify)
{
  const { route } = makeRoute();
  const app = Fastify();
  app.addHook("onRequest", async (_req, reply) => {
    reply.header("x-from-fastify", "1");
  });
  app.setNotFoundHandler((_req, reply) => {
    reply.code(404).type("text/plain").send("Not Found");
  });
  app.all("/*", async (req, reply) => {
    if (!(await toResponse(reply, await route.fetch(toRequest(req)))))
      return reply.callNotFound();
  });
  await app.listen({ port: 0, host: "127.0.0.1" });
  const base = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`;
  await suite("fastify (default parsers)", over(base), { form: false }); // Fastify has no built-in urlencoded parser
  const r = await fetch(base + "/hello/x");
  check(
    "fastify: headers set earlier on the reply are kept",
    r.headers.get("x-from-fastify") === "1" &&
      r.headers.get("x-via") === "xanout",
  );
  await app.close();
}

// ---------- Fastify: raw stream (parsers removed)
{
  const { route } = makeRoute();
  const app = Fastify();
  app.removeAllContentTypeParsers();
  app.addContentTypeParser("*", (_req, _payload, done) => done(null));
  app.setNotFoundHandler((_req, reply) => {
    reply.code(404).type("text/plain").send("Not Found");
  });
  app.all("/*", async (req, reply) => {
    if (!(await toResponse(reply, await route.fetch(toRequest(req)))))
      return reply.callNotFound();
  });
  await app.listen({ port: 0, host: "127.0.0.1" });
  await suite(
    "fastify (raw stream)",
    over(`http://127.0.0.1:${(app.server.address() as AddressInfo).port}`),
  );
  await app.close();
}

// ---------- Koa
{
  const { route } = makeRoute();
  const app = new Koa();
  app.use(async (ctx) => {
    if (!(await toResponse(ctx, await route.fetch(toRequest(ctx))))) {
      ctx.status = 404;
      ctx.body = "Not Found";
    }
  });
  const server = http.createServer(app.callback());
  await suite("koa", over(await listen(server)));
  await close(server);
}

// ---------- Hono (web Request in, web Response out: no toResponse needed)
{
  const { route } = makeRoute();
  const app = new Hono();
  app.all("*", async (c, next) => {
    const r = await route.fetch(c.req.raw);
    if (r) return r;
    await next();
  });
  app.notFound((c) => c.text("Not Found", 404));
  await suite("hono", (p, init) =>
    Promise.resolve(app.fetch(new Request("http://localhost" + p, init))),
  );
}

// ---------- web-standard server shape: export default route / Bun.serve(route)
{
  const { route } = makeRoute();
  const detached = route.fetch; // no `this` needed
  const r = await detached(new Request("http://localhost/hello/web"));
  check(
    "web Request in, Response out (detached fetch)",
    (await r!.text()) === "hi web",
  );
}

// ---------- toResponse validation
{
  let name = "";
  try {
    await toResponse({}, new Response("x"));
  } catch (e) {
    name = (e as Error).constructor.name;
  }
  check("toResponse rejects unsupported targets", name === "TypeError", name);
  const untouched = {};
  check(
    "toResponse(target, undefined) -> false, target untouched",
    (await toResponse(untouched, undefined)) === false &&
      Object.keys(untouched).length === 0,
  );
}

// ---------- fetch takes web Requests only
{
  const { route } = makeRoute();
  const errName = async (input: any) => {
    try {
      await route.fetch(input);
    } catch (e) {
      return (e as Error).constructor.name;
    }
    return "";
  };
  check(
    "fetch(node-style request) throws TypeError",
    (await errName({ method: "GET", url: "/", headers: {} })) === "TypeError",
  );
  check(
    "fetch(Hono-like context) throws TypeError",
    (await errName({ req: { raw: new Request("http://x/") } })) === "TypeError",
  );
  check(
    "fetch(undefined) throws TypeError",
    (await errName(undefined)) === "TypeError",
  );
}

process.exitCode = fail;
