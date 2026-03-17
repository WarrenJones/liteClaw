import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@ai-sdk/openai-compatible", () => ({
  createOpenAICompatible: () => () => "mock-model"
}));

const mockGenerateText = vi.fn();
vi.mock("ai", () => ({
  generateText: (...args: unknown[]) => mockGenerateText(...args)
}));

vi.mock("../config.js", () => ({
  config: {
    model: { apiKey: "test", baseURL: "http://localhost", id: "test-model" },
    memory: { summarizeThreshold: 6, recentWindow: 4 }
  }
}));
vi.mock("./logger.js", () => ({
  logDebug: vi.fn(),
  logInfo: vi.fn(),
  logWarn: vi.fn(),
  logError: vi.fn()
}));

import { maybeSummarize } from "./summarizer.js";
import type { ConversationMessage } from "./store.js";

function makeMessages(count: number): ConversationMessage[] {
  const msgs: ConversationMessage[] = [];
  for (let i = 0; i < count; i++) {
    msgs.push(
      i % 2 === 0
        ? { role: "user", content: `msg-${i}` }
        : { role: "assistant", content: `reply-${i}` }
    );
  }
  return msgs;
}

describe("maybeSummarize", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns null when below threshold", async () => {
    const result = await maybeSummarize({
      chatId: "c1",
      messages: makeMessages(4),
      existingSummary: null
    });
    expect(result).toBeNull();
    expect(mockGenerateText).not.toHaveBeenCalled();
  });

  it("returns null when exactly at threshold", async () => {
    const result = await maybeSummarize({
      chatId: "c1",
      messages: makeMessages(6),
      existingSummary: null
    });
    expect(result).toBeNull();
  });

  it("summarizes when above threshold", async () => {
    mockGenerateText.mockResolvedValue({
      text: "这是一段摘要"
    });

    const messages = makeMessages(8); // > 6 threshold
    const result = await maybeSummarize({
      chatId: "c1",
      messages,
      existingSummary: null
    });

    expect(result).not.toBeNull();
    expect(result!.summary.text).toBe("这是一段摘要");
    expect(result!.summary.summarizedUpTo).toBe(4); // 8 - 4 (recentWindow)
    expect(result!.recentMessages).toHaveLength(4); // recentWindow
    expect(mockGenerateText).toHaveBeenCalledTimes(1);
  });

  it("includes existing summary in prompt", async () => {
    mockGenerateText.mockResolvedValue({
      text: "增量摘要"
    });

    const result = await maybeSummarize({
      chatId: "c1",
      messages: makeMessages(10),
      existingSummary: {
        text: "之前的摘要内容",
        summarizedUpTo: 5,
        createdAt: Date.now()
      }
    });

    expect(result).not.toBeNull();
    // summarizedUpTo = old messages count (6) + existing (5)
    expect(result!.summary.summarizedUpTo).toBe(11);

    // Verify existing summary was passed to generateText
    const callArgs = mockGenerateText.mock.calls[0][0];
    const userContent = callArgs.messages[0].content;
    expect(userContent).toContain("之前的摘要");
  });

  it("returns null on LLM failure", async () => {
    mockGenerateText.mockRejectedValue(new Error("LLM error"));

    const result = await maybeSummarize({
      chatId: "c1",
      messages: makeMessages(10),
      existingSummary: null
    });

    expect(result).toBeNull();
  });

  it("returns null on empty LLM response", async () => {
    mockGenerateText.mockResolvedValue({ text: "  " });

    const result = await maybeSummarize({
      chatId: "c1",
      messages: makeMessages(10),
      existingSummary: null
    });

    expect(result).toBeNull();
  });
});
