# Phase 1：最小可运行链路

## 1. 目标

让用户可以在飞书里给 LiteClaw 发文本消息，并拿到本地模型生成的回复。

Phase 1 完成后，LiteClaw 将具备：

- **飞书消息接入**：通过长连接接收飞书消息事件，无需公网域名
- **本地模型调用**：通过 OpenAI-compatible 协议调用本地或私有模型
- **多轮上下文**：按 `chat_id` 维护会话历史，支持多轮对话
- **事件去重**：基于 `event_id` 防止重复处理
- **群聊过滤**：群聊中仅在 `@机器人` 时响应

Phase 1 的核心价值是先验证"消息真的能进来、模型真的能调用、结果真的能回去"，而不是一开始就做复杂 Agent 编排。

---

## 2. 与 OpenClaw 的对齐

OpenClaw 的最基本能力就是：**接入消息 → 理解意图 → 生成回复**。

LiteClaw Phase 1 实现了这个最小闭环，选择飞书作为接入层（而非 Web UI），让项目从第一天起就是一个真实可用的聊天机器人。

---

## 3. 实施步骤

| 步骤 | 内容 | 关键文件 | 状态 |
|------|------|----------|------|
| 1a | 项目骨架搭建（Hono + TypeScript + tsx） | `package.json`, `tsconfig.json`, `src/index.ts` | ✅ |
| 1b | 飞书长连接接入 + webhook 兼容 | `src/services/feishu.ts`, `src/routes/feishu.ts` | ✅ |
| 1c | 消息处理与事件去重 | `src/services/feishu-message-handler.ts`, `src/services/memory.ts` | ✅ |
| 1d | LLM 调用 + 多轮上下文 | `src/services/llm.ts`, `src/services/memory.ts` | ✅ |
| 1e | 健康检查 + 配置管理 | `src/config.ts`, `GET /healthz` | ✅ |

---

## 4. 关键链路架构

### 4.1 整体架构（Phase 1）

<p align="center">
  <img src="assets/architecture-phase1.png" alt="Phase 1 Architecture" width="800"/>
</p>

### 4.2 核心数据流

一次典型的消息处理流程：

```
1. 飞书用户发送消息 "你好"
2. 飞书平台通过长连接推送消息事件到 LiteClaw
3. LiteClaw 校验事件类型 → event_id 去重 → 提取文本
4. 读取该 chat_id 的会话历史
5. 调用本地模型（system prompt + history + user message）
6. 模型返回回复文本
7. 保存本轮对话到会话存储
8. 调用飞书 API 发送回复
```

### 4.3 消息格式

飞书消息事件的关键字段：

```typescript
// 飞书推送的消息事件
{
  event: {
    message: {
      chat_id: string;        // 会话 ID
      message_type: "text";   // 消息类型
      content: string;        // JSON 字符串，如 '{"text":"你好"}'
    },
    sender: {
      sender_id: { open_id: string }
    }
  },
  header: {
    event_id: string;         // 用于去重
    event_type: "im.message.receive_v1"
  }
}
```

---

## 5. 技术选型

| 技术 | 选择 | 原因 |
|------|------|------|
| Runtime | Node.js 20+ | 社区成熟，TypeScript 原生支持 |
| Language | TypeScript | 类型安全，与前端统一 |
| HTTP 框架 | Hono | 极轻量，适合作为 runtime 入口 |
| 模型调用 | `ai` + `@ai-sdk/openai-compatible` | Vercel AI SDK，统一的模型接口 |
| 飞书接入 | `@larksuiteoapi/node-sdk` | 官方 SDK，长连接模式 |
| 开发工具 | tsx | TypeScript 直接运行，无需编译 |

---

## 6. 配置项

Phase 1 的核心配置：

```env
# 飞书
FEISHU_APP_ID=your-feishu-app-id
FEISHU_APP_SECRET=your-feishu-app-secret
FEISHU_CONNECTION_MODE=long-connection

# 模型
MODEL_BASE_URL=http://localhost:8000/v1
MODEL_API_KEY=your-local-model-api-key
MODEL_ID=your-model-id

# 基础配置
PORT=3000
SYSTEM_PROMPT=你是 liteClaw，一个简洁可靠的中文助手。
SESSION_MAX_TURNS=10
```

---

## 7. 关键模块

| 模块 | 文件 | 职责 |
|------|------|------|
| 启动入口 | `src/index.ts` | Hono 服务 + 飞书长连接初始化 |
| 飞书服务 | `src/services/feishu.ts` | 长连接管理 + 发送消息 API |
| 消息处理 | `src/services/feishu-message-handler.ts` | 事件分发 + 去重 + 群聊过滤 |
| LLM 适配 | `src/services/llm.ts` | OpenAI-compatible 模型调用 |
| 会话存储 | `src/services/memory.ts` | 进程内 Map，按 chat_id 存储 |
| 配置管理 | `src/config.ts` | 环境变量读取 + 默认值 |
| 类型定义 | `src/types/feishu.ts` | 飞书事件类型 |

---

## 8. 完成标准

- [x] 飞书长连接能收到消息事件
- [x] Webhook 兼容回退可用
- [x] 消息文本正确解析
- [x] `event_id` 去重正常工作
- [x] 群聊中仅 `@机器人` 时响应
- [x] 本地模型调用成功
- [x] 多轮上下文正确维护
- [x] 飞书回复消息正常发送
- [x] `GET /healthz` 返回健康状态

---

## 9. 飞书接入指南

LiteClaw 默认使用飞书长连接模式，本地开发无需公网域名或 tunnel。

基本步骤：

1. 在飞书开放平台创建企业自建应用
2. 为应用开启机器人能力
3. 开启事件订阅，选择长连接模式
4. 订阅 `im.message.receive_v1`
5. 发布应用并开始本地联调

详细配置见 [飞书配置指南](feishu-config.md)。
