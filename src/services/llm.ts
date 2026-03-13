import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { generateText } from "ai";

import { config } from "../config.js";
import { LiteClawError } from "./errors.js";
import { logDebug, logInfo } from "./logger.js";
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
    latestUserTextLength: latestUserMessage?.content.length ?? 0
  });

  try {
    const result = await generateText({
      model: provider(config.model.id),
      system: config.systemPrompt,
      messages
    });

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
