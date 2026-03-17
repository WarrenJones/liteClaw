import { z } from "zod";

import { config } from "../../config.js";
import { getRuntimeSnapshot } from "../runtime-status.js";
import type { LiteClawTool } from "../tools.js";

function formatConnectionStatus(
  status: ReturnType<typeof getRuntimeSnapshot>["feishuLongConnection"]
): string {
  if (!status) {
    return "webhook 模式未启用长连接";
  }

  if (status.status === "connected") {
    return "已连接";
  }

  if (status.status === "starting") {
    return "启动中";
  }

  if (status.status === "reconnecting") {
    return "重连中";
  }

  return "异常";
}

export const localStatusTool: LiteClawTool = {
  name: "local_status",
  description: "查看 LiteClaw 当前运行状态、存储状态和基础稳定性配置。",
  parameters: z.object({}),
  async run() {
    const snapshot = getRuntimeSnapshot();

    const lines = [
      "LiteClaw 当前状态：",
      `- 飞书模式：${snapshot.feishuConnectionMode}`,
      `- 飞书连接：${formatConnectionStatus(snapshot.feishuLongConnection)}`,
      `- 会话存储：${snapshot.storage.backend} (${snapshot.storage.ready ? "ready" : "not ready"})`,
      `- 会话 TTL：${snapshot.storage.sessionTtlSeconds} 秒`,
      `- 事件去重 TTL：${snapshot.storage.eventDedupeTtlMs} ms`,
      `- 模型 ID：${config.model.id}`,
      `- 模型超时：${snapshot.resilience.llmTimeoutMs} ms`,
      `- 模型重试：${snapshot.resilience.llmMaxRetries} 次`,
      `- 飞书请求超时：${snapshot.resilience.feishuRequestTimeoutMs} ms`,
      `- 存储操作超时：${snapshot.resilience.storageOperationTimeoutMs} ms`,
      `- 限流：${snapshot.resilience.rateLimitMaxMessages} 条 / ${snapshot.resilience.rateLimitWindowMs} ms`,
      `- 已注册工具：${
        snapshot.tooling.availableTools.length > 0
          ? snapshot.tooling.availableTools.join(", ")
          : "无"
      }`
    ];

    if (snapshot.feishuLongConnection?.lastError) {
      lines.push(`- 最近长连接错误：${snapshot.feishuLongConnection.lastError}`);
    }

    return {
      text: lines.join("\n"),
      metadata: {
        snapshot
      }
    };
  }
};
