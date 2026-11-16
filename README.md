# xanout

Tiny router for the web-standard `Request` / `Response` API. Middleware, params, cookies, response headers, static files and a request-scoped context, in one small package. Server-only: runs on Node 18+, Bun and Deno (Cloudflare Workers with `nodejs_compat`).

- One dependency: [`regexparam`](https://github.com/lukeed/regexparam)
- Handlers take a single argument: `next`
- Request context from anywhere with `route.context()`
- `route.fetch(request)` takes a web `Request`; `toRequest` / `toResponse` convert to and from Node-style servers (Express, Fastify, Koa, ...)

## Install

```sh
npm i xanout
```

## Quick start

```ts
import { Router } from "xanout";

const route = Router();

route.use((next) => {
  // runs for every request
  return next();
});

route.use("/api", (next) => {
  // runs for /api and everything under it
  return next();
});

route.get("/", () => new Response("Hello World"));

route.get("/users/:id", () => {
  const { params } = route.context();
  return Response.json({ id: params.id });
});

const res = await route.fetch(new Request("http://localhost/users/42"));
// res is a Response, or undefined when nothing handled the request
```

### Use as a server

```ts
const notFound = () => new Response("Not Found", { status: 404 });

export default { fetch: async (req: Request) => (await route.fetch(req)) ?? notFound() }; // Bun, Workers, `deno serve`
Bun.serve({ fetch: async (req) => (await route.fetch(req)) ?? notFound() });              // Bun
Deno.serve(async (req) => (await route.fetch(req)) ?? notFound());                        // Deno
```

`route.fetch()` resolves to `undefined` when nothing handled the request. There is no built-in 404: you decide what happens next.

## Routes

`get`, `post`, `put`, `patch`, `delete`, `head`, `options`, `all`.  
`HEAD` requests fall through to `get` routes. If no route answers, `route.fetch()` resolves to `undefined`.

Patterns come from `regexparam`:

```ts
route.get("/posts/:id?", ...)   // optional param
route.get("/files/*", ...)      // wildcard -> route.context().params["*"]
```

Params are URL-decoded.
If a captured parameter contains invalid percent-encoding, the request receives `400 Bad Request`.

## Middleware

A handler either returns a `Response` (stops the chain) or calls `next()`.

```ts
// run code before and after the route
route.use(async (next) => {
  const t = Date.now();
  const res = await next();           // Response, or undefined if no route matched
  res?.headers.set("x-time", String(Date.now() - t));
  return res;
});

// auth on a prefix
route.use("/admin", (next) => {
  if (route.context().request.headers.get("authorization") !== "Bearer secret")
    return new Response("Unauthorized", { status: 401 });
  return next();
});

// error handling (uncaught errors otherwise become a plain 500)
route.use(async (next) => {
  try { return await next(); }
  catch (e) { return Response.json({ error: (e as Error).message }, { status: 500 }); }
});
```

If a middleware calls `next()` without returning it, the downstream response is still used.

**Call order is fixed, wherever you declare things.** For every request:

1. static: `static(...)`, served before any middleware
2. middleware: `use(handler)` and `use(path, handler)`
3. mounted routers: `use(router)` and `use(path, router)`
4. routes: `get`, `post`, ..., `all`, and routers passed to a verb such as `post(path, router)`

Each group keeps the order you declared it in. Static comes first so asset requests (a page load fetches many) don't run your middleware; a static miss continues to middleware and routes. Each request runs each middleware once. So `route.use("/admin", auth)` declared after `route.get("/admin/stats", ...)` still protects that route, and a mounted router wins over a route with the same path. If the mounted router has no match, routing continues to your routes.

## Sub-routers

Pass another `Router` to `use`, or to any method, to mount it. The sub-router sees paths with the mount prefix removed.

```ts
const api = Router();
api.use((next) => next());                          // only runs for /api/...
api.get("/users/:id", () => Response.json({ id: route.context().params.id }));

const route = Router();
route.use("/api", api);                             // GET /api/users/42
route.use("/orgs/:org", membersRouter);             // params from the prefix are available in the sub-router
route.post("/users", usersRouter);                  // only POST requests reach usersRouter
route.use(otherRouter);                             // mount at the root
```

- If the sub-router doesn't handle the request, or its middleware calls `next()` past its last layer, routing continues with the parent's next routes.
- Sub-routers share the request's context, cookies and headers, so `route.context()` works in any of them.
- Inside a sub-router, `ctx.pathname` is relative to it and `ctx.basePath` is the prefix removed so far (full path = `basePath + pathname`; `ctx.request.url` is the original).
- `static()` inside a sub-router is relative to its mount: `sub.static("/assets", { dir: "./public" })` mounted at `/v1` serves `/v1/assets/...`. It runs first inside that sub-router, after the parent's middleware.
- A router can't be mounted on itself.

## Context

`route.context()` returns the `Context` of the request being handled, from anywhere: handlers, middleware, or code they call. It is stored with `AsyncLocalStorage`, so it stays correct across `await` and overlapping requests. Calling it outside a request throws.

```ts
const ctx = route.context();

ctx.request;    // the original Request
ctx.method;     // "GET"
ctx.url;        // URL
ctx.query;      // URLSearchParams
ctx.params;     // { id: "42" }
ctx.pathname;   // "/users/42" (relative to the router handling it)
ctx.basePath;   // mount prefix removed so far, "" at the top level
ctx.headers;    // response Headers
ctx.cookies;    // request cookies + queued response cookies
ctx.states;     // Map<string, unknown> for request-scoped state
```

Use `ctx.states.set(key, value)`, `ctx.states.get(key)`, `ctx.states.delete(key)`, and `ctx.states.clear()` to manage state for the current request.

### Responses

These return a standard `Response`. The second argument is a status code or a full `ResponseInit` (`status`, `statusText`, `headers`).

```ts
ctx.json({ message: "Hello, world!" });       // application/json
ctx.json(data, 201);
ctx.text("Hello, world!");                    // text/plain
ctx.html("<h1>Hello</h1>");                   // text/html
ctx.redirect("/new-url");                     // 302; also 301, 303, 307, 308
ctx.redirect("https://example.com", 301);

ctx.success();                                // { "success": true }
ctx.success({ id: 1 }, 201);                  // { "success": true, "data": { "id": 1 } }
ctx.error();                                  // 500 { "success": false, "error": "Internal Server Error" }
ctx.error("Not allowed", 403);                // 403 { "success": false, "error": "Not allowed" }
```

```ts
route.get("/hello", () => {
  const ctx = route.context();
  ctx.headers.set("X-Request-Id", crypto.randomUUID());
  ctx.cookies.set("session", "abc123");
  return ctx.json({ message: "Hello, world!" });
});
```

A status of 204, 205 or 304 sends no body. `redirect` throws for any other status, and for a URL that isn't a valid header value (for example one containing a line break).

### Response headers

`ctx.headers` is a standard `Headers` object for the **response**. It is merged into whatever `Response` your handler returns, and wins over a header with the same name on that response, including `ctx.json()`'s own `Content-Type`. (Request headers: `ctx.request.headers`.)

```ts
route.use((next) => {
  route.context().headers.set("x-request-id", crypto.randomUUID());
  return next();
});
```

### Cookies

```ts
const cookies = route.context().cookies;

cookies.get("theme");     // from the request Cookie header
cookies.has("sid");
cookies.all();            // { theme: "dark", ... }

cookies.set("sid", "abc123", {
  httpOnly: true,
  secure: true,
  sameSite: "lax",        // "lax" | "strict" | "none"
  maxAge: 3600,           // seconds
  // path (default "/"), domain, expires, partitioned
});

cookies.delete("old");    // sends an expired cookie (pass the same path/domain it was set with)
```

`get` / `has` / `all` reflect changes made earlier in the same request. Setting the same cookie twice sends only the last one. Invalid cookie names, or paths/domains containing `;` or line breaks, throw. `sameSite: "none"` is not checked for `secure`: browsers require it.

Headers and cookies are applied to your handler's response, static and custom handler responses, and immutable responses such as `Response.redirect()`. A request that ends in an uncaught error gets a plain 500 without them.

### Cookie helpers

`Cookie.parse` and `Cookie.serialize` work on their own, with or without a router.

```ts
import { Cookie } from "xanout";

Cookie.parse("theme=dark; sid=abc%20123");
// { theme: "dark", sid: "abc 123" }

Cookie.serialize("sid", "abc 123", { httpOnly: true, sameSite: "lax", maxAge: 3600 });
// "sid=abc%20123; Path=/; Max-Age=3600; HttpOnly; SameSite=Lax"

// e.g. in your own response
new Response("ok", { headers: { "Set-Cookie": Cookie.serialize("a", "1") } });
```

- `parse(header)` accepts `null` or `undefined` (returns `{}`). Values are URL-decoded, and the first occurrence of a name wins.
- `serialize(name, value, options?)` takes the same options as `cookies.set()` and throws on an invalid name.

## Static files

`static` serves files only. It has no `next`: a static handler returns a `Response`, or `undefined` when it has nothing, and routing continues. It handles `GET` (and `HEAD`) requests.

```ts
route.static("/", { dir: "./public" });                    // ./public at /
route.static("/assets", { dir: "./dist", maxAge: 31536000, immutable: true });

route.static("/files", () => {                             // your own handler for a path
  const { pathname } = route.context();                    // "/a.txt" for GET /files/a.txt
  return pathname === "/a.txt" ? new Response("custom") : undefined;
});
route.static(() => { /* handler for every path */ return undefined; });
```

- `static(path, config)`: `path` is the URL it is served under, `config.dir` the folder.
- `static(path, handler)` and `static(handler)`: a handler with no arguments. Read the request with `route.context()`; `ctx.pathname` is relative to `path`, and `ctx.basePath` is `path`.
- Anything else throws a `TypeError`.

Directories serve `index.html`. Supports `ETag` / `If-None-Match` (304), `Range` requests, `HEAD`, and about 30 common content types. Path traversal is blocked, and dotfiles are hidden.

| Config                 | Meaning                               | Default        |
| ---------------------- | ------------------------------------- | -------------- |
| `dir`                  | Folder to serve (required)            |                |
| `index`                | Directory index file, or `false`      | `"index.html"` |
| `dotfiles`             | Serve files/folders starting with `.` | `false`        |
| `maxAge`               | `Cache-Control: max-age` (seconds)    | `0`            |
| `sMaxAge`              | `s-maxage` (CDNs)                     | none           |
| `immutable`            | add `immutable`                       | `false`        |
| `visibility`           | `"public"` or `"private"`             | `"public"`     |
| `noCache`              | add `no-cache`                        | `false`        |
| `noStore`              | send only `no-store`                  | `false`        |
| `mustRevalidate`       | add `must-revalidate`                 | `false`        |
| `staleWhileRevalidate` | `stale-while-revalidate` (seconds)    | none           |

`static` with `dir` reads from the file system (Node, Bun, Deno). It is not available on Cloudflare Workers. Symlinks inside the served folder are followed.

Coming from Express:

```ts
// app.use(`/${outdirs.client}`, express.static(outdirs.client, { maxAge: "1y", immutable: true, etag: true }))
route.static(`/${outdirs.client}`, { dir: outdirs.client, maxAge: 31536000, immutable: true }); // ETag is always on

// app.use("/__xmod", express.static(outdirs.module_cache))
route.static("/__xmod", { dir: outdirs.module_cache });
```

## Frameworks and runtimes

`route.fetch(request)` takes a web `Request` only (anything else throws a `TypeError`) and resolves to a web `Response`, or `undefined` when nothing handled it. For Node-style servers, convert in with `toRequest` and out with `toResponse`.

**Runtimes and frameworks that already use `Request` / `Response`**:

```ts
const notFound = () => new Response("Not Found", { status: 404 });

export default { fetch: async (req: Request) => (await route.fetch(req)) ?? notFound() }; // Bun, Workers, `deno serve`
Bun.serve({ fetch: async (req) => (await route.fetch(req)) ?? notFound() });              // Bun

// Hono: fall through to the next handler
app.all("*", async (c, next) => (await route.fetch(c.req.raw)) ?? next());
```

**Node-style servers** (Node `http`, Express, Fastify, Koa, ...) need the request converted and the response written back: `toRequest(req)` and `toResponse(res, response)`. `toResponse` returns `false` (touching nothing) when `route.fetch` gave `undefined`, so you can fall through:

```ts
import { toRequest, toResponse } from "xanout";

// Node http
http.createServer(async (req, res) => {
  if (!(await toResponse(res, await route.fetch(toRequest(req))))) { res.statusCode = 404; res.end("Not Found"); }
}).listen(3000);

// Express
app.use(async (req, res, next) => { if (!(await toResponse(res, await route.fetch(toRequest(req))))) next(); });

// Fastify
app.all("/*", async (req, reply) => { if (!(await toResponse(reply, await route.fetch(toRequest(req))))) return reply.callNotFound(); });

// Koa
app.use(async (ctx) => { if (!(await toResponse(ctx, await route.fetch(toRequest(ctx))))) { ctx.status = 404; ctx.body = "Not Found"; } });
```

`toResponse(target, response)` accepts a Node `ServerResponse` (http, Express, Connect), a Fastify reply or a Koa context. It streams the body with backpressure, stops if the client disconnects, and sends multiple `Set-Cookie` headers correctly. It returns `false` without touching the target when `response` is `undefined`, and `true` after handling a response. Stream/write errors are rethrown after destroying the response. For Fastify it takes over the raw response and keeps headers already set on the reply (for example by `@fastify/cors`). For Koa it sets `ctx.respond = false`.

### toRequest

`toRequest(input, options?)` converts a Node-style request into a web `Request`. Pass options when you need them:

```ts
import { toRequest } from "xanout";

const request = toRequest(req, { baseUrl: "https://api.example.com" });
```

It accepts:

| Input                                                                                                            | Result                                 |
| ---------------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| Web `Request` (Bun, Deno, Workers, Next.js app router, ...)                                                      | returned as is                         |
| Context wrapping one: Hono `c`, `{ request }` (SvelteKit, Astro, Remix, Elysia, Cloudflare Pages), h3 v2 `event` | the wrapped `Request`                  |
| Node request: `http`, Express, Connect, Polka, Next.js pages API, Nest                                           | converted                              |
| Fastify `request`, Koa `ctx`, h3 v1 `event`                                                                      | converted from the Node request inside |
| anything else (for example an AWS Lambda event)                                                                  | throws `TypeError`                     |

Tested here: Node `http`, Express 5, Fastify 5, Koa 3, Hono 4 and Bun. The others use the same shapes but are not tested.

- **Body:** streamed. If a body parser has consumed the Node request, the body is rebuilt from `rawBody` when present, otherwise from the framework's parsed `body`. JSON-compatible objects are serialized as JSON; URL-encoded bodies become form data. Nested form fields can't be restored exactly: use `rawBody` or leave the stream unread. A consumed body is included only when the request declares a body using `content-length` or `transfer-encoding`.
- **URL:** an absolute HTTP(S) URL is kept as-is; otherwise the origin is built from the request protocol and `Host`/`:authority` headers, and the path comes from `originalUrl` or `url`. A `Host` that isn't a valid host name, IP, or `host:port` is replaced with `localhost`, and a path like `//evil.com` can't change the host. Normal Node request targets start with `/`.
- **Proxies:** `X-Forwarded-Proto` / `X-Forwarded-Host` are ignored unless you pass `trustProxy: true`. `baseUrl` overrides the origin completely.
- **HTTP/2:** pseudo-headers (`:path`, `:authority`, ...) are not copied into the headers.
- **Fastify** rejects content types it has no parser for (for example form posts) with a 415 before your code runs. To pass every body through untouched:

```ts
app.removeAllContentTypeParsers();
app.addContentTypeParser("*", (_req, _payload, done) => done(null));
```

## API

```ts
Router(): Router

route.use(handlerOrRouter)
route.use(path, handlerOrRouter)    // prefix match; a Router is mounted under the prefix
route.get | post | put | patch | delete | head | options | all (path, handlerOrRouter)
route.static(path, { dir, ...cacheOptions })
route.static(path, handler)
route.static(handler)
route.context(): Context
route.fetch(request: Request): Promise<Response | undefined>

toRequest(nodeRequest, { baseUrl?, trustProxy? }?): Request
toResponse(nodeResponse, response: Response | undefined): Promise<boolean>   // false = nothing written

type StaticHandler = () => Response | undefined | Promise<Response | undefined>
type Handler = (next: () => Promise<Response | undefined>) => Response | void | Promise<Response | void>
```

All registration methods return the router, so calls can be chained.

## License

MIT