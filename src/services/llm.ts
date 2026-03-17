import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { generateText, stepCountIs } from "ai";

import { config } from "../config.js";
import { LiteClawError } from "./errors.js";
import { logDebug, logInfo, logWarn } from "./logger.js";
import { withRetry, withTimeout } from "./resilience.js";
import type { ConversationMessage } from "./store.js";
import { toAISDKTools } from "./tools.js";

const provider = createOpenAICompatible({
  name: "local-openai-compatible",
  apiKey: config.model.apiKey,
  baseURL: config.model.baseURL
});

/**
 * 纯文本回复（无工具调用），保留用于后向兼容。
 */
export async function generateAssistantReply(
  messages: ConversationMessage[]
): Promise<string> {
  const latestUserMessage = [...messages]
    .reverse()
    .find((message) => message.role === "user");

  logInfo("llm.request.started", {
    baseURL: config.model.baseURL,
    messageCount: messages.length,
    modelId: config.model.id,
    latestUserTextLength: latestUserMessage?.content.length ?? 0,
    timeoutMs: config.model.timeoutMs,
    maxRetries: config.model.maxRetries
  });

  try {
    const result = await withRetry(
      async (attempt) =>
        withTimeout(
          () =>
            generateText({
              model: provider(config.model.id),
              system: config.systemPrompt,
              messages: toSDKMessages(messages)
            }),
          {
            operation: "llm_request",
            timeoutMs: config.model.timeoutMs,
            category: "external",
            details: {
              modelId: config.model.id,
              attempt
            }
          }
        ),
      {
        operation: "llm_request",
        maxRetries: config.model.maxRetries,
        delayMs: config.model.retryDelayMs
      }
    );

    logDebug("llm.request.completed", {
      modelId: config.model.id,
      outputLength: result.text.trim().length
    });

    return result.text.trim();
  } catch (error) {
    throw new LiteClawError("Failed to generate model reply", {
      code: "llm_request_failed",
      category: "external",
      retryable: true,
      details: {
        modelId: config.model.id,
        baseURL: config.model.baseURL,
        messageCount: messages.length
      },
      cause: error
    });
  }
}

/**
 * Agent 回复结果，包含最终文本和完整消息序列。
 */
export type AgentReplyResult = {
  text: string;
  messages: ConversationMessage[];
  toolCallCount: number;
  stepCount: number;
};

/**
 * Agent Loop 回复：支持模型自主调用工具，多轮循环直到产出文本或达到上限。
 */
export async function generateAgentReply(
  history: ConversationMessage[],
  context: { chatId: string; eventId: string; userText: string }
): Promise<AgentReplyResult> {
  const maxRounds = config.agent.maxToolRounds;
  const sdkTools = toAISDKTools(context);

  logInfo("agent.loop.started", {
    chatId: context.chatId,
    eventId: context.eventId,
    maxRounds,
    toolCount: Object.keys(sdkTools).length,
    historyLength: history.length
  });

  try {
    const result = await withRetry(
      async (attempt) =>
        withTimeout(
          () =>
            generateText({
              model: provider(config.model.id),
              system: config.systemPrompt,
              messages: toSDKMessages(history),
              tools: sdkTools,
              stopWhen: stepCountIs(maxRounds),
              onStepFinish: (event) => {
                const toolCallNames = event.toolCalls.map((tc) => tc.toolName);

                logInfo("agent.loop.round_completed", {
                  chatId: context.chatId,
                  eventId: context.eventId,
                  finishReason: event.finishReason,
                  toolCalls: toolCallNames,
                  hasText: !!event.text
                });
              }
            }),
          {
            operation: "agent_loop",
            timeoutMs: config.model.timeoutMs * maxRounds,
            category: "external",
            details: {
              modelId: config.model.id,
              attempt
            }
          }
        ),
      {
        operation: "agent_loop",
        maxRetries: config.model.maxRetries,
        delayMs: config.model.retryDelayMs
      }
    );

    const totalToolCalls = result.steps.reduce(
      (sum, step) => sum + step.toolCalls.length,
      0
    );

    logInfo("agent.loop.completed", {
      chatId: context.chatId,
      eventId: context.eventId,
      stepCount: result.steps.length,
      toolCallCount: totalToolCalls,
      textLength: result.text.length,
      finishReason: result.finishReason
    });

    if (result.steps.length >= maxRounds && !result.text) {
      logWarn("agent.loop.max_rounds_exceeded", {
        chatId: context.chatId,
        eventId: context.eventId,
        maxRounds
      });
    }

    // 将 SDK 的 response.messages 转换为 LiteClaw 的 ConversationMessage
    const newMessages = convertResponseMessages(result.response.messages);

    return {
      text:
        result.text.trim() ||
        "工具调用达到上限，我暂时没法生成最终回复，请换个问题试试。",
      messages: newMessages,
      toolCallCount: totalToolCalls,
      stepCount: result.steps.length
    };
  } catch (error) {
    throw new LiteClawError("Agent loop failed", {
      code: "llm_request_failed",
      category: "external",
      retryable: true,
      details: {
        modelId: config.model.id,
        baseURL: config.model.baseURL,
        historyLength: history.length
      },
      cause: error
    });
  }
}

