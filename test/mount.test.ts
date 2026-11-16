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

// ---- basic prefix mount + params
{
  const route = Router();
  const api = Router();
  api.get(
    "/users/:id",
    () => new Response("user " + route.context().params.id),
  );
  route.use("/api", api);
  t(
    "use(path, Router)",
    (await body(await go(route, "/api/users/5", {}))) === "200 user 5",
  );
  t("outside prefix -> undefined", (await go(route, "/users/5")) === undefined);
  t(
    "method still enforced",
    (await go(route, "/api/users/5", { method: "POST" })) === undefined,
  );
}

// ---- order: parent mw -> sub mw -> handler; sub mw scoped to sub paths
{
  const log: string[] = [];
  const route = Router();
  const sub = Router();
  route.use((next) => {
    log.push("parent");
    return next();
  });
  sub.use((next) => {
    log.push("sub");
    return next();
  });
  sub.get("/x", () => {
    log.push("handler");
    return new Response("x");
  });
  route.get("/other", () => new Response("other"));
  route.use("/s", sub);
  await go(route, "/s/x");
  t("middleware order", log.join(",") === "parent,sub,handler", log.join(","));
  log.length = 0;
  await go(route, "/other");
  t(
    "sub middleware not run for other paths",
    log.join(",") === "parent",
    log.join(","),
  );
}

// ---- fall-through: sub has no match -> parent continues; sub middleware next() flows on
{
  const route = Router();
  const sub = Router();
  sub.use((next) => next());
  sub.get("/mine", () => new Response("sub"));
  route.use("/api", sub);
  route.get("/api/other", () => new Response("parent"));
  t("sub match", (await body(await go(route, "/api/mine"))) === "200 sub");
  t(
    "fall through to parent route",
    (await body(await go(route, "/api/other"))) === "200 parent",
  );
}

// ---- mount params merge with sub params
{
  const route = Router();
  const members = Router();
  members.get("/members/:id", () => Response.json(route.context().params));
  route.use("/orgs/:org", members);
  t(
    "params merged",
    (await body(await go(route, "/orgs/acme/members/7"))) ===
      '200 {"org":"acme","id":"7"}',
  );
}

// ---- verb mount restricts method
{
  const route = Router();
  const users = Router();
  users.post("/:id", () => new Response("posted " + route.context().params.id));
  route.post("/users", users);
  t(
    "post(path, Router)",
    (await body(await go(route, "/users/42", { method: "POST" }))) ===
      "200 posted 42",
  );
  t(
    "wrong method not routed",
    (await go(route, "/users/42", { method: "GET" })) === undefined,
  );
}

// ---- root mount
{
  const route = Router();
  const sub = Router();
  sub.get("/hi", () => new Response("hi"));
  route.use(sub);
  t("use(Router) at root", (await body(await go(route, "/hi"))) === "200 hi");
}

// ---- nesting + ctx.pathname / ctx.basePath, restored after downstream
{
  const route = Router(),
    a = Router(),
    b = Router();
  const seen: string[] = [];
  route.use(async (next) => {
    const before = route.context().pathname;
    const res = await next();
    seen.push(`parent before=${before} after=${route.context().pathname}`);
    return res;
  });
  b.get("/leaf", () => {
    const c = route.context();
    seen.push(`leaf path=${c.pathname} base=${c.basePath}`);
    return new Response("leaf");
  });
  a.use("/b", b);
  route.use("/a", a);
  const res = await go(route, "/a/b/leaf");
  t("nested mount", (await body(res)) === "200 leaf");
  t(
    "pathname/basePath in sub-router",
    seen[0] === "leaf path=/leaf base=/a/b",
    seen[0],
  );
  t(
    "context restored after downstream",
    seen[1] === "parent before=/a/b/leaf after=/a/b/leaf",
    seen[1],
  );
}

// ---- nothing matched: undefined; an empty mounted router lets routing continue in the parent
{
  const route = Router();
  const sub = Router();
  route.use("/s", sub);
  route.get("/s/fallback", () => new Response("parent route"));
  t(
    "unmatched everywhere -> undefined",
    (await go(route, "/s/none")) === undefined,
  );
  t(
    "unmatched standalone sub-router -> undefined",
    (await go(sub, "/none")) === undefined,
  );
  t(
    "parent route after an empty mounted router",
    (await body(await go(route, "/s/fallback"))) === "200 parent route",
  );
}

// ---- static inside a sub-router (prefix is relative to the mount)
{
  const route = Router();
  const sub = Router();
  sub.static("/assets", { dir: PUB });
  route.use("/v1", sub);
  const res = await go(route, "/v1/assets/app.css");
  t(
    "static in sub-router",
    res.status === 200 && (await res.text()) === "body{}\n",
  );
  t(
    "static not at un-mounted path",
    (await go(route, "/assets/app.css")) === undefined,
  );
}

// ---- cookies + headers set in sub-router reach the response
{
  const route = Router();
  const sub = Router();
  sub.get("/login", () => {
    route.context().cookies.set("sid", "1");
    route.context().headers.set("x-sub", "yes");
    return new Response("ok");
  });
  route.use("/auth", sub);
  const res = await go(route, "/auth/login");
  t(
    "cookies/headers from sub-router",
    res.headers.get("x-sub") === "yes" &&
      res.headers.getSetCookie()[0] === "sid=1; Path=/",
  );
}

// ---- concurrency across sub-routers
{
  const route = Router();
  const sub = Router();
  sub.get("/slow/:n", async () => {
    const n = route.context().params.n;
    await new Promise((r) => setTimeout(r, 30 - +n * 10));
    return new Response(
      n + ":" + route.context().params.n + ":" + route.context().basePath,
    );
  });
  route.use("/q", sub);
  const rs = await Promise.all([1, 2, 3].map((n) => go(route, "/q/slow/" + n)));
  const texts = await Promise.all(rs.map((r) => r.text()));
  t(
    "concurrent requests through sub-router",
    texts.join() === "1:1:/q,2:2:/q,3:3:/q",
    texts.join(),
  );
}

// ---- validation
{
  const route = Router();
  let msg = "";
  try {
    route.use("/self", route);
  } catch (e) {
    msg = (e as Error).message;
  }
  t("self-mount throws", msg.includes("itself"), msg);
  msg = "";
  try {
    (route as any).use("/x", { not: "a router" });
  } catch (e) {
    msg = (e as Error).constructor.name;
  }
  t("non-router object throws TypeError", msg === "TypeError", msg);
  msg = "";
  try {
    (route as any).use("/x");
  } catch (e) {
    msg = (e as Error).constructor.name;
  }
  t("missing handler throws TypeError", msg === "TypeError", msg);
}

process.exitCode = fail;
