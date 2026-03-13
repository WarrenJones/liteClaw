import { serve } from "@hono/node-server";
import { Hono } from "hono";

import { config } from "./config.js";
import feishuRouter from "./routes/feishu.js";

const app = new Hono();

app.get("/healthz", (c) => {
  return c.json({
    ok: true,
    service: "liteclaw",
    timestamp: new Date().toISOString()
  });
});

app.route("/feishu", feishuRouter);

app.notFound((c) => {
  return c.json({ code: 404, msg: "Not Found" }, 404);
});

serve(
  {
    fetch: app.fetch,
    hostname: config.host,
    port: config.port
  },
  (info) => {
    console.log(
      `LiteClaw server listening on http://${info.address}:${info.port}`
    );
  }
);
