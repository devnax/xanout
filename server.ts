import express from "express";
import { Router } from "./src/index";
import { toRequest } from "./src/http";
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

app.use(async (req, res, next) => {
  const response = await router.fetch(toRequest(req));
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
