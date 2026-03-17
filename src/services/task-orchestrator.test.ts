import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@ai-sdk/openai-compatible", () => ({
  createOpenAICompatible: () => () => "mock-model"
}));

const mockGenerateAgentReply = vi.fn();
vi.mock("./llm.js", () => ({
  generateAgentReply: (...args: unknown[]) => mockGenerateAgentReply(...args)
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

import { orchestrateTask, type OrchestrateOptions } from "./task-orchestrator.js";
import type { TaskPlan } from "./task-types.js";

function makePlan(subtaskDescriptions: string[]): TaskPlan {
  return {
    taskId: "task_test",
    chatId: "chat_1",
    originalRequest: "测试请求",
    subtasks: subtaskDescriptions.map((desc, i) => ({
      id: `subtask_${i + 1}`,
      description: desc,
      status: "pending" as const
    })),
    status: "pending",
    createdAt: Date.now()
  };
}

function makeOptions(overrides?: Partial<OrchestrateOptions>): OrchestrateOptions {
  return {
    chatId: "chat_1",
    eventId: "evt_1",
    history: [],
    systemPrompt: "你是测试助手",
    onProgress: vi.fn().mockResolvedValue(undefined),
    ...overrides
  };
}

describe("orchestrateTask", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("executes subtasks sequentially and synthesizes results", async () => {
    mockGenerateAgentReply
      .mockResolvedValueOnce({
        text: "北京 25°C 晴",
        messages: [{ role: "assistant", content: "北京 25°C 晴" }],
        toolCallCount: 1,
        stepCount: 1
      })
      .mockResolvedValueOnce({
        text: "上海 28°C 多云",
        messages: [{ role: "assistant", content: "上海 28°C 多云" }],
        toolCallCount: 1,
        stepCount: 1
      })
      // Synthesis call
      .mockResolvedValueOnce({
        text: "北京 25°C 晴，上海 28°C 多云，上海比北京热 3 度",
        messages: [{ role: "assistant", content: "合成结果" }],
        toolCallCount: 0,
        stepCount: 1
      });

    const plan = makePlan(["查询北京天气", "查询上海天气"]);
    const options = makeOptions();

    const result = await orchestrateTask(plan, options);

    expect(result.plan.status).toBe("completed");
    expect(result.plan.subtasks[0].status).toBe("completed");
    expect(result.plan.subtasks[1].status).toBe("completed");
    expect(result.finalReply).toContain("北京");
    expect(mockGenerateAgentReply).toHaveBeenCalledTimes(3); // 2 subtasks + 1 synthesis
  });

  it("continues after subtask failure (graceful degradation)", async () => {
    mockGenerateAgentReply
      .mockRejectedValueOnce(new Error("LLM 超时"))
      .mockResolvedValueOnce({
        text: "上海 28°C 多云",
        messages: [{ role: "assistant", content: "上海 28°C 多云" }],
        toolCallCount: 1,
        stepCount: 1
      });
    // No synthesis needed for single success

    const plan = makePlan(["查询北京天气", "查询上海天气"]);
    const options = makeOptions();

    const result = await orchestrateTask(plan, options);

    expect(result.plan.subtasks[0].status).toBe("failed");
    expect(result.plan.subtasks[0].error).toContain("LLM 超时");
    expect(result.plan.subtasks[1].status).toBe("completed");
    expect(result.plan.status).toBe("completed"); // not "failed" because one subtask succeeded
  });

  it("returns failed status when all subtasks fail", async () => {
    mockGenerateAgentReply
      .mockRejectedValueOnce(new Error("错误1"))
      .mockRejectedValueOnce(new Error("错误2"));

    const plan = makePlan(["任务A", "任务B"]);
    const options = makeOptions();

    const result = await orchestrateTask(plan, options);

    expect(result.plan.status).toBe("failed");
    expect(result.finalReply).toContain("所有子任务都执行失败");
  });

  it("calls onProgress for each subtask", async () => {
    mockGenerateAgentReply.mockResolvedValue({
      text: "结果",
      messages: [{ role: "assistant", content: "结果" }],
      toolCallCount: 0,
      stepCount: 1
    });

    const onProgress = vi.fn().mockResolvedValue(undefined);
    const plan = makePlan(["任务A", "任务B"]);
    const options = makeOptions({ onProgress });

    await orchestrateTask(plan, options);

    expect(onProgress).toHaveBeenCalledTimes(2);
    expect(onProgress.mock.calls[0][0]).toContain("任务A");
    expect(onProgress.mock.calls[1][0]).toContain("任务B");
  });

  it("skips synthesis for single successful subtask", async () => {
    mockGenerateAgentReply.mockResolvedValueOnce({
      text: "唯一结果",
      messages: [{ role: "assistant", content: "唯一结果" }],
      toolCallCount: 0,
      stepCount: 1
    });

    const plan = makePlan(["唯一任务"]);
    const options = makeOptions();

    const result = await orchestrateTask(plan, options);

    // Only 1 subtask call, no synthesis needed
    expect(mockGenerateAgentReply).toHaveBeenCalledTimes(1);
    expect(result.finalReply).toBe("唯一结果");
  });

  it("does not crash when onProgress throws", async () => {
    mockGenerateAgentReply.mockResolvedValue({
      text: "结果",
      messages: [{ role: "assistant", content: "结果" }],
      toolCallCount: 0,
      stepCount: 1
    });

    const onProgress = vi.fn().mockRejectedValue(new Error("发送失败"));
    const plan = makePlan(["任务A"]);
    const options = makeOptions({ onProgress });

    const result = await orchestrateTask(plan, options);

    expect(result.plan.subtasks[0].status).toBe("completed");
  });
});
