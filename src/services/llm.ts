import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { generateText } from "ai";

import { config } from "../config.js";
import { LiteClawError } from "./errors.js";
import { logDebug, logInfo } from "./logger.js";
import { withRetry, withTimeout } from "./resilience.js";
import type { ConversationMessage } from "./store.js";

const provider = createOpenAICompatible({
  name: "local-openai-compatible",
  apiKey: config.model.apiKey,
  baseURL: config.model.baseURL
});

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
              messages
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
