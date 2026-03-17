/**
 * Phase 5: 任务规划器。
 * 使用 LLM 判断用户请求是否需要分解为多个子任务。
 */

import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { generateText } from "ai";

import { config } from "../config.js";
import { logDebug, logInfo, logWarn } from "./logger.js";
import type { PlanResult } from "./task-types.js";

const provider = createOpenAICompatible({
  name: "local-openai-compatible",
  apiKey: config.model.apiKey,
  baseURL: config.model.baseURL
});

const PLANNER_SYSTEM_PROMPT = `你是一个任务规划助手。给定用户的请求，判断是否需要拆分为多个子任务来完成。

判断标准：
- 如果用户明确要求多个不同的操作（如"查A和B然后对比"、"先做X再做Y"），标记为多步任务
- 如果是单一问题或简单请求（如"今天天气怎么样"、"你好"），标记为非多步任务
- 如果不确定，标记为非多步任务

输出 JSON 格式，不要其他内容：
{"isMultiStep": true/false, "subtasks": [{"description": "子任务描述"}]}

如果 isMultiStep 为 false，subtasks 应为空数组。
每个子任务描述应简洁明确，便于独立执行。`;

/**
 * 分析用户请求，判断是否需要多步任务编排。
 * 对于简单请求返回 isMultiStep: false，零额外开销走原有 Agent Loop。
 */
export async function planTask(userText: string): Promise<PlanResult> {
  const fallback: PlanResult = { isMultiStep: false, subtasks: [] };

  if (!config.orchestration.enabled) {
    return fallback;
  }

  try {
    logDebug("task_planner.started", { userTextLength: userText.length });

    const result = await generateText({
      model: provider(config.model.id),
      system: PLANNER_SYSTEM_PROMPT,
      messages: [{ role: "user", content: userText }]
    });

    const parsed = parsePlanJSON(result.text.trim());

    if (!parsed.isMultiStep || parsed.subtasks.length === 0) {
      logDebug("task_planner.single_step", {});
      return fallback;
    }

    // 限制子任务数量
    const maxSubtasks = config.orchestration.maxSubtasks;
    const subtasks = parsed.subtasks.slice(0, maxSubtasks);

    logInfo("task_planner.multi_step", {
      subtaskCount: subtasks.length,
      subtasks: subtasks.map((s) => s.description)
    });

    return { isMultiStep: true, subtasks };
  } catch (error) {
    logWarn("task_planner.failed", { error });
    return fallback;
  }
}

/**
 * 容错解析 LLM 返回的 JSON 规划结果。
 */
function parsePlanJSON(text: string): PlanResult {
  const fallback: PlanResult = { isMultiStep: false, subtasks: [] };

  // 先尝试直接解析
  try {
    const obj = JSON.parse(text);
    return validatePlanResult(obj) ?? fallback;
  } catch {
    // fallback: 尝试从 markdown code block 或文本中提取 JSON
  }

  // 正则提取 {...} 块
  const match = text.match(/\{[\s\S]*\}/);
  if (match) {
    try {
      const obj = JSON.parse(match[0]);
      return validatePlanResult(obj) ?? fallback;
    } catch {
      // 解析失败
    }
  }

  return fallback;
}

function validatePlanResult(
  obj: unknown
): PlanResult | null {
  if (!obj || typeof obj !== "object") return null;

  const record = obj as Record<string, unknown>;
  if (typeof record.isMultiStep !== "boolean") return null;

  if (!record.isMultiStep) {
    return { isMultiStep: false, subtasks: [] };
  }

  if (!Array.isArray(record.subtasks)) return null;

  const subtasks = record.subtasks
    .filter(
      (s): s is { description: string } =>
        s &&
        typeof s === "object" &&
        typeof (s as Record<string, unknown>).description === "string" &&
        ((s as Record<string, unknown>).description as string).length > 0
    )
    .map((s) => ({ description: s.description }));

  if (subtasks.length === 0) return null;

  return { isMultiStep: true, subtasks };
}
