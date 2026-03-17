import { config } from "../config.js";
import type { ConversationSummary, UserFact } from "./store.js";

export type PromptContext = {
  summary: ConversationSummary | null;
  facts: UserFact[];
};

/**
 * 动态构建 system prompt，将基础 prompt + 会话摘要 + 用户事实拼装。
 */
export function buildSystemPrompt(context: PromptContext): string {
  const parts: string[] = [config.systemPrompt];

  if (context.summary) {
    parts.push(
      `\n## 会话摘要\n以下是之前对话的摘要，请参考以保持上下文连贯：\n${context.summary.text}`
    );
  }

  if (context.facts.length > 0) {
    const factsText = context.facts
      .map((f) => `- ${f.key}: ${f.value}`)
      .join("\n");
    parts.push(
      `\n## 已知用户信息\n${factsText}`
    );
  }

  return parts.join("\n");
}
