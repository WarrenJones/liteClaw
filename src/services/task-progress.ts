/**
 * Phase 5: 任务进度格式化工具。
 * 纯函数，无外部依赖。
 */

import type { TaskPlan } from "./task-types.js";

const STATUS_ICONS: Record<string, string> = {
  completed: "✅",
  failed: "❌",
  in_progress: "⏳",
  pending: "⬜"
};

/**
 * 格式化当前进度消息，在子任务开始执行时发送给用户。
 *
 * 示例输出:
 * ⏳ 正在执行 (2/3): 查询上海天气...
 * ✅ 查询北京天气
 */
export function formatProgress(
  plan: TaskPlan,
  currentIndex: number
): string {
  const total = plan.subtasks.length;
  const current = plan.subtasks[currentIndex];

  if (!current) {
    return `⏳ 正在处理任务...`;
  }

  const lines: string[] = [];

  // 当前正在执行的子任务
  lines.push(
    `⏳ 正在执行 (${currentIndex + 1}/${total}): ${current.description}...`
  );

  // 已完成/已失败的子任务
  for (let i = 0; i < currentIndex; i++) {
    const sub = plan.subtasks[i];
    const icon = STATUS_ICONS[sub.status] ?? "⬜";
    lines.push(`${icon} ${sub.description}`);
  }

  return lines.join("\n");
}

/**
 * 格式化任务完成后的汇总信息。
 *
 * 示例输出:
 * 📋 任务完成 (2/3 成功)
 * ✅ 查询北京天气
 * ✅ 查询上海天气
 * ❌ 对比分析
 */
export function formatTaskSummary(plan: TaskPlan): string {
  const total = plan.subtasks.length;
  const completed = plan.subtasks.filter((s) => s.status === "completed").length;
  const failed = plan.subtasks.filter((s) => s.status === "failed").length;

  const lines: string[] = [];

  if (failed === 0) {
    lines.push(`📋 任务完成 (${completed}/${total} 成功)`);
  } else {
    lines.push(`📋 任务完成 (${completed}/${total} 成功，${failed} 失败)`);
  }

  for (const sub of plan.subtasks) {
    const icon = STATUS_ICONS[sub.status] ?? "⬜";
    lines.push(`${icon} ${sub.description}`);
  }

  return lines.join("\n");
}
