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
    orchestration: { enabled: true, maxSubtasks: 5, progressMessagesEnabled: true }
  }
}));
vi.mock("./logger.js", () => ({
  logDebug: vi.fn(),
  logInfo: vi.fn(),
  logWarn: vi.fn(),
  logError: vi.fn()
}));

import { planTask } from "./task-planner.js";
import { config } from "../config.js";

describe("planTask", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns isMultiStep false when orchestration is disabled", async () => {
    const original = config.orchestration.enabled;
    (config.orchestration as { enabled: boolean }).enabled = false;

    const result = await planTask("查北京和上海天气");
    expect(result.isMultiStep).toBe(false);
    expect(mockGenerateText).not.toHaveBeenCalled();

    (config.orchestration as { enabled: boolean }).enabled = original;
  });

  it("returns isMultiStep false for simple requests", async () => {
    mockGenerateText.mockResolvedValue({
      text: '{"isMultiStep": false, "subtasks": []}'
    });

    const result = await planTask("今天天气怎么样");
    expect(result.isMultiStep).toBe(false);
    expect(result.subtasks).toEqual([]);
  });

  it("returns subtasks for complex requests", async () => {
    mockGenerateText.mockResolvedValue({
      text: '{"isMultiStep": true, "subtasks": [{"description": "查询北京天气"}, {"description": "查询上海天气"}, {"description": "对比分析"}]}'
    });

    const result = await planTask("查北京和上海天气然后对比");
    expect(result.isMultiStep).toBe(true);
    expect(result.subtasks).toHaveLength(3);
    expect(result.subtasks[0].description).toBe("查询北京天气");
  });

  it("handles markdown-wrapped JSON response", async () => {
    mockGenerateText.mockResolvedValue({
      text: '```json\n{"isMultiStep": true, "subtasks": [{"description": "步骤一"}]}\n```'
    });

    const result = await planTask("复杂请求");
    expect(result.isMultiStep).toBe(true);
    expect(result.subtasks).toHaveLength(1);
  });

  it("returns fallback on malformed JSON", async () => {
    mockGenerateText.mockResolvedValue({
      text: "这不是一个 JSON"
    });

    const result = await planTask("随便什么");
    expect(result.isMultiStep).toBe(false);
    expect(result.subtasks).toEqual([]);
  });

  it("returns fallback on LLM failure", async () => {
    mockGenerateText.mockRejectedValue(new Error("LLM error"));

    const result = await planTask("测试");
    expect(result.isMultiStep).toBe(false);
    expect(result.subtasks).toEqual([]);
  });

  it("limits subtasks to maxSubtasks", async () => {
    const manySubtasks = Array.from({ length: 10 }, (_, i) => ({
      description: `步骤${i + 1}`
    }));
    mockGenerateText.mockResolvedValue({
      text: JSON.stringify({ isMultiStep: true, subtasks: manySubtasks })
    });

    const result = await planTask("非常复杂的请求");
    expect(result.isMultiStep).toBe(true);
    expect(result.subtasks).toHaveLength(5); // maxSubtasks = 5
  });

  it("filters out invalid subtask entries", async () => {
    mockGenerateText.mockResolvedValue({
      text: '{"isMultiStep": true, "subtasks": [{"description": "有效"}, {"description": ""}, {"invalid": true}]}'
    });

    const result = await planTask("测试");
    expect(result.isMultiStep).toBe(true);
    expect(result.subtasks).toHaveLength(1);
    expect(result.subtasks[0].description).toBe("有效");
  });
});
