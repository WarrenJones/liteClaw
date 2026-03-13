import type { FeishuMessageEventData } from "../types/feishu.js";
import {
  extractTextContent,
  sendTextMessage
} from "./feishu.js";
import { routeCommand } from "./commands.js";
import { generateAssistantReply } from "./llm.js";
import { conversationStore } from "./conversation-store.js";
import { logDebug, logError, logInfo, logWarn } from "./logger.js";

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

async function processFeishuMessageEvent(
  event: FeishuMessageEventData
): Promise<void> {
  if (event.eventType !== "im.message.receive_v1") {
    return;
  }

  if (event.sender?.sender_type === "app") {
    logDebug("feishu.message.ignored_app_sender", {
      eventId: event.eventId
    });
    return;
  }

  if (!(await conversationStore.tryStartEvent(event.eventId))) {
    logDebug("feishu.message.duplicate_event_skipped", {
      eventId: event.eventId
    });
    return;
  }

  try {
    logInfo("feishu.message.received", {
      chatId: event.message.chat_id,
      chatType: event.message.chat_type,
      eventId: event.eventId,
      mentionCount: event.message.mentions?.length ?? 0,
      messageType: event.message.message_type
    });

    if (event.message.message_type !== "text") {
      logWarn("feishu.message.unsupported_type", {
        chatId: event.message.chat_id,
        eventId: event.eventId,
        messageType: event.message.message_type
      });
      await sendTextMessage(event.message.chat_id, "当前 MVP 只支持文本消息。");
      await conversationStore.markEventDone(event.eventId);
      return;
    }

    if (!shouldRespondToMessage(event)) {
      logDebug("feishu.message.group_without_mention_ignored", {
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

    const commandResult = routeCommand(userText);
    if (commandResult.handled) {
      if (commandResult.resetConversation) {
        await conversationStore.resetConversation(event.message.chat_id);
      }

      logInfo("feishu.message.command_handled", {
        chatId: event.message.chat_id,
        command: commandResult.command,
        eventId: event.eventId
      });
      await sendTextMessage(event.message.chat_id, commandResult.responseText);
      await conversationStore.markEventDone(event.eventId);
      return;
    }

    const conversation = [
      ...(await conversationStore.getConversation(event.message.chat_id)),
      { role: "user" as const, content: userText }
    ];

    logInfo("feishu.message.model_request_prepared", {
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
    logInfo("feishu.message.reply_sending", {
      chatId: event.message.chat_id,
      eventId: event.eventId,
      replyLength: reply.length
    });
    await sendTextMessage(event.message.chat_id, reply);
    await conversationStore.markEventDone(event.eventId);
  } catch (error) {
    await conversationStore.markEventFailed(event.eventId);
    logError("feishu.message.process_failed", {
      chatId: event.message.chat_id,
      eventId: event.eventId,
      error
    });

    await sendTextMessage(
      event.message.chat_id,
      "服务暂时异常，我已经记录了问题。"
    ).catch((sendError) => {
      logError("feishu.message.fallback_send_failed", {
        chatId: event.message.chat_id,
        eventId: event.eventId,
        error: sendError
      });
    });
  }
}

export function scheduleFeishuMessageEvent(event: FeishuMessageEventData): void {
  void processFeishuMessageEvent(event).catch((error) => {
    logError("feishu.message.handler_unexpected_failure", {
      eventId: event.eventId,
      error
    });
  });
}
