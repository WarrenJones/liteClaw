import { Hono } from "hono";

import { config } from "../config.js";
import {
  extractTextContent,
  sendTextMessage,
  verifyWebhookToken
} from "../services/feishu.js";
import { generateAssistantReply } from "../services/llm.js";
import { MemoryStore } from "../services/memory.js";
import {
  isEncryptedPayload,
  isEventPayload,
  isUrlVerificationPayload
} from "../types/feishu.js";

const router = new Hono();
const memoryStore = new MemoryStore(
  config.sessionMaxTurns,
  config.eventDedupeTtlMs
);

function isResetCommand(text: string): boolean {
  return text === "/reset" || text === "重置会话";
}

router.post("/webhook", async (c) => {
  const rawBody = await c.req.text();
  let payload: unknown;

  try {
    payload = JSON.parse(rawBody);
  } catch {
    return c.json({ code: 400, msg: "Invalid JSON payload" }, 400);
  }

  if (isUrlVerificationPayload(payload)) {
    if (!verifyWebhookToken(payload.token)) {
      return c.json({ code: 401, msg: "Invalid verification token" }, 401);
    }

    return c.json({ challenge: payload.challenge });
  }

  if (isEncryptedPayload(payload)) {
    return c.json(
      {
        code: 501,
        msg: "Encrypted Feishu events are not supported in this MVP. Disable event encryption first."
      },
      501
    );
  }

  if (!isEventPayload(payload)) {
    return c.json({ code: 400, msg: "Unsupported Feishu payload" }, 400);
  }

  const { event, header } = payload;

  if (!verifyWebhookToken(header.token)) {
    return c.json({ code: 401, msg: "Invalid verification token" }, 401);
  }

  if (header.event_type !== "im.message.receive_v1") {
    return c.json({ code: 0, msg: "ignored" });
  }

  if (event.sender?.sender_type === "app") {
    return c.json({ code: 0, msg: "ignored self event" });
  }

  if (!memoryStore.tryStartEvent(header.event_id)) {
    return c.json({ code: 0, msg: "duplicate event ignored" });
  }

  try {
    if (event.message.message_type !== "text") {
      await sendTextMessage(
        event.message.chat_id,
        "当前 MVP 只支持文本消息。"
      );
      memoryStore.markEventDone(header.event_id);
      return c.json({ code: 0 });
    }

    const userText = extractTextContent(event.message.content);
    if (!userText) {
      await sendTextMessage(
        event.message.chat_id,
        "消息格式我没识别出来，可以再发一次文本试试。"
      );
      memoryStore.markEventDone(header.event_id);
      return c.json({ code: 0 });
    }

    if (isResetCommand(userText)) {
      memoryStore.resetConversation(event.message.chat_id);
      await sendTextMessage(event.message.chat_id, "会话已经重置。");
      memoryStore.markEventDone(header.event_id);
      return c.json({ code: 0 });
    }

    const conversation = [
      ...memoryStore.getConversation(event.message.chat_id),
      { role: "user" as const, content: userText }
    ];

    const reply =
      (await generateAssistantReply(conversation)) ||
      "我暂时没组织好回答，你可以换个说法再试一次。";

    memoryStore.appendExchange(event.message.chat_id, userText, reply);
    await sendTextMessage(event.message.chat_id, reply);
    memoryStore.markEventDone(header.event_id);

    return c.json({ code: 0 });
  } catch (error) {
    memoryStore.markEventFailed(header.event_id);

    console.error("Failed to process Feishu event", error);

    await sendTextMessage(
      event.message.chat_id,
      "服务暂时异常，我已经记录了问题。"
    ).catch((sendError) => {
      console.error("Failed to send Feishu fallback message", sendError);
    });

    return c.json({ code: 500, msg: "internal error" }, 500);
  }
});

export default router;
