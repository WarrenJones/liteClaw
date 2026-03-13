import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { generateText } from "ai";

import { config } from "../config.js";
import type { ConversationMessage } from "./memory.js";

const provider = createOpenAICompatible({
  name: "local-openai-compatible",
  apiKey: config.model.apiKey,
  baseURL: config.model.baseURL
});

export async function generateAssistantReply(
  messages: ConversationMessage[]
): Promise<string> {
  const result = await generateText({
    model: provider(config.model.id),
    system: config.systemPrompt,
    messages
  });

  return result.text.trim();
}
