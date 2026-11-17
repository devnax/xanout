# xanout

**A tiny, lightweight router built on the Web-standard `Request` and `Response` APIs.**

[Website](https://xanout.devnax.com) · [npm](https://www.npmjs.com/package/xanout) · [Documentation](https://xanout.devnax.com/docs)

---

## Features

- **Lightweight** — Minimal footprint with just one dependency.
- **Web Standards** — Built around native `Request`, `Response`, and `Headers`.
- **Middleware** — Flexible middleware with `next()` support.
- **Sub-routers** — Mount routers with path prefixes.
- **Request Context** — Access request-scoped context from anywhere.
- **Cookies** — Built-in cookie management and serialization.
- **Static Files** — Serve static assets with caching support.
- **Framework Adapters** — Integrate with Express, Fastify, Koa, Hono, and more.
- **Multi-runtime** — Node.js, Bun, Deno, and Cloudflare Workers (`nodejs_compat`).

## Installation

```bash
npm install xanout
```

## Quick Start

```ts
import { Router } from "xanout";

const route = Router();

// Middleware
route.use((next) => {
  console.log("Request received");
  return next();
});

// Routes
route.get("/", () => {
  return new Response("Hello World");
});

route.get("/users/:id", () => {
  const { params } = route.context();

  return Response.json({ id: params.id });
});

// Handle requests
const response = await route.fetch(
  new Request("http://localhost/users/42")
);
```

## Documentation

Explore the documentation for installation guides, API references, middleware, adapters, examples, and advanced usage.

**[Read the Documentation →](https://xanout.devnax.com/docs)**

## License

MIT