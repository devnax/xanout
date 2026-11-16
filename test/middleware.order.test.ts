import { fileURLToPath } from "node:url";
import { Router } from "../src/index";

const PUB = fileURLToPath(new URL("./fixtures/", import.meta.url));
let fail = 0;
const t = (label: string, ok: boolean, info = "") => {
  console.log(ok ? "PASS" : "FAIL", label, ok ? "" : info);
  if (!ok) fail = 1;
};
const go = (r: ReturnType<typeof Router>, p: string, init: RequestInit = {}) =>
  r.fetch(new Request("http://x.com" + p, init));
const body = async (res: Response) => `${res.status} ${await res.text()}`;

// ---- middleware declared AFTER routes still runs first
{
  const log: string[] = [];
  const route = Router();
  route.get("/", () => {
    log.push("handler");
    return new Response("home");
  });
  route.use((next) => {
    log.push("mw");
    return next();
  });
  await go(route, "/");
  t(
    "use() after a route still runs before it",
    log.join() === "mw,handler",
    log.join(),
  );
}

// ---- the auth footgun: protection declared after the route
{
  const route = Router();
  route.get("/admin/stats", () => new Response("secret"));
  route.use("/admin", (next) =>
    route.context().request.headers.get("authorization") === "Bearer x"
      ? next()
      : new Response("Unauthorized", { status: 401 }),
  );
  t(
    "auth declared after route still blocks",
    (await body(await go(route, "/admin/stats"))) === "401 Unauthorized",
  );
  t(
    "auth lets valid requests through",
    (await body(
      await go(route, "/admin/stats", {
        headers: { authorization: "Bearer x" },
      }),
    )) === "200 secret",
  );
}

// ---- order among middleware is the order they were declared
{
  const log: string[] = [];
  const route = Router();
  route.use((next) => {
    log.push("a");
    return next();
  });
  route.get("/", () => {
    log.push("route");
    return new Response("ok");
  });
  route.use("/", (next) => {
    log.push("b");
    return next();
  });
  route.post("/never", () => new Response("never"));
  route.use((next) => {
    log.push("c");
    return next();
  });
  await go(route, "/");
  t(
    "middleware keeps declaration order among themselves",
    log.join() === "a,b,c,route",
    log.join(),
  );
}

// ---- middleware wrapping (before/after) works when declared last
{
  const route = Router();
  route.get("/", () => new Response("home"));
  route.use(async (next) => {
    const res = await next();
    res?.headers.set("x-after", "1");
    return res;
  });
  t(
    "after-next() logic works when declared last",
    (await go(route, "/")).headers.get("x-after") === "1",
  );
}

// ---- error-handling middleware declared last still catches route errors
{
  const route = Router();
  route.get("/boom", () => {
    throw new Error("kaboom");
  });
  route.use(async (next) => {
    try {
      return await next();
    } catch (e) {
      return Response.json({ error: (e as Error).message }, { status: 500 });
    }
  });
  t(
    "error middleware declared last still catches",
    (await body(await go(route, "/boom"))) === '500 {"error":"kaboom"}',
  );
}

// ---- use(path, router) mounts run before routes, wherever they are declared
{
  const sub = Router();
  sub.get("/special", () => new Response("from sub"));
  const first = Router();
  first.get("/api/special", () => new Response("from route"));
  first.get("/api/other", () => new Response("other route"));
  first.use("/api", sub); // declared AFTER the routes
  t(
    "mount declared after a route still runs first",
    (await body(await go(first, "/api/special"))) === "200 from sub",
  );
  t(
    "route still handles what the mounted router doesn't",
    (await body(await go(first, "/api/other"))) === "200 other route",
  );

  const second = Router();
  second.use("/api", sub);
  second.get("/api/special", () => new Response("from route"));
  t(
    "mount declared before a route runs first",
    (await body(await go(second, "/api/special"))) === "200 from sub",
  );

  const m1 = Router(),
    m2 = Router();
  m1.get("/x", () => new Response("m1"));
  m2.get("/x", () => new Response("m2"));
  const two = Router();
  two.use("/p", m1);
  two.use("/p", m2);
  t(
    "mounted routers keep declaration order among themselves",
    (await body(await go(two, "/p/x"))) === "200 m1",
  );

  const verbMounted = Router();
  const users = Router();
  users.post("/", () => new Response("users router"));
  verbMounted.post("/users", () => new Response("plain route"));
  verbMounted.post("/users", users); // verb-mounted: stays in route order
  t(
    "post(path, router) stays in route order",
    (await body(await go(verbMounted, "/users", { method: "POST" }))) ===
      "200 plain route",
  );

  const log: string[] = [];
  const third = Router();
  third.use("/api", sub);
  third.use((next) => {
    log.push("mw");
    return next();
  }); // declared after the mount
  await go(third, "/api/special");
  t(
    "middleware declared after a mount still runs before it",
    log.join() === "mw",
    log.join(),
  );
}

