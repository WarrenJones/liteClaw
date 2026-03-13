import { serve } from "@hono/node-server";
import { Hono } from "hono";

import { config } from "./config.js";
import feishuRouter from "./routes/feishu.js";
import {
  getConversationStoreStatus,
  initializeConversationStore
} from "./services/conversation-store.js";
import { logError, logInfo } from "./services/logger.js";
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
  logInfo("bootstrap.store_initialized", {
    storage: getConversationStoreStatus()
  });

  serve(
    {
      fetch: app.fetch,
      hostname: config.host,
      port: config.port
    },
    (info) => {
      logInfo("bootstrap.server_listening", {
        address: info.address,
        port: info.port
      });
    }
  );

  if (config.feishu.connectionMode === "long-connection") {
    await startFeishuLongConnection(scheduleFeishuMessageEvent);
    logInfo("bootstrap.feishu_long_connection_initialized");
    return;
  }

  logInfo("bootstrap.feishu_webhook_mode_enabled");
}

void bootstrap().catch((error) => {
  logError("bootstrap.failed", { error });
  process.exitCode = 1;
});
