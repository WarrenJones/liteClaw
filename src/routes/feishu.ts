import { Hono } from "hono";

import { config } from "../config.js";
import {
  isWebhookConfigured,
  verifyWebhookToken
} from "../services/feishu.js";
import { scheduleFeishuMessageEvent } from "../services/feishu-message-handler.js";
import { logInfo, logWarn } from "../services/logger.js";
import {
  isEncryptedPayload,
  isEventPayload,
  isUrlVerificationPayload,
  normalizeWebhookEvent
} from "../types/feishu.js";

const router = new Hono();

router.post("/webhook", async (c) => {
  if (config.feishu.connectionMode !== "webhook" || !isWebhookConfigured()) {
    logWarn("feishu.webhook.request_rejected", {
      reason: "webhook_mode_disabled"
    });
    return c.json(
      {
        code: 405,
        msg: "Webhook mode is disabled. LiteClaw is configured to use Feishu long connection by default."
      },
      405
    );
  }

  const rawBody = await c.req.text();
  let payload: unknown;

  try {
    payload = JSON.parse(rawBody);
  } catch {
    logWarn("feishu.webhook.invalid_json");
    return c.json({ code: 400, msg: "Invalid JSON payload" }, 400);
  }

  if (isUrlVerificationPayload(payload)) {
    if (!verifyWebhookToken(payload.token)) {
      logWarn("feishu.webhook.invalid_verification_token");
      return c.json({ code: 401, msg: "Invalid verification token" }, 401);
    }

    logInfo("feishu.webhook.url_verification_succeeded");
    return c.json({ challenge: payload.challenge });
  }

  if (isEncryptedPayload(payload)) {
    logWarn("feishu.webhook.encrypted_payload_unsupported");
    return c.json(
      {
        code: 501,
        msg: "Encrypted Feishu events are not supported in this MVP. Disable event encryption first."
      },
      501
    );
  }

  if (!isEventPayload(payload)) {
    logWarn("feishu.webhook.unsupported_payload");
    return c.json({ code: 400, msg: "Unsupported Feishu payload" }, 400);
  }

  const { event, header } = payload;

  if (!verifyWebhookToken(header.token)) {
    logWarn("feishu.webhook.invalid_event_token", {
      eventType: header.event_type
    });
    return c.json({ code: 401, msg: "Invalid verification token" }, 401);
  }

  logInfo("feishu.webhook.event_received", {
    eventId: header.event_id,
    eventType: header.event_type,
    chatId: event.message.chat_id
  });
  scheduleFeishuMessageEvent(normalizeWebhookEvent(payload));

  return c.json({ code: 0 });
});

export default router;
