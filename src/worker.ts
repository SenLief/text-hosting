import { Hono } from "hono";
import { app as apiApp, Env as RouterEnv } from "./router";
import { HttpError } from "./errors";

interface WorkerEnv extends RouterEnv {
  ASSETS: { fetch: typeof fetch };
}

const workerApp = new Hono<{ Bindings: WorkerEnv }>();

workerApp.route("/", apiApp);

workerApp.all("*", async (c) => {
  const assetResponse = await c.env.ASSETS.fetch(c.req.raw);

  if (
    assetResponse.status === 404 &&
    c.req.method === "GET" &&
    (c.req.header("accept") ?? "").includes("text/html")
  ) {
    const indexUrl = new URL("/index.html", c.req.url);
    return c.env.ASSETS.fetch(new Request(indexUrl, c.req.raw));
  }

  return assetResponse;
});

workerApp.onError((err, c) => {
  if (err instanceof HttpError) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: err.status,
      headers: { "content-type": "application/json" },
    });
  }
  console.error(err);
  return new Response(JSON.stringify({ error: "Internal Server Error" }), {
    status: 500,
    headers: { "content-type": "application/json" },
  });
});

export default workerApp;
