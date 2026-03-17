import { describe, it, expect } from "vitest";

import { formatProgress, formatTaskSummary } from "./task-progress.js";
import type { TaskPlan, Subtask } from "./task-types.js";

function makePlan(
  subtasks: Array<Pick<Subtask, "description" | "status">>
): TaskPlan {
  return {
    taskId: "task_1",
    chatId: "chat_1",
    originalRequest: "测试请求",
    subtasks: subtasks.map((s, i) => ({
      id: `subtask_${i + 1}`,
      description: s.description,
      status: s.status
    })),
    status: "in_progress",
    createdAt: Date.now()
  };
}

describe("formatProgress", () => {
  it("shows current subtask being executed", () => {
    const plan = makePlan([
      { description: "查询北京天气", status: "in_progress" },
      { description: "查询上海天气", status: "pending" },
      { description: "对比分析", status: "pending" }
    ]);

    const result = formatProgress(plan, 0);
    expect(result).toContain("正在执行 (1/3)");
    expect(result).toContain("查询北京天气");
  });

  it("shows completed subtasks before current", () => {
    const plan = makePlan([
      { description: "查询北京天气", status: "completed" },
      { description: "查询上海天气", status: "in_progress" },
      { description: "对比分析", status: "pending" }
    ]);

    const result = formatProgress(plan, 1);
    expect(result).toContain("正在执行 (2/3)");
    expect(result).toContain("查询上海天气");
    expect(result).toContain("✅ 查询北京天气");
  });

  it("shows failed subtasks with ❌", () => {
    const plan = makePlan([
      { description: "查询北京天气", status: "failed" },
      { description: "查询上海天气", status: "in_progress" }
    ]);

    const result = formatProgress(plan, 1);
    expect(result).toContain("❌ 查询北京天气");
  });

  it("handles out-of-range index gracefully", () => {
    const plan = makePlan([{ description: "任务A", status: "completed" }]);
    const result = formatProgress(plan, 5);
    expect(result).toContain("正在处理任务");
  });
});

describe("formatTaskSummary", () => {
  it("shows all success when no failures", () => {
    const plan = makePlan([
      { description: "查询北京天气", status: "completed" },
      { description: "查询上海天气", status: "completed" }
    ]);

    const result = formatTaskSummary(plan);
    expect(result).toContain("2/2 成功");
    expect(result).toContain("✅ 查询北京天气");
    expect(result).toContain("✅ 查询上海天气");
    expect(result).not.toContain("失败");
  });

  it("shows mixed success and failure", () => {
    const plan = makePlan([
      { description: "查询北京天气", status: "completed" },
      { description: "查询上海天气", status: "failed" },
      { description: "对比分析", status: "completed" }
    ]);

    const result = formatTaskSummary(plan);
    expect(result).toContain("2/3 成功");
    expect(result).toContain("1 失败");
    expect(result).toContain("✅ 查询北京天气");
    expect(result).toContain("❌ 查询上海天气");
    expect(result).toContain("✅ 对比分析");
  });

  it("shows all failures", () => {
    const plan = makePlan([
      { description: "任务A", status: "failed" },
      { description: "任务B", status: "failed" }
    ]);

    const result = formatTaskSummary(plan);
    expect(result).toContain("0/2 成功");
    expect(result).toContain("2 失败");
  });
});
