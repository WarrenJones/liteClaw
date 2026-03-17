import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { generateText } from "ai";

import { config } from "../config.js";
import { logDebug, logInfo, logWarn } from "./logger.js";
import type { ConversationMessage, UserFact } from "./store.js";

const provider = createOpenAICompatible({
  name: "local-openai-compatible",
  apiKey: config.model.apiKey,
  baseURL: config.model.baseURL
});

export type ExtractedFact = {
  key: string;
  value: string;
};

/**
 * 从最近的对话消息中提取用户事实（偏好、姓名、习惯等）。
 * 在主回复发送后异步调用，不阻塞用户体验。
 */
export async function extractFacts(
  recentMessages: ConversationMessage[],
  existingFacts: UserFact[]
): Promise<ExtractedFact[]> {
  if (!config.memory.factsExtractionEnabled) {
    return [];
  }

  // 只取最近 4 条消息（1-2 轮对话）
  const tail = recentMessages.slice(-4);
  const userMessages = tail.filter((m) => m.role === "user");
  if (userMessages.length === 0) {
    return [];
  }

  const existingFactsBlock =
    existingFacts.length > 0
      ? existingFacts.map((f) => `- ${f.key}: ${f.value}`).join("\n")
      : "（暂无）";

  const conversationBlock = tail
    .map((m) => {
      if (m.role === "user") return `用户: ${m.content}`;
      if (m.role === "assistant") return `助手: ${m.content}`;
      return "";
    })
    .filter(Boolean)
    .join("\n");

  const maxFacts = config.memory.maxFacts;
  const prompt = `从以下对话中提取关于用户的关键事实（姓名、偏好、项目、习惯等）。

已知事实（${existingFacts.length}/${maxFacts}）：
${existingFactsBlock}

最近对话：
${conversationBlock}

规则：
1. 只提取新的或需要更新的事实，不要重复已有内容
2. key 使用英文蛇形命名（如 name、preferred_language、current_project）
3. value 使用中文
4. 如果已有 ${maxFacts} 条事实且需要新增，用新事实替换最不重要的
5. 如果没有新事实，返回空数组

输出 JSON 数组，格式：[{"key":"xxx","value":"xxx"}]
只输出 JSON，不要其他内容。`;

  try {
    const result = await generateText({
      model: provider(config.model.id),
      system: "你是一个信息提取助手，只输出 JSON 数组，不加任何解释。",
      messages: [{ role: "user", content: prompt }]
    });

    const parsed = parseFactsJSON(result.text.trim());

    if (parsed.length > 0) {
      logInfo("facts_extractor.extracted", {
        factCount: parsed.length,
        keys: parsed.map((f) => f.key)
      });
    } else {
      logDebug("facts_extractor.no_new_facts", {});
    }

    return parsed;
  } catch (error) {
    logWarn("facts_extractor.failed", { error });
    return [];
  }
}

/**
 * 容错解析 LLM 返回的 JSON 事实数组。
 */
function parseFactsJSON(text: string): ExtractedFact[] {
  // 先尝试直接解析
  try {
    const arr = JSON.parse(text);
    if (Array.isArray(arr)) {
      return arr.filter(
        (item): item is ExtractedFact =>
          item &&
          typeof item === "object" &&
          typeof item.key === "string" &&
          typeof item.value === "string" &&
          item.key.length > 0
      );
    }
  } catch {
    // fallback: 尝试从文本中提取 JSON 数组
  }

  // 正则提取 [...] 块
  const match = text.match(/\[[\s\S]*\]/);
  if (match) {
    try {
      const arr = JSON.parse(match[0]);
      if (Array.isArray(arr)) {
        return arr.filter(
          (item): item is ExtractedFact =>
            item &&
            typeof item === "object" &&
            typeof item.key === "string" &&
            typeof item.value === "string" &&
            item.key.length > 0
        );
      }
    } catch {
      // 解析失败，返回空
    }
  }

  return [];
}