// ---- static runs before use: static files never pass through middleware
{
  const calls: string[] = [];
  const route = Router();
  route.get("/page", () => new Response("page"));
  route.use((next) => {
    calls.push(route.context().pathname);
    route.context().headers.set("x-mw", "1");
    return next();
  });
  route.static("/assets", { dir: PUB }); // declared AFTER use and the route
  let res = await go(route, "/assets/app.css");
  t(
    "static file is served without running middleware",
    res.status === 200 &&
      res.headers.get("x-mw") === null &&
      calls.length === 0,
    calls.join(),
  );
  res = await go(route, "/page");
  t(
    "non-static request still runs middleware once",
    res.headers.get("x-mw") === "1" && calls.join() === "/page",
    calls.join(),
  );
  const unmatched = await go(route, "/nope");
  t(
    "unmatched request runs middleware once, then undefined",
    unmatched === undefined && calls.join() === "/page,/nope",
    calls.join(),
  );
}

// ---- a static miss continues to middleware and routes
{
  const calls: string[] = [];
  const route = Router();
  route.static("/", { dir: PUB });
  route.use((next) => {
    calls.push("mw");
    return next();
  });
  route.get("/dynamic", () => new Response("dynamic"));
  const res = await go(route, "/dynamic");
  t(
    "static miss -> middleware -> route",
    (await body(res)) === "200 dynamic" && calls.join() === "mw",
  );
}

// ---- one request, one middleware call (page reload = many requests, each once)
{
  const calls: string[] = [];
  const sub = Router();
  sub.get("/leaf", () => new Response("leaf"));
  const route = Router();
  route.static("/assets", { dir: PUB });
  route.use((next) => {
    calls.push(route.context().pathname);
    return next();
  });
  route.use("/s", sub);
  route.get("/", () => new Response("<html>"));
  for (const p of [
    "/",
    "/s/leaf",
    "/favicon.ico",
    "/assets/app.css",
    "/assets/sub/n.txt",
  ])
    await go(route, p);
  t(
    "each request calls use() once; static requests not at all",
    calls.join() === "/,/s/leaf,/favicon.ico",
    calls.join(),
  );
}

// ---- sub-routers: their own middleware runs first inside them; parent's runs before that
{
  const log: string[] = [];
  const sub = Router();
  sub.get("/x", () => {
    log.push("sub-route");
    return new Response("x");
  });
  sub.use((next) => {
    log.push("sub-mw");
    return next();
  }); // declared after the sub's route
  const route = Router();
  route.use("/s", sub);
  route.use((next) => {
    log.push("parent-mw");
    return next();
  }); // declared after the mount
  await go(route, "/s/x");
  t(
    "parent mw, then sub mw, then sub route",
    log.join() === "parent-mw,sub-mw,sub-route",
    log.join(),
  );
}

// ---- middleware only runs for matching prefixes and methods are unaffected
{
  const log: string[] = [];
  const route = Router();
  route.get("/other", () => new Response("other"));
  route.use("/api", (next) => {
    log.push("api-mw");
    return next();
  });
  route.get("/api/x", () => new Response("x"));
  await go(route, "/other");
  t("prefix middleware not run for other paths", log.length === 0, log.join());
  await go(route, "/api/x");
  t(
    "prefix middleware runs for its prefix",
    log.join() === "api-mw",
    log.join(),
  );
}

// ---- middleware that short-circuits stops the routes
{
  let ran = false;
  const route = Router();
  route.get("/", () => {
    ran = true;
    return new Response("route");
  });
  route.use(() => new Response("stopped", { status: 403 }));
  t(
    "short-circuiting middleware declared last stops the route",
    (await body(await go(route, "/"))) === "403 stopped" && !ran,
  );
}

process.exitCode = fail;
