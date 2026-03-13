import { serve } from "@hono/node-server";
import { Hono } from "hono";

import { config } from "./config.js";
import feishuRouter from "./routes/feishu.js";
import {
  getFeishuLongConnectionState,
  startFeishuLongConnection
} from "./services/feishu.js";
import { scheduleFeishuMessageEvent } from "./services/feishu-message-handler.js";

const app = new Hono();

app.get("/healthz", (c) => {
  return c.json({
    ok: true,
    service: "liteclaw",
    feishuConnectionMode: config.feishu.connectionMode,
    feishuLongConnection:
      config.feishu.connectionMode === "long-connection"
        ? getFeishuLongConnectionState()
        : undefined,
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

if (config.feishu.connectionMode === "long-connection") {
  void startFeishuLongConnection(scheduleFeishuMessageEvent)
    .then(() => {
      console.log("Feishu long connection client initialized");
    })
    .catch((error) => {
      console.error("Failed to start Feishu long connection", error);
      process.exitCode = 1;
    });
} else {
  console.log("Feishu webhook mode enabled");
}
