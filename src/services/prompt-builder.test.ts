import { describe, it, expect, vi } from "vitest";

vi.mock("../config.js", () => ({
  config: {
    systemPrompt: "你是 liteClaw，一个简洁可靠的中文助手。"
  }
}));

import { buildSystemPrompt } from "./prompt-builder.js";
import type { ConversationSummary, UserFact } from "./store.js";

describe("buildSystemPrompt", () => {
  it("returns base prompt when no summary or facts", () => {
    const result = buildSystemPrompt({ summary: null, facts: [] });
    expect(result).toBe("你是 liteClaw，一个简洁可靠的中文助手。");
  });

  it("includes summary when provided", () => {
    const summary: ConversationSummary = {
      text: "用户在讨论天气查询功能",
      summarizedUpTo: 10,
      createdAt: Date.now()
    };
    const result = buildSystemPrompt({ summary, facts: [] });

    expect(result).toContain("你是 liteClaw");
    expect(result).toContain("会话摘要");
    expect(result).toContain("用户在讨论天气查询功能");
  });

  it("includes facts when provided", () => {
    const facts: UserFact[] = [
      { key: "name", value: "小明", updatedAt: Date.now() },
      { key: "preferred_language", value: "中文", updatedAt: Date.now() }
    ];
    const result = buildSystemPrompt({ summary: null, facts });

    expect(result).toContain("已知用户信息");
    expect(result).toContain("name: 小明");
    expect(result).toContain("preferred_language: 中文");
  });

  it("includes both summary and facts", () => {
    const summary: ConversationSummary = {
      text: "之前讨论了项目架构",
      summarizedUpTo: 5,
      createdAt: Date.now()
    };
    const facts: UserFact[] = [
      { key: "project", value: "liteClaw", updatedAt: Date.now() }
    ];
    const result = buildSystemPrompt({ summary, facts });

    expect(result).toContain("你是 liteClaw");
    expect(result).toContain("会话摘要");
    expect(result).toContain("之前讨论了项目架构");
    expect(result).toContain("已知用户信息");
    expect(result).toContain("project: liteClaw");
  });
});
