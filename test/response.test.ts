import { Context, Router } from "../src/index";

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

// Run `fn` as the only route and return its response.
const run = async (
  fn: (ctx: Context) => Response | void,
  path = "/",
  init?: RequestInit,
) => {
  const r = Router();
  r.all("/*", () => fn(r.context()));
  return r.fetch(new Request("http://x.com" + path, init));
};

// ---- the example from the spec
{
  const res = await run((ctx) => {
    ctx.headers.set("X-Custom", "1");
    ctx.cookies.set("session", "abc123");
    return ctx.json({ message: "Hello, world!" });
  });
  t(
    "spec example",
    res.status === 200 &&
      res.headers.get("content-type") === "application/json; charset=utf-8" &&
      res.headers.get("x-custom") === "1" &&
      res.headers.getSetCookie()[0] === "session=abc123; Path=/" &&
      (await res.text()) === '{"message":"Hello, world!"}',
  );
}

// ---- json
{
  let res = await run((c) => c.json({ a: 1 }, 201));
  t(
    "json status number",
    res.status === 201 && (await res.text()) === '{"a":1}',
  );
  res = await run((c) =>
    c.json([1, 2], { status: 202, headers: { "x-a": "b" } }),
  );
  t(
    "json ResponseInit",
    res.status === 202 &&
      res.headers.get("x-a") === "b" &&
      res.headers.get("content-type")!.startsWith("application/json"),
  );
  res = await run((c) =>
    c.json({}, { headers: { "content-type": "application/vnd.api+json" } }),
  );
  t(
    "json keeps explicit content-type",
    res.headers.get("content-type") === "application/vnd.api+json",
  );
  res = await run((c) => c.json(undefined));
  t("json(undefined) -> null", (await res.text()) === "null");
}

// ---- text / html
{
  let res = await run((c) => c.text("Hello, world!"));
  t(
    "text",
    res.status === 200 &&
      res.headers.get("content-type") === "text/plain; charset=utf-8" &&
      (await res.text()) === "Hello, world!",
  );
  res = await run((c) => c.html("<h1>hi</h1>", 201));
  t(
    "html",
    res.status === 201 &&
      res.headers.get("content-type") === "text/html; charset=utf-8" &&
      (await res.text()) === "<h1>hi</h1>",
  );
  res = await run((c) => c.text("", 204));
  t(
    "204 has no body and doesn't throw",
    res.status === 204 && res.body === null,
  );
}

// ---- redirect
{
  let res = await run((c) => c.redirect("/new-url"));
  t(
    "redirect default 302 + relative Location",
    res.status === 302 &&
      res.headers.get("location") === "/new-url" &&
      res.body === null,
  );
  res = await run((c) => c.redirect("https://example.com/a?b=1", 301));
  t(
    "redirect 301 absolute",
    res.status === 301 &&
      res.headers.get("location") === "https://example.com/a?b=1",
  );
  res = await run((c) => c.redirect(new URL("https://example.com/u"), 308));
  t(
    "redirect URL object",
    res.status === 308 &&
      res.headers.get("location") === "https://example.com/u",
  );
  t(
    "redirect invalid status",
    errName(() => new Context(new Request("http://x/")).redirect("/x", 200)) ===
      "RangeError",
  );
  t(
    "redirect header injection throws",
    errName(() =>
      new Context(new Request("http://x/")).redirect("/x\r\nSet-Cookie: a=b"),
    ) === "TypeError",
  );
  res = await run((c) => {
    c.cookies.set("flash", "hi");
    c.headers.set("x-a", "b");
    return c.redirect("/dest", 303);
  });
  t(
    "redirect gets cookies/headers",
    res.status === 303 &&
      res.headers.get("x-a") === "b" &&
      res.headers.getSetCookie()[0] === "flash=hi; Path=/",
  );
}

// ---- success / error
{
  let res = await run((c) => c.success());
  t(
    "success()",
    res.status === 200 && (await res.text()) === '{"success":true}',
  );
  res = await run((c) => c.success({ id: 1 }, 201));
  t(
    "success(data, 201)",
    res.status === 201 &&
      (await res.text()) === '{"success":true,"data":{"id":1}}',
  );
  res = await run((c) => c.error());
  t(
    "error()",
    res.status === 500 &&
      (await res.text()) ===
        '{"success":false,"error":"Internal Server Error"}',
  );
  res = await run((c) => c.error("Not allowed", 403));
  t(
    "error(message, status)",
    res.status === 403 &&
      (await res.text()) === '{"success":false,"error":"Not allowed"}',
  );
  res = await run((c) =>
    c.error("Bad", { status: 422, headers: { "x-e": "1" } }),
  );
  t(
    "error(message, ResponseInit)",
    res.status === 422 && res.headers.get("x-e") === "1",
  );
  res = await run((c) =>
    c.error("No status in init", { headers: { "x-e": "1" } }),
  );
  t("error with init but no status -> 500", res.status === 500);
}

// ---- ctx.headers wins over the response's own header (documented)
{
  const res = await run((c) => {
    c.headers.set("Content-Type", "application/vnd.custom+json");
    return c.json({ ok: true });
  });
  t(
    "ctx.headers Content-Type wins over json()",
    res.headers.get("content-type") === "application/vnd.custom+json",
  );
}

// ---- properties
{
  const r = Router();
  let seen: Context | undefined;
  r.get("/a/:id", () => {
    const c = r.context();
    seen = c;
    t("context() same object every call", r.context() === c);
    t("instanceof Context", c instanceof Context);
    t(
      "headers/cookies are properties (same object)",
      c.headers === c.headers && c.cookies === c.cookies,
    );
    t(
      "url/query/method/params/pathname/basePath",
      c.url.href === "http://x.com/a/7?q=1" &&
        c.query.get("q") === "1" &&
        c.method === "GET" &&
        c.params.id === "7" &&
        c.pathname === "/a/7" &&
        c.basePath === "",
    );
    t(
      "request cookies readable",
      c.cookies.get("s") === "1" && c.cookies.has("s"),
    );
    return c.text("ok");
  });
  await r.fetch(
    new Request("http://x.com/a/7?q=1", { headers: { cookie: "s=1" } }),
  );
  t("handler ran", seen !== undefined);
  t(
    "method is upper-cased",
    new Context(new Request("http://x/", { method: "post" })).method === "POST",
  );
}

// ---- store: AsyncLocalStorage across awaits and concurrent requests; throws outside
{
  const r = Router();
  r.get("/c/:n", async () => {
    const n = r.context().params.n;
    await new Promise((x) => setTimeout(x, 30 - +n * 10));
    await Promise.resolve();
    r.context().headers.set("x-n", n);
    return r.context().text(n + ":" + r.context().params.n);
  });
  const rs = await Promise.all(
    [1, 2, 3].map((n) => r.fetch(new Request("http://x.com/c/" + n))),
  );
  const bodies = await Promise.all(rs.map((x) => x.text()));
  t(
    "concurrent requests keep their own context after await",
    bodies.join() === "1:1,2:2,3:3" &&
      rs.every((x, i) => x.headers.get("x-n") === String(i + 1)),
    bodies.join(),
  );
  t(
    "context() outside a request throws",
    errName(() => r.context()) === "Error",
  );
}

process.exitCode = fail;
