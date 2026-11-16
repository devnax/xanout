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

// ---- static(path, { dir }) at root
{
  const r = Router();
  r.static("/", { dir: PUB });
  let res = (await go(r, "/app.css"))!;
  t("serves a file", res.status === 200 && (await res.text()) === "body{}\n");
  t("content-type", res.headers.get("content-type")!.startsWith("text/css"));
  t(
    "default cache-control",
    res.headers.get("cache-control") === "public, max-age=0",
  );
  res = (await go(r, "/sub/n.txt"))!;
  t("nested file", res.status === 200);
  res = (await go(r, "/"))!;
  t(
    "directory serves index.html",
    res.status === 200 &&
      res.headers.get("content-type")!.startsWith("text/html"),
  );
  t("missing file -> undefined", (await go(r, "/nope.css")) === undefined);
  t(
    "directory without index -> undefined",
    (await go(r, "/sub")) === undefined,
  );
  t(
    "path traversal -> undefined",
    (await go(r, "/..%2fsecret.txt")) === undefined,
  );
  t(
    "raw traversal -> undefined",
    (await go(r, "/../secret.txt")) === undefined,
  );
  t("dotfiles hidden", (await go(r, "/.hidden/secret.txt")) === undefined);
  t("bad encoding -> undefined", (await go(r, "/%E0%A4%A")) === undefined);
  t(
    "POST is not static",
    (await go(r, "/app.css", { method: "POST" })) === undefined,
  );
  res = (await go(r, "/app.css", { method: "HEAD" }))!;
  t(
    "HEAD",
    res.status === 200 &&
      res.headers.get("content-length") === "7" &&
      (await res.text()) === "",
  );
  const etag = (await go(r, "/app.css"))!.headers.get("etag")!;
  res = (await go(r, "/app.css", { headers: { "if-none-match": etag } }))!;
  t("ETag -> 304", res.status === 304 && (await res.text()) === "");
  res = (await go(r, "/app.css", { headers: { range: "bytes=0-3" } }))!;
  t(
    "Range",
    res.status === 206 &&
      (await res.text()) === "body" &&
      res.headers.get("content-range") === "bytes 0-3/7",
  );
  res = (await go(r, "/app.css", { headers: { range: "bytes=99-" } }))!;
  t("unsatisfiable Range -> 416", res.status === 416);
}

// ---- falls through to routes
{
  const r = Router();
  r.static("/", { dir: PUB });
  r.get("/dynamic", () => new Response("dynamic"));
  t(
    "static miss falls through to route",
    (await (await go(r, "/dynamic"))!.text()) === "dynamic",
  );
}

// ---- prefix + options
{
  const r = Router();
  r.static("/assets", {
    dir: PUB,
    dotfiles: true,
    maxAge: 31536000,
    immutable: true,
  });
  const res = (await go(r, "/assets/app.css"))!;
  t("prefix serves", res.status === 200);
  t(
    "maxAge/immutable",
    res.headers.get("cache-control") === "public, max-age=31536000, immutable",
    res.headers.get("cache-control")!,
  );
  t("outside prefix -> undefined", (await go(r, "/app.css")) === undefined);
  t(
    "prefix boundary (/assetsX)",
    (await go(r, "/assetsX/app.css")) === undefined,
  );
  t(
    "dotfiles: true serves",
    (await go(r, "/assets/.hidden/secret.txt"))!.status === 200,
  );
  t(
    "trailing slash in path normalised",
    (await go(
      (() => {
        const x = Router();
        x.static("/assets/", { dir: PUB });
        return x;
      })(),
      "/assets/app.css",
    ))!.status === 200,
  );
  t(
    "path without leading slash normalised",
    (await go(
      (() => {
        const x = Router();
        x.static("assets", { dir: PUB });
        return x;
      })(),
      "/assets/app.css",
    ))!.status === 200,
  );
}

// ---- cache-control options
{
  const cc = async (o: object) => {
    const x = Router();
    x.static("/", { dir: PUB, ...o });
    return (await go(x, "/app.css"))!.headers.get("cache-control");
  };
  t("noStore", (await cc({ noStore: true })) === "no-store");
  t("noCache", (await cc({ noCache: true })) === "public, no-cache, max-age=0");
  t(
    "private + sMaxAge + swr + mustRevalidate",
    (await cc({
      visibility: "private",
      maxAge: 60,
      sMaxAge: 120,
      staleWhileRevalidate: 30,
      mustRevalidate: true,
    })) ===
      "private, max-age=60, s-maxage=120, stale-while-revalidate=30, must-revalidate",
  );
  const x = Router();
  x.static("/", { dir: PUB, index: false });
  t("index: false -> undefined", (await go(x, "/")) === undefined);
}

// ---- custom handlers: static(handler) and static(path, handler)
{
  const r = Router();
  r.static((): Response | undefined => {
    const c = r.context();
    return c.pathname === "/hello.txt"
      ? new Response("root handler")
      : undefined;
  });
  t(
    "static(handler) answers",
    (await (await go(r, "/hello.txt"))!.text()) === "root handler",
  );
  t(
    "static(handler) undefined -> continues",
    (await go(r, "/other.txt")) === undefined,
  );
  r.get("/other.txt", () => new Response("route"));
  t(
    "static(handler) undefined -> route",
    (await (await go(r, "/other.txt"))!.text()) === "route",
  );

  const seen: string[] = [];
  const r2 = Router();
  r2.static("/files", () => {
    const c = r2.context();
    seen.push(`${c.pathname}|${c.basePath}`);
    return c.pathname === "/a.txt"
      ? new Response("custom " + c.pathname)
      : undefined;
  });
  t(
    "static(path, handler)",
    (await (await go(r2, "/files/a.txt"))!.text()) === "custom /a.txt",
  );
  t("relative pathname + basePath", seen[0] === "/a.txt|/files", seen[0]);
  t(
    "handler not called outside its path",
    (await go(r2, "/other/a.txt")) === undefined && seen.length === 1,
  );
  t(
    "handler undefined -> undefined",
    (await go(r2, "/files/zzz")) === undefined,
  );
  t(
    "handler is GET only",
    (await go(r2, "/files/a.txt", { method: "POST" })) === undefined,
  );

  const r3 = Router();
  r3.static("/files/:id", () => new Response("id=" + r3.context().params.id));
  t(
    "static path params",
    (await (await go(r3, "/files/42"))!.text()) === "id=42",
  );

  const r4 = Router();
  r4.static("/", async () => new Response("async"));
  t(
    "async static handler",
    (await (await go(r4, "/anything"))!.text()) === "async",
  );
}

// ---- argument validation
{
  const r = Router() as any;
  const err = (fn: () => void) => {
    try {
      fn();
    } catch (e) {
      return (e as Error).constructor.name;
    }
    return "";
  };
  t("static() throws", err(() => r.static()) === "TypeError");
  t("static(path) throws", err(() => r.static("/a")) === "TypeError");
  t(
    "static(path, {}) throws (no dir)",
    err(() => r.static("/a", {})) === "TypeError",
  );
  t("static(123) throws", err(() => r.static(123)) === "TypeError");
  t(
    "static(dirString) throws (old API)",
    err(() => r.static(PUB)) === "TypeError",
  );
}

process.exitCode = fail;
