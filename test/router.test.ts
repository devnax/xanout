import { Router } from "../src/index";

const route = Router();
const log: string[] = [];

route.use((next) => {
  log.push("global");
  return next();
});

route.use("/api", (next) => {
  log.push("api-mw");
  next();
});

route.get("/", () => new Response("Hello World"));
route.get("/users/:id", () => Response.json({ id: route.context().params.id }));
route.get("/api/files/*", () => new Response(route.context().params["*"]));
route.post("/users", () => new Response("created", { status: 201 }));

const none = async (label: string, p: Promise<Response | undefined>) => {
  const r = await p;
  const ok = r === undefined;
  console.log(ok ? "PASS" : "FAIL", label, ok ? "undefined" : r!.status);
  if (!ok) process.exitCode = 1;
};
const check = async (
  label: string,
  p: Promise<Response | undefined>,
  status: number,
  body: string,
) => {
  const r = (await p)!;
  const t = await r.text();
  const ok = r.status === status && t === body;
  console.log(ok ? "PASS" : "FAIL", label, r.status, t);
  if (!ok) process.exitCode = 1;
};

await check(
  "root",
  route.fetch(new Request("http://x.com/", { method: "GET" })),
  200,
  "Hello World",
);
await check(
  "param",
  route.fetch(new Request("http://x.com/users/42", { method: "GET" })),
  200,
  '{"id":"42"}',
);
await check(
  "post",
  route.fetch(new Request("http://x.com/users", { method: "POST" })),
  201,
  "created",
);
await none(
  "method mismatch -> undefined",
  route.fetch(new Request("http://x.com/users/42", { method: "POST" })),
);
await none(
  "no match -> undefined",
  route.fetch(new Request("http://x.com/nope", { method: "GET" })),
);
await check(
  "request obj",
  route.fetch(new Request("http://x.com/users/7?a=1")),
  200,
  '{"id":"7"}',
);
await check(
  "malformed encoded param -> 400",
  route.fetch(new Request("http://x.com/users/%E0%A4%A")),
  400,
  "Bad Request",
);
await check(
  "api prefix mw + route",
  route.fetch(new Request("http://x.com/api/files/a/b", { method: "GET" })),
  200,
  "a/b",
);
route.get("/slow/:n", async () => {
  await new Promise((r) =>
    setTimeout(r, 30 - Number(route.context().params.n) * 10),
  );
  return new Response(
    route.context().params.n + ":" + route.context().query.get("q"),
  );
});
const rs = await Promise.all(
  [1, 2, 3].map((n) =>
    route.fetch(new Request(`http://x.com/slow/${n}?q=${n * 7}`)),
  ),
);
const bodies = await Promise.all(rs.map((r) => r.text()));
const okc = bodies.join() === "1:7,2:14,3:21";
console.log(okc ? "PASS" : "FAIL", "concurrent ctx", bodies.join());
if (!okc) process.exitCode = 1;
try {
  route.context();
  console.log("FAIL outside");
  process.exitCode = 1;
} catch {
  console.log("PASS context outside request throws");
}
console.log(log);
