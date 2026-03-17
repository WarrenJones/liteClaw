/**
 * Phase 5: 任务编排器。
 * 遍历子任务，逐个调用 Agent Loop，收集结果并汇总。
 */

import { config } from "../config.js";
import { generateAgentReply } from "./llm.js";
import { logError, logInfo, logWarn } from "./logger.js";
import { formatProgress } from "./task-progress.js";
import type { ConversationMessage } from "./store.js";
import type { Subtask, TaskPlan } from "./task-types.js";

export type OrchestrateOptions = {
  chatId: string;
  eventId: string;
  history: ConversationMessage[];
  systemPrompt: string;
  onProgress: (message: string) => Promise<void>;
};

type SubtaskResult = {
  description: string;
  success: boolean;
  text: string;
};

/**
 * 顺序执行 TaskPlan 中的所有子任务，并在最后做一次合成调用。
 * 子任务失败不会中断整个任务（graceful degradation）。
 */
export async function orchestrateTask(
  plan: TaskPlan,
  options: OrchestrateOptions
): Promise<{ plan: TaskPlan; finalReply: string; allMessages: ConversationMessage[] }> {
  plan.status = "in_progress";
  const subtaskResults: SubtaskResult[] = [];
  const allMessages: ConversationMessage[] = [];

  logInfo("orchestrator.started", {
    taskId: plan.taskId,
    chatId: plan.chatId,
    subtaskCount: plan.subtasks.length
  });

  for (let i = 0; i < plan.subtasks.length; i++) {
    const subtask = plan.subtasks[i];
    subtask.status = "in_progress";
    subtask.startedAt = Date.now();

    // 发送进度消息
    if (config.orchestration.progressMessagesEnabled) {
      try {
        await options.onProgress(formatProgress(plan, i));
      } catch (err) {
        logWarn("orchestrator.progress_send_failed", { error: err });
      }
    }

    try {
      // 构建子任务上下文：原始请求 + 之前子任务的结果摘要
      const contextMessages = buildSubtaskContext(
        options.history,
        plan.originalRequest,
        subtask,
        subtaskResults
      );

      const agentResult = await generateAgentReply(contextMessages, {
        chatId: options.chatId,
        eventId: options.eventId,
        userText: subtask.description,
        systemPrompt: options.systemPrompt
      });

      subtask.status = "completed";
      subtask.result = agentResult.text;
      subtask.completedAt = Date.now();
      allMessages.push(...agentResult.messages);

      subtaskResults.push({
        description: subtask.description,
        success: true,
        text: agentResult.text
      });

      logInfo("orchestrator.subtask_completed", {
        taskId: plan.taskId,
        subtaskId: subtask.id,
        index: i,
        durationMs: subtask.completedAt - subtask.startedAt!
      });
    } catch (error) {
      subtask.status = "failed";
      subtask.error = error instanceof Error ? error.message : String(error);
      subtask.completedAt = Date.now();

      subtaskResults.push({
        description: subtask.description,
        success: false,
        text: subtask.error
      });

      logError("orchestrator.subtask_failed", {
        taskId: plan.taskId,
        subtaskId: subtask.id,
        index: i,
        error
      });
    }
  }

  // 合成步骤：将所有子任务结果汇总为一个连贯回复
  const finalReply = await synthesizeResults(plan, subtaskResults, options);

  // 更新整体状态
  const hasFailures = plan.subtasks.some((s) => s.status === "failed");
  const allFailed = plan.subtasks.every((s) => s.status === "failed");
  plan.status = allFailed ? "failed" : "completed";
  plan.completedAt = Date.now();

  logInfo("orchestrator.completed", {
    taskId: plan.taskId,
    status: plan.status,
    totalSubtasks: plan.subtasks.length,
    completedSubtasks: plan.subtasks.filter((s) => s.status === "completed").length,
    failedSubtasks: plan.subtasks.filter((s) => s.status === "failed").length,
    durationMs: plan.completedAt - plan.createdAt
  });

  return { plan, finalReply, allMessages };
}

/**
 * 构建子任务的对话上下文。
 */
function buildSubtaskContext(
  history: ConversationMessage[],
  originalRequest: string,
  currentSubtask: Subtask,
  priorResults: SubtaskResult[]
): ConversationMessage[] {
  const messages: ConversationMessage[] = [...history];

  // 将原始请求和子任务上下文作为用户消息注入
  let contextText = `原始请求：${originalRequest}\n\n当前子任务：${currentSubtask.description}`;

  if (priorResults.length > 0) {
    const priorText = priorResults
      .map((r) => {
        const status = r.success ? "✅" : "❌";
        return `${status} ${r.description}:\n${r.text}`;
      })
      .join("\n\n");
    contextText += `\n\n已完成的子任务结果：\n${priorText}`;
  }

  contextText += "\n\n请完成当前子任务，给出简洁的结果。";

  messages.push({ role: "user", content: contextText });

  return messages;
}

/**
 * 合成步骤：让 LLM 将所有子任务结果汇总为一个连贯回复。
 */
async function synthesizeResults(
  plan: TaskPlan,
  results: SubtaskResult[],
  options: OrchestrateOptions
): Promise<string> {
  // 如果所有子任务都失败，直接返回错误信息
  if (results.every((r) => !r.success)) {
    return "所有子任务都执行失败了，请稍后再试。";
  }

  // 如果只有一个子任务成功，直接返回它的结果
  const successResults = results.filter((r) => r.success);
  if (successResults.length === 1) {
    return successResults[0].text;
  }

  try {
    const resultsText = results
      .map((r) => {
        const status = r.success ? "✅ 成功" : "❌ 失败";
        return `【${r.description}】(${status})\n${r.text}`;
      })
      .join("\n\n");

    const synthesisPrompt = `用户的原始请求是：${plan.originalRequest}

以下是各子任务的执行结果：
${resultsText}

请将以上结果整合为一个连贯、完整的回复，直接回答用户的原始请求。
如果有子任务失败，简要说明即可，重点放在成功的结果上。`;

    const synthesisMessages: ConversationMessage[] = [
      ...options.history,
      { role: "user", content: synthesisPrompt }
    ];

    const agentResult = await generateAgentReply(synthesisMessages, {
      chatId: options.chatId,
      eventId: options.eventId,
      userText: synthesisPrompt,
      systemPrompt: options.systemPrompt
    });

    return agentResult.text;
  } catch (error) {
    logWarn("orchestrator.synthesis_failed", { error });
    // 降级：拼接各子任务结果
    return results
      .filter((r) => r.success)
      .map((r) => `**${r.description}**\n${r.text}`)
      .join("\n\n");
  }
}
