import { serve } from "@hono/node-server";
import { Hono } from "hono";

import { config } from "./config.js";
import feishuRouter from "./routes/feishu.js";
import {
  getConversationStoreStatus,
  initializeConversationStore
} from "./services/conversation-store.js";
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
    storage: getConversationStoreStatus(),
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

async function bootstrap(): Promise<void> {
  await initializeConversationStore();
  console.log("Conversation store initialized", getConversationStoreStatus());

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
    await startFeishuLongConnection(scheduleFeishuMessageEvent);
    console.log("Feishu long connection client initialized");
    return;
  }

  console.log("Feishu webhook mode enabled");
}

void bootstrap().catch((error) => {
  console.error("Failed to bootstrap LiteClaw", error);
  process.exitCode = 1;
});
