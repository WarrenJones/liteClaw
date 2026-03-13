import type { FeishuMessageEventData } from "../types/feishu.js";
import {
  extractTextContent,
  sendTextMessage
} from "./feishu.js";
import { generateAssistantReply } from "./llm.js";
import { conversationStore } from "./conversation-store.js";

function shouldRespondToMessage(event: FeishuMessageEventData): boolean {
  if (event.message.chat_type !== "group") {
    return true;
  }

  return (event.message.mentions?.length ?? 0) > 0;
}

function stripMentionText(
  text: string,
  mentions: FeishuMessageEventData["message"]["mentions"] = []
): string {
  let normalized = text;

  for (const mention of mentions) {
    if (mention.key) {
      normalized = normalized.replaceAll(mention.key, " ");
    }

    if (mention.name) {
      normalized = normalized.replaceAll(`@${mention.name}`, " ");
    }
  }

  return normalized.replace(/\s+/g, " ").trim();
}

function isResetCommand(text: string): boolean {
  return text === "/reset" || text === "重置会话";
}

async function processFeishuMessageEvent(
  event: FeishuMessageEventData
): Promise<void> {
  if (event.eventType !== "im.message.receive_v1") {
    return;
  }

  if (event.sender?.sender_type === "app") {
    return;
  }

  if (!(await conversationStore.tryStartEvent(event.eventId))) {
    return;
  }

  try {
    console.log("Received Feishu message event", {
      chatId: event.message.chat_id,
      chatType: event.message.chat_type,
      eventId: event.eventId,
      mentionCount: event.message.mentions?.length ?? 0,
      messageType: event.message.message_type
    });

    if (event.message.message_type !== "text") {
      await sendTextMessage(event.message.chat_id, "当前 MVP 只支持文本消息。");
      await conversationStore.markEventDone(event.eventId);
      return;
    }

    if (!shouldRespondToMessage(event)) {
      console.log("Ignoring group message without bot mention", {
        chatId: event.message.chat_id,
        eventId: event.eventId
      });
      await conversationStore.markEventDone(event.eventId);
      return;
    }

    const rawUserText = extractTextContent(event.message.content);
    const userText = stripMentionText(rawUserText, event.message.mentions);
    if (!userText) {
      await sendTextMessage(
        event.message.chat_id,
        event.message.chat_type === "group"
          ? "你可以在 @我 后面直接提问。"
          : "消息格式我没识别出来，可以再发一次文本试试。"
      );
      await conversationStore.markEventDone(event.eventId);
      return;
    }

    if (isResetCommand(userText)) {
      await conversationStore.resetConversation(event.message.chat_id);
      await sendTextMessage(event.message.chat_id, "会话已经重置。");
      await conversationStore.markEventDone(event.eventId);
      return;
    }

    const conversation = [
      ...(await conversationStore.getConversation(event.message.chat_id)),
      { role: "user" as const, content: userText }
    ];

    console.log("Preparing model request", {
      chatId: event.message.chat_id,
      conversationSize: conversation.length,
      eventId: event.eventId,
      userTextLength: userText.length
    });

    const reply =
      (await generateAssistantReply(conversation)) ||
      "我暂时没组织好回答，你可以换个说法再试一次。";

    await conversationStore.appendExchange(
      event.message.chat_id,
      userText,
      reply
    );
    console.log("Sending Feishu reply", {
      chatId: event.message.chat_id,
      eventId: event.eventId,
      replyLength: reply.length
    });
    await sendTextMessage(event.message.chat_id, reply);
    await conversationStore.markEventDone(event.eventId);
  } catch (error) {
    await conversationStore.markEventFailed(event.eventId);
    console.error("Failed to process Feishu message event", error);

    await sendTextMessage(
      event.message.chat_id,
      "服务暂时异常，我已经记录了问题。"
    ).catch((sendError) => {
      console.error("Failed to send Feishu fallback message", sendError);
    });
  }
}

export function scheduleFeishuMessageEvent(event: FeishuMessageEventData): void {
  void processFeishuMessageEvent(event).catch((error) => {
    console.error("Unexpected Feishu event handler failure", error);
  });
}
