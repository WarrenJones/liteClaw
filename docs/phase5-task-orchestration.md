# Phase 5：多步任务编排

> 让 Agent 从"单次回复"升级到"规划 → 分步执行 → 进度反馈 → 汇总回复"。

---

## 1. 目标

Phase 4 的 Agent Loop 虽然可以在一轮对话中连续调用多个工具，但对于复杂请求（如"查北京和上海天气然后对比"）存在两个问题：

1. **无显式任务分解**：模型在一个大循环中处理所有步骤，逻辑不透明
2. **无进度反馈**：用户只能等待最终结果，体验差

Phase 5 在现有 Agent Loop **之上**增加编排层，解决这两个问题。

---

## 2. 架构设计

<p align="center">
  <img src="assets/architecture-phase5.png" alt="Phase 5 Task Orchestration Architecture" width="800"/>
</p>

编排层位于 Agent Loop 之上，不替换原有流程：

| 组件 | 职责 | 触发时机 |
|------|------|---------|
| **Task Planner** | LLM 判断是否多步任务，输出子任务列表 | 每条用户消息（启用时） |
| **Task Orchestrator** | 顺序执行子任务 + 合成最终回复 | Planner 返回 isMultiStep: true |
| **Task Progress** | 格式化进度消息 | 每个子任务开始执行时 |

关键设计：
- 简单请求 `isMultiStep: false`，直接走原 Agent Loop，**零额外开销**
- 每个子任务复用 `generateAgentReply`，拥有完整工具集
- 默认关闭（`ORCHESTRATION_ENABLED=false`），需显式开启

---

## 3. 数据模型

### TaskPlan

```typescript
type SubtaskStatus = "pending" | "in_progress" | "completed" | "failed";

type Subtask = {
  id: string;              // "subtask_1"
  description: string;     // "查询北京天气"
  status: SubtaskStatus;
  result?: string;         // 完成时的 agent 回复
  error?: string;          // 失败时的错误信息
  startedAt?: number;
  completedAt?: number;
};

type TaskPlan = {
  taskId: string;
  chatId: string;
  originalRequest: string;
  subtasks: Subtask[];
  status: SubtaskStatus;   // 整体状态
  createdAt: number;
  completedAt?: number;
};
```

### PlanResult

```typescript
type PlanResult = {
  isMultiStep: boolean;
  subtasks: Array<{ description: string }>;
};
```

---

## 4. 消息处理流程

```
1. getConversation + getSummary + getFacts     — 不变
2. maybeSummarize                              — 不变
3. buildSystemPrompt                           — 不变
4. planTask(userText)                          — 新增：LLM 判断是否多步
5a. isMultiStep: true
    → 构建 TaskPlan
    → orchestrateTask(plan, options)
      → subtask 1: generateAgentReply → 进度消息
      → subtask 2: generateAgentReply → 进度消息
      → ...
      → 合成步骤: generateAgentReply（汇总所有结果）
    → sendTextMessage（最终回复）
5b. isMultiStep: false
    → generateAgentReply（原有 Agent Loop）   — 不变
6. appendMessages                              — 不变
7. extractFacts（后台异步）                     — 不变
```

---

## 5. Task Planner 策略

- 使用单次 `generateText` 调用（无 tools），让 LLM 判断是否需要分解
- 输出 JSON 格式：`{ isMultiStep: boolean, subtasks: [{ description }] }`
- 容错：JSON 解析失败 → 降级为 `isMultiStep: false`（走原有 Agent Loop）
- 子任务数量受 `ORCHESTRATION_MAX_SUBTASKS` 限制（默认 5）

判断标准：
- 多个明确不同的操作 → 多步（如"查 A 和 B 然后对比"）
- 单一问题 → 非多步（如"今天天气怎么样"）
- 不确定 → 非多步（保守策略）

---

## 6. Task Orchestrator 策略

- 顺序执行子任务（V1 不支持并行）
- 每个子任务复用 `generateAgentReply`，拥有完整工具集
- 子任务上下文包含：原始请求 + 之前子任务的结果
- **Graceful Degradation**：子任务失败不中断整个任务
- 所有子任务完成后，做一次合成调用汇总结果

合成步骤优化：
- 所有子任务失败 → 返回固定错误信息，不做合成调用
- 仅一个子任务成功 → 直接返回该结果，跳过合成
- 多个子任务成功 → LLM 合成为连贯回复

---

## 7. 进度反馈

通过飞书消息向用户发送进度更新：

```
⏳ 正在执行 (1/3): 查询北京天气...

⏳ 正在执行 (2/3): 查询上海天气...
✅ 查询北京天气

⏳ 正在执行 (3/3): 对比分析...
✅ 查询北京天气
✅ 查询上海天气
```

可通过 `ORCHESTRATION_PROGRESS_ENABLED=false` 关闭。

---

## 8. 配置项

```env
# 任务编排
ORCHESTRATION_ENABLED=false            # 是否启用多步任务编排
ORCHESTRATION_MAX_SUBTASKS=5           # 最大子任务数
ORCHESTRATION_PROGRESS_ENABLED=true    # 是否发送进度消息
```

---

## 9. 完成标准

- [x] TaskPlan / Subtask 类型定义
- [x] Task Planner: LLM 判断 + JSON 容错解析
- [x] Task Orchestrator: 顺序执行 + 合成汇总
- [x] Task Progress: 格式化进度 + 完成汇总
- [x] 集成到 feishu-message-handler（编排门控）
- [x] 默认关闭，启用后零影响简单请求
- [x] Graceful Degradation（子任务失败不中断）
- [x] 单元测试覆盖 planner、orchestrator、progress
- [x] 96 个测试全部通过