/**
 * 将 LiteClaw ConversationMessage[] 转换为 AI SDK 的 messages 格式。
 * 返回值使用 unknown[] 并在调用处通过 as 断言为 ModelMessage[]，
 * 因为 ModelMessage 类型未从 ai 包直接导出。
 */
function toSDKMessages(
  messages: ConversationMessage[]
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): any[] {
  return messages.map((msg) => {
    if (msg.role === "tool") {
      return {
        role: "tool" as const,
        content: [
          {
            type: "tool-result" as const,
            toolCallId: msg.toolCallId,
            toolName: msg.toolName,
            result: msg.content
          }
        ]
      };
    }

    if (msg.role === "assistant" && "toolCalls" in msg && msg.toolCalls) {
      const parts: Array<Record<string, unknown>> = [];

      if (msg.content) {
        parts.push({ type: "text" as const, text: msg.content });
      }

      for (const tc of msg.toolCalls) {
        parts.push({
          type: "tool-call" as const,
          toolCallId: tc.id,
          toolName: tc.name,
          args: tc.arguments
        });
      }

      return {
        role: "assistant" as const,
        content: parts
      };
    }

    return {
      role: msg.role as "user" | "assistant",
      content: msg.content
    };
  });
}

/**
 * 将 AI SDK 的 ResponseMessage[] 转换回 LiteClaw ConversationMessage[]。
 */
function convertResponseMessages(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  responseMessages: readonly any[]
): ConversationMessage[] {
  const result: ConversationMessage[] = [];

  for (const msg of responseMessages) {
    if (msg.role === "assistant") {
      const content = msg.content;

      if (typeof content === "string") {
        result.push({ role: "assistant", content });
        continue;
      }

      if (Array.isArray(content)) {
        const textParts: string[] = [];
        const toolCalls: Array<{
          id: string;
          name: string;
          arguments: Record<string, unknown>;
        }> = [];

        for (const part of content) {
          if (
            part &&
            typeof part === "object" &&
            "type" in part &&
            part.type === "text" &&
            "text" in part
          ) {
            textParts.push(String(part.text));
          }
          if (
            part &&
            typeof part === "object" &&
            "type" in part &&
            part.type === "tool-call" &&
            "toolCallId" in part &&
            "toolName" in part
          ) {
            toolCalls.push({
              id: String(part.toolCallId),
              name: String(part.toolName),
              arguments:
                "args" in part &&
                part.args &&
                typeof part.args === "object"
                  ? (part.args as Record<string, unknown>)
                  : {}
            });
          }
        }

        if (toolCalls.length > 0) {
          result.push({
            role: "assistant",
            content: textParts.join(""),
            toolCalls
          });
        } else {
          result.push({
            role: "assistant",
            content: textParts.join("")
          });
        }
      }
    }

    if (msg.role === "tool") {
      const content = msg.content;
      if (Array.isArray(content)) {
        for (const part of content) {
          if (
            part &&
            typeof part === "object" &&
            "type" in part &&
            part.type === "tool-result" &&
            "toolCallId" in part &&
            "toolName" in part
          ) {
            result.push({
              role: "tool",
              toolCallId: String(part.toolCallId),
              toolName: String(part.toolName),
              content:
                "result" in part
                  ? typeof part.result === "string"
                    ? part.result
                    : JSON.stringify(part.result)
                  : ""
            });
          }
        }
      }
    }
  }

  return result;
}
