import express from "express";
import { Router } from "./src/index";
const app = express();
const router = Router();

router.get("/", () => {
  console.log("called");
  const ctx = router.context();
  console.log(ctx.states);

  return new Response("Hello World");
});

router.use((next) => {
  console.log("Middleware executed");
  const ctx = router.context();
  ctx.states.set("name", "value");
  next();
});

router.static("/", {
  dir: "public",
});

export function toWebRequest(req: express.Request): Request {
  const protocol = req.protocol;
  const host = req.get("host") || "localhost";
  const url = new URL(req.originalUrl || req.url, `${protocol}://${host}`);

  const headers = new Headers();

  for (const [key, value] of Object.entries(req.headers)) {
    if (Array.isArray(value)) {
      value.forEach((v) => headers.append(key, v));
    } else if (value !== undefined) {
      headers.set(key, value);
    }
  }

  const method = req.method.toUpperCase();
  const init: RequestInit = {
    method,
    headers,
  };

  if (req.body) {
    init.body = req.body;
    (init as any).duplex = "half";
  }

  return new Request(url, init);
}

app.use(async (req, res, next) => {
  const response = await router.fetch(toWebRequest(req));
  if (response instanceof Response) {
    response.headers.forEach((value, key) => {
      res.setHeader(key, value);
    });
    res.status(response.status);
    response.text().then((body) => res.send(body));
  } else {
    next();
  }
});

app.listen(3000, () => {
  console.log(`Server is running at http://localhost:3000`);
});
