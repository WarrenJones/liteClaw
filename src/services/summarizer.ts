import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { generateText } from "ai";

import { config } from "../config.js";
import { logDebug, logInfo, logWarn } from "./logger.js";
import type { ConversationMessage, ConversationSummary } from "./store.js";

const provider = createOpenAICompatible({
  name: "local-openai-compatible",
  apiKey: config.model.apiKey,
  baseURL: config.model.baseURL
});

export type SummarizeInput = {
  chatId: string;
  messages: ConversationMessage[];
  existingSummary: ConversationSummary | null;
};

export type SummarizeResult = {
  summary: ConversationSummary;
  recentMessages: ConversationMessage[];
};

/**
 * 格式化消息为纯文本（用于摘要 prompt）。
 */
function formatMessagesForSummary(messages: ConversationMessage[]): string {
  return messages
    .map((msg) => {
      if (msg.role === "user") return `用户: ${msg.content}`;
      if (msg.role === "assistant") return `助手: ${msg.content}`;
      if (msg.role === "tool") return `[工具 ${msg.toolName}]: ${msg.content}`;
      return "";
    })
    .filter(Boolean)
    .join("\n");
}

/**
 * 判断是否需要摘要，如果需要则调用 LLM 生成摘要。
 * 返回 null 表示不需要摘要。
 */
export async function maybeSummarize(
  input: SummarizeInput
): Promise<SummarizeResult | null> {
  const { chatId, messages, existingSummary } = input;
  const threshold = config.memory.summarizeThreshold;
  const recentWindow = config.memory.recentWindow;

  if (messages.length <= threshold) {
    logDebug("summarizer.skipped", {
      chatId,
      messageCount: messages.length,
      threshold
    });
    return null;
  }

  // 分割：旧消息需要被摘要，新消息保留原文
  const splitPoint = messages.length - recentWindow;
  const oldMessages = messages.slice(0, splitPoint);
  const recentMessages = messages.slice(splitPoint);

  logInfo("summarizer.started", {
    chatId,
    totalMessages: messages.length,
    oldMessageCount: oldMessages.length,
    recentMessageCount: recentMessages.length,
    hasExistingSummary: !!existingSummary
  });

  const existingSummaryBlock = existingSummary
    ? `\n\n之前的摘要：\n${existingSummary.text}`
    : "";

  const conversationBlock = formatMessagesForSummary(oldMessages);

  const summaryPrompt = `你是一个对话摘要助手。请将以下对话历史压缩为一段简洁的摘要（150-200字），保留关键信息：用户的需求、重要决定、工具调用结果等。输出纯摘要文本，不要加前缀。${existingSummaryBlock}

需要摘要的对话：
${conversationBlock}`;

  try {
    const result = await generateText({
      model: provider(config.model.id),
      system: "你是一个精确的摘要助手，只输出摘要内容，不加任何前缀或解释。",
      messages: [{ role: "user", content: summaryPrompt }]
    });

    const summaryText = result.text.trim();

    if (!summaryText) {
      logWarn("summarizer.empty_result", { chatId });
      return null;
    }

    const summary: ConversationSummary = {
      text: summaryText,
      summarizedUpTo: oldMessages.length + (existingSummary?.summarizedUpTo ?? 0),
      createdAt: Date.now()
    };

    logInfo("summarizer.completed", {
      chatId,
      summaryLength: summaryText.length,
      summarizedUpTo: summary.summarizedUpTo
    });

    return { summary, recentMessages };
  } catch (error) {
    logWarn("summarizer.failed", { chatId, error });
    // 摘要失败不应阻塞主流程，返回 null 继续用原始消息
    return null;
  }
}
