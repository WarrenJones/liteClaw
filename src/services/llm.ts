import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { generateText } from "ai";

import { config } from "../config.js";
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

  console.log("Calling model", {
    baseURL: config.model.baseURL,
    messageCount: messages.length,
    modelId: config.model.id,
    latestUserTextLength: latestUserMessage?.content.length ?? 0
  });

  const result = await generateText({
    model: provider(config.model.id),
    system: config.systemPrompt,
    messages
  });

  console.log("Model reply received", {
    modelId: config.model.id,
    outputLength: result.text.trim().length
  });

  return result.text.trim();
}
