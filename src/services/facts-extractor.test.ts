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
    memory: { factsExtractionEnabled: true, maxFacts: 10 }
  }
}));
vi.mock("./logger.js", () => ({
  logDebug: vi.fn(),
  logInfo: vi.fn(),
  logWarn: vi.fn(),
  logError: vi.fn()
}));

import { extractFacts } from "./facts-extractor.js";
import { config } from "../config.js";
import type { ConversationMessage, UserFact } from "./store.js";

describe("extractFacts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns empty when disabled", async () => {
    const original = config.memory.factsExtractionEnabled;
    (config.memory as { factsExtractionEnabled: boolean }).factsExtractionEnabled = false;

    const result = await extractFacts(
      [{ role: "user", content: "我叫小明" }],
      []
    );
    expect(result).toEqual([]);
    expect(mockGenerateText).not.toHaveBeenCalled();

    (config.memory as { factsExtractionEnabled: boolean }).factsExtractionEnabled = original;
  });

  it("returns empty when no user messages", async () => {
    const result = await extractFacts(
      [{ role: "assistant", content: "你好" }],
      []
    );
    expect(result).toEqual([]);
  });

  it("extracts facts from valid JSON response", async () => {
    mockGenerateText.mockResolvedValue({
      text: '[{"key":"name","value":"小明"},{"key":"city","value":"上海"}]'
    });

    const result = await extractFacts(
      [
        { role: "user", content: "我叫小明，在上海" },
        { role: "assistant", content: "你好小明！" }
      ],
      []
    );

    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({ key: "name", value: "小明" });
    expect(result[1]).toEqual({ key: "city", value: "上海" });
  });

  it("handles JSON wrapped in markdown code block", async () => {
    mockGenerateText.mockResolvedValue({
      text: '```json\n[{"key":"name","value":"小明"}]\n```'
    });

    const result = await extractFacts(
      [{ role: "user", content: "我叫小明" }],
      []
    );

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({ key: "name", value: "小明" });
  });

  it("returns empty on malformed JSON", async () => {
    mockGenerateText.mockResolvedValue({
      text: "没有找到新的事实"
    });

    const result = await extractFacts(
      [{ role: "user", content: "今天天气不错" }],
      []
    );

    expect(result).toEqual([]);
  });

  it("filters out invalid fact entries", async () => {
    mockGenerateText.mockResolvedValue({
      text: '[{"key":"name","value":"小明"},{"key":"","value":"invalid"},{"invalid":true}]'
    });

    const result = await extractFacts(
      [{ role: "user", content: "test" }],
      []
    );

    expect(result).toHaveLength(1);
    expect(result[0].key).toBe("name");
  });

  it("returns empty array on LLM failure", async () => {
    mockGenerateText.mockRejectedValue(new Error("LLM error"));

    const result = await extractFacts(
      [{ role: "user", content: "test" }],
      []
    );

    expect(result).toEqual([]);
  });

  it("passes existing facts to the prompt", async () => {
    mockGenerateText.mockResolvedValue({ text: "[]" });

    const existingFacts: UserFact[] = [
      { key: "name", value: "小明", updatedAt: Date.now() }
    ];

    await extractFacts(
      [{ role: "user", content: "test" }],
      existingFacts
    );

    const callArgs = mockGenerateText.mock.calls[0][0];
    const userContent = callArgs.messages[0].content;
    expect(userContent).toContain("name: 小明");
  });
});
