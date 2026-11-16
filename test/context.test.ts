import { Context, Router } from "../src/index";
let fail = 0;
const t = (label: string, ok: boolean, info = "") => {
  console.log(ok ? "PASS" : "FAIL", label, ok ? "" : info);
  if (!ok) fail = 1;
};
const mk = () => Router();
const go = (r: ReturnType<typeof Router>, p: string, init: RequestInit = {}) =>
  r.fetch(new Request("http://x.com" + p, init));

// headers + cookies merged into handler's own Response
let r = mk();
r.use((next) => {
  const c = r.context();
  c.headers.set("x-mw", "1");
  c.cookies.set("sid", "abc 123", {
    httpOnly: true,
    sameSite: "lax",
    maxAge: 3600,
  });
  return next();
});
r.get("/", () => {
  r.context().headers.set("x-route", "2");
  r.context().cookies.set("theme", "dark", { path: "/app", secure: true });
  return new Response("ok", { headers: { "x-own": "3" } });
});
let res = await go(r, "/");
t(
  "headers merged",
  res.headers.get("x-mw") === "1" &&
    res.headers.get("x-route") === "2" &&
    res.headers.get("x-own") === "3",
);
const sc = res.headers.getSetCookie();
t("set-cookie x2", sc.length === 2, JSON.stringify(sc));
t(
  "cookie attrs",
  sc[0] === "sid=abc%20123; Path=/; Max-Age=3600; HttpOnly; SameSite=Lax" &&
    sc[1] === "theme=dark; Path=/app; Secure",
  JSON.stringify(sc),
);

// read cookies, has, all, delete, view reflects changes
r = mk();
r.get("/c", () => {
  const ck = r.context().cookies;
  const before = [ck.get("a"), ck.get("b"), ck.has("zzz"), ck.get("enc")].join(
    "|",
  );
  ck.set("a", "new");
  ck.delete("b");
  ck.set("c", "3");
  const after =
    JSON.stringify(ck.all()) + "|" + ck.get("a") + "|" + ck.has("b");
  return new Response(before + " >> " + after);
});
res = await go(r, "/c", { headers: { cookie: "a=1; b=2; enc=x%20y" } });
t(
  "cookie read/set/delete view",
  (await res.text()) ===
    '1|2|false|x y >> {"a":"new","enc":"x y","c":"3"}|new|false',
);
const scs = res.headers.getSetCookie();
t(
  "delete emits expired cookie",
  scs.some((c) =>
    c.startsWith("b=; Path=/; Max-Age=0; Expires=Thu, 01 Jan 1970"),
  ),
  JSON.stringify(scs),
);

// same cookie set twice -> only last emitted
r = mk();
r.get("/", () => {
  r.context().cookies.set("k", "1").set("k", "2");
  return new Response("x");
});
res = await go(r, "/");
t(
  "dedupe same cookie",
  res.headers.getSetCookie().length === 1 &&
    res.headers.getSetCookie()[0].startsWith("k=2"),
);

// immutable response (Response.redirect) still gets extras
r = mk();
r.get("/go", () => {
  r.context().cookies.set("flash", "hi");
  r.context().headers.set("x-a", "b");
  return Response.redirect("http://x.com/dest", 302);
});
res = await go(r, "/go");
t(
  "redirect gets extras",
  res.status === 302 &&
    res.headers.get("location") === "http://x.com/dest" &&
    res.headers.get("x-a") === "b" &&
    res.headers.getSetCookie()[0].startsWith("flash=hi"),
);

// unmatched requests resolve to undefined (no response to attach anything to); an uncaught error gets a plain 500
r = mk();
r.use((next) => {
  r.context().headers.set("x-all", "y");
  return next();
});
r.get("/boom", () => {
  throw new Error("x");
});
res = await go(r, "/nope");
t("unmatched request -> undefined", res === undefined);
const origErr = console.error;
console.error = () => {};
res = await go(r, "/boom");
console.error = origErr;
t(
  "uncaught 500 plain",
  res.status === 500 && res.headers.get("x-all") === null,
);

// headers() get/has/delete (Headers API), same object per call
r = mk();
r.get("/", () => {
  const h = r.context().headers;
  h.set("X-A", "1");
  return new Response(
    [h.get("x-a"), h.has("x-a"), r.context().headers === h].join(),
  );
});
res = await go(r, "/");
t("headers api", (await res.text()) === "1,true,true");

// concurrency: each request gets its own cookies/headers
r = mk();
r.get("/u/:n", async () => {
  const n = r.context().params.n;
  r.context().cookies.set("u", n);
  await new Promise((x) => setTimeout(x, 20 - +n * 5));
  r.context().headers.set("x-n", n);
  return new Response(n);
});
const rs = await Promise.all([1, 2, 3].map((n) => go(r, "/u/" + n)));
t(
  "concurrent isolation",
  rs.every(
    (x, i) =>
      x.headers.get("x-n") === String(i + 1) &&
      x.headers.getSetCookie()[0] === `u=${i + 1}; Path=/`,
  ),
  rs.map((x) => x.headers.get("x-n")).join(),
);

// validation
r = mk();
r.get("/", () => {
  r.context().cookies.set("bad name", "v");
  return new Response("x");
});
const oe = console.error;
console.error = () => {};
res = await go(r, "/");
console.error = oe;
t("invalid cookie name -> 500", res.status === 500);

const stateContext = new Context(new Request("http://x.com/"));
stateContext.states.set("toString", "own value");
stateContext.states.set("__proto__", "safe value");
t(
  "state supports prototype-named keys",
  stateContext.states.get("toString") === "own value" &&
    stateContext.states.get("__proto__") === "safe value",
);
stateContext.states.clear();
t(
  "clear removes state keys",
  stateContext.states.get("toString") === undefined,
);

process.exitCode = fail;
