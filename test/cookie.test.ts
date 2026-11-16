import { Cookie, Router } from "../src/index";

let fail = 0;
const t = (label: string, ok: boolean, info = "") => {
  console.log(ok ? "PASS" : "FAIL", label, ok ? "" : info);
  if (!ok) fail = 1;
};
const eq = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const throws = (fn: () => unknown) => {
  try {
    fn();
    return "";
  } catch (e) {
    return (e as Error).constructor.name;
  }
};

// ---- parse
t("parse basic", eq({ ...Cookie.parse("a=1; b=2") }, { a: "1", b: "2" }));
t(
  "parse decodes + trims",
  eq(
    { ...Cookie.parse("  sid = abc%20123 ;theme=dark") },
    { sid: "abc 123", theme: "dark" },
  ),
);
t("parse quoted value", eq({ ...Cookie.parse('a="hello"') }, { a: "hello" }));
t(
  "parse bad encoding keeps raw",
  eq({ ...Cookie.parse("a=%E0%A4%A") }, { a: "%E0%A4%A" }),
);
t("parse first wins", eq({ ...Cookie.parse("a=1; a=2") }, { a: "1" }));
t("parse value with =", eq({ ...Cookie.parse("t=a=b=c") }, { t: "a=b=c" }));
t(
  "parse ignores parts without =",
  eq({ ...Cookie.parse("junk; a=1") }, { a: "1" }),
);
t(
  "parse null/undefined/empty",
  eq({ ...Cookie.parse(null) }, {}) &&
    eq({ ...Cookie.parse(undefined) }, {}) &&
    eq({ ...Cookie.parse("") }, {}),
);
t(
  "parse __proto__ is harmless",
  ({} as any).polluted === undefined &&
    Object.getPrototypeOf(Cookie.parse("__proto__=x; polluted=1")) === null,
);
t("parse missing name -> undefined", Cookie.parse("a=1").nope === undefined);

// ---- serialize
t("serialize default", Cookie.serialize("a", "1") === "a=1; Path=/");
t(
  "serialize encodes value",
  Cookie.serialize("a", "x y;z") === "a=x%20y%3Bz; Path=/",
);
t(
  "serialize all options",
  Cookie.serialize("sid", "v", {
    path: "/app",
    domain: "example.com",
    maxAge: 3600.9,
    expires: new Date(Date.UTC(2030, 0, 2, 3, 4, 5)),
    httpOnly: true,
    secure: true,
    sameSite: "strict",
    partitioned: true,
  }) ===
    "sid=v; Path=/app; Domain=example.com; Max-Age=3600; Expires=Wed, 02 Jan 2030 03:04:05 GMT; HttpOnly; Secure; SameSite=Strict; Partitioned",
  Cookie.serialize("sid", "v", {
    path: "/app",
    domain: "example.com",
    maxAge: 3600.9,
    httpOnly: true,
    secure: true,
    sameSite: "strict",
    partitioned: true,
  }),
);
t(
  "serialize sameSite none/lax",
  Cookie.serialize("a", "1", { sameSite: "none" }).endsWith("SameSite=None") &&
    Cookie.serialize("a", "1", { sameSite: "lax" }).endsWith("SameSite=Lax"),
);
t(
  "serialize maxAge 0",
  Cookie.serialize("a", "", { maxAge: 0 }) === "a=; Path=/; Max-Age=0",
);
t(
  "serialize invalid name throws",
  throws(() => Cookie.serialize("bad name", "v")) === "TypeError",
);
t(
  "serialize empty name throws",
  throws(() => Cookie.serialize("", "v")) === "TypeError",
);
t(
  "serialize header injection in path throws",
  throws(() => Cookie.serialize("a", "1", { path: "/x; Secure" })) ===
    "TypeError",
);
t(
  "serialize header injection in domain throws",
  throws(() => Cookie.serialize("a", "1", { domain: "a.com\r\nX: y" })) ===
    "TypeError",
);

// ---- round trip
const sv = 'héllo wörld; =,"';
t("round trip", Cookie.parse(Cookie.serialize("k", sv).split(";")[0]).k === sv);

// ---- consistent with cookies() in a router
const r = Router();
r.get("/", () => {
  r.context().cookies.set("a", "x y", { httpOnly: true, maxAge: 60 });
  return new Response("ok");
});
const res = await r.fetch(new Request("http://x.com/"));
t(
  "same output as ctx.cookies.set",
  res.headers.getSetCookie()[0] ===
    Cookie.serialize("a", "x y", { httpOnly: true, maxAge: 60 }),
);

process.exitCode = fail;
