import { config } from "../config.js";
import type { FeishuMessageEventData } from "../types/feishu.js";
import {
  extractTextContent,
  sendTextMessage
} from "./feishu.js";
import { routeCommand } from "./commands.js";
import { isLiteClawError } from "./errors.js";
import { generateAgentReply } from "./llm.js";
import { conversationStore } from "./conversation-store.js";
import { logDebug, logError, logInfo, logWarn } from "./logger.js";
import { SlidingWindowRateLimiter } from "./rate-limit.js";
import { executeTool } from "./tools.js";

const rateLimiter = new SlidingWindowRateLimiter(
  config.rateLimit.maxMessages,
  config.rateLimit.windowMs
);

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

function formatRetryAfter(retryAfterMs: number): string {
  const seconds = Math.max(Math.ceil(retryAfterMs / 1000), 1);
  return `${seconds} 秒`;
}

function getFailureReply(error: unknown): string {
  if (!isLiteClawError(error)) {
    return "服务暂时异常，我已经记录了问题。";
  }

  if (error.code === "feishu_message_content_parse_failed") {
    return "消息格式我没识别出来，可以再发一次文本试试。";
  }

  if (error.code === "operation_timed_out") {
    const operation = String(error.details?.operation ?? "");

    if (operation.startsWith("llm_") || operation.startsWith("agent_")) {
      return "模型响应超时了，你可以稍后再试一次。";
    }

    if (operation.startsWith("feishu_")) {
      return "飞书回复超时了，你可以稍后再试一次。";
    }

    if (operation.startsWith("redis_")) {
      return "会话存储响应超时了，请稍后再试。";
    }
  }

  if (error.category === "storage") {
    return "会话存储暂时不可用，请稍后再试。";
  }

  if (error.code === "llm_request_failed") {
    return "模型服务暂时不可用，你可以稍后再试一次。";
  }

  if (error.code === "tool_not_found") {
    return "我暂时找不到这个工具。";
  }

  if (error.code === "tool_execution_failed") {
    return "工具执行失败了，请稍后再试。";
  }

  return "服务暂时异常，我已经记录了问题。";
}

async function markEventDoneSafely(
  eventId: string,
  chatId: string
): Promise<void> {
  try {
    await conversationStore.markEventDone(eventId);
  } catch (error) {
    logError("feishu.message.event_mark_done_failed", {
      chatId,
      eventId,
      error
    });
  }
}

async function markEventFailedSafely(
  eventId: string,
  chatId: string
): Promise<void> {
  try {
    await conversationStore.markEventFailed(eventId);
  } catch (error) {
    logError("feishu.message.event_mark_failed_failed", {
      chatId,
      eventId,
      error
    });
  }
}

async function processFeishuMessageEvent(
  event: FeishuMessageEventData
): Promise<void> {
  const startedAt = Date.now();
  let outcome = "ignored";

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
      outcome = "unsupported_type";
      await sendTextMessage(event.message.chat_id, "当前 MVP 只支持文本消息。");
      await markEventDoneSafely(event.eventId, event.message.chat_id);
      return;
    }

    if (!shouldRespondToMessage(event)) {
      logDebug("feishu.message.group_without_mention_ignored", {
        chatId: event.message.chat_id,
        eventId: event.eventId
      });
      outcome = "group_without_mention_ignored";
      await markEventDoneSafely(event.eventId, event.message.chat_id);
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
      outcome = "empty_message";
      await markEventDoneSafely(event.eventId, event.message.chat_id);
      return;
    }

    const commandResult = routeCommand(userText);
    if (commandResult.handled) {
      if (commandResult.kind === "response") {
        if (commandResult.resetConversation) {
          await conversationStore.resetConversation(event.message.chat_id);
        }

        logInfo("feishu.message.command_handled", {
          chatId: event.message.chat_id,
          command: commandResult.command,
          eventId: event.eventId
        });
        outcome = `command:${commandResult.command}`;
        await sendTextMessage(event.message.chat_id, commandResult.responseText);
        await markEventDoneSafely(event.eventId, event.message.chat_id);
        return;
      }

      const toolResult = await executeTool(commandResult.toolName, {
        chatId: event.message.chat_id,
        eventId: event.eventId,
        trigger: "command",
        inputText: commandResult.inputText,
        userText
      });

      logInfo("feishu.message.tool_handled", {
        chatId: event.message.chat_id,
        command: commandResult.command,
        eventId: event.eventId,
        toolName: commandResult.toolName
      });
      outcome = `tool:${commandResult.toolName}`;
      await sendTextMessage(event.message.chat_id, toolResult.text);
      await markEventDoneSafely(event.eventId, event.message.chat_id);
      return;
    }

    const rateLimitResult = rateLimiter.check(event.message.chat_id);
    if (!rateLimitResult.allowed) {
      outcome = "rate_limited";
      logWarn("feishu.message.rate_limited", {
        chatId: event.message.chat_id,
        eventId: event.eventId,
        retryAfterMs: rateLimitResult.retryAfterMs
      });
      await sendTextMessage(
        event.message.chat_id,
        `当前会话消息过于频繁，请 ${formatRetryAfter(rateLimitResult.retryAfterMs)} 后再试。`
      );
      await markEventDoneSafely(event.eventId, event.message.chat_id);
      return;
    }

    const history = await conversationStore.getConversation(
      event.message.chat_id
    );
    const conversation = [
      ...history,
      { role: "user" as const, content: userText }
    ];

    logInfo("feishu.message.model_request_prepared", {
      chatId: event.message.chat_id,
      conversationSize: conversation.length,
      eventId: event.eventId,
      userTextLength: userText.length,
      rateLimitRemaining: rateLimitResult.remaining
    });

    const agentResult = await generateAgentReply(conversation, {
      chatId: event.message.chat_id,
      eventId: event.eventId,
      userText
    });

    const reply =
      agentResult.text || "我暂时没组织好回答，你可以换个说法再试一次。";

    // 保存完整消息序列：用户消息 + agent loop 产生的所有消息
    await conversationStore.appendMessages(event.message.chat_id, [
      { role: "user", content: userText },
      ...agentResult.messages
    ]);

    logInfo("feishu.message.reply_sending", {
      chatId: event.message.chat_id,
      eventId: event.eventId,
      replyLength: reply.length,
      toolCallCount: agentResult.toolCallCount,
      stepCount: agentResult.stepCount
    });
    await sendTextMessage(event.message.chat_id, reply);
    outcome =
      agentResult.toolCallCount > 0 ? "agent_replied" : "replied";
    await markEventDoneSafely(event.eventId, event.message.chat_id);
  } catch (error) {
    outcome = "failed";
    await markEventFailedSafely(event.eventId, event.message.chat_id);
    logError("feishu.message.process_failed", {
      chatId: event.message.chat_id,
      eventId: event.eventId,
      error
    });

    await sendTextMessage(
      event.message.chat_id,
      getFailureReply(error)
    ).catch((sendError) => {
      logError("feishu.message.fallback_send_failed", {
        chatId: event.message.chat_id,
        eventId: event.eventId,
        error: sendError
      });
    });
  } finally {
    logInfo("feishu.message.process_completed", {
      chatId: event.message.chat_id,
      eventId: event.eventId,
      durationMs: Date.now() - startedAt,
      outcome
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
