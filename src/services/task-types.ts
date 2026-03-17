/**
 * Phase 5: 多步任务编排类型定义。
 */

export type SubtaskStatus = "pending" | "in_progress" | "completed" | "failed";

export type Subtask = {
  id: string;
  description: string;
  status: SubtaskStatus;
  result?: string;
  error?: string;
  startedAt?: number;
  completedAt?: number;
};

export type TaskPlan = {
  taskId: string;
  chatId: string;
  originalRequest: string;
  subtasks: Subtask[];
  status: SubtaskStatus;
  createdAt: number;
  completedAt?: number;
};

export type PlanResult = {
  isMultiStep: boolean;
  subtasks: Array<{ description: string }>;
};
