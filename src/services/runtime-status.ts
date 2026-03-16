import { config } from "../config.js";
import { getConversationStoreStatus } from "./conversation-store.js";
import { getFeishuLongConnectionState } from "./feishu.js";

type RuntimeStatusDependencies = {
  listAvailableToolNames?: () => string[];
};

export type RuntimeSnapshot = {
  service: "liteclaw";
  storage: ReturnType<typeof getConversationStoreStatus>;
  feishuConnectionMode: typeof config.feishu.connectionMode;
  feishuLongConnection?:
    | ReturnType<typeof getFeishuLongConnectionState>
    | undefined;
  resilience: {
    logLevel: typeof config.logLevel;
    llmTimeoutMs: number;
    llmMaxRetries: number;
    llmRetryDelayMs: number;
    feishuRequestTimeoutMs: number;
    storageOperationTimeoutMs: number;
    rateLimitMaxMessages: number;
    rateLimitWindowMs: number;
  };
  tooling: {
    availableTools: string[];
  };
};

const dependencies: RuntimeStatusDependencies = {};

export function registerRuntimeStatusDependencies(
  nextDependencies: RuntimeStatusDependencies
): void {
  Object.assign(dependencies, nextDependencies);
}

export function getRuntimeSnapshot(): RuntimeSnapshot {
  return {
    service: "liteclaw",
    storage: getConversationStoreStatus(),
    feishuConnectionMode: config.feishu.connectionMode,
    feishuLongConnection:
      config.feishu.connectionMode === "long-connection"
        ? getFeishuLongConnectionState()
        : undefined,
    resilience: {
      logLevel: config.logLevel,
      llmTimeoutMs: config.model.timeoutMs,
      llmMaxRetries: config.model.maxRetries,
      llmRetryDelayMs: config.model.retryDelayMs,
      feishuRequestTimeoutMs: config.timeouts.feishuRequestMs,
      storageOperationTimeoutMs: config.timeouts.storageOperationMs,
      rateLimitMaxMessages: config.rateLimit.maxMessages,
      rateLimitWindowMs: config.rateLimit.windowMs
    },
    tooling: {
      availableTools: dependencies.listAvailableToolNames?.() ?? []
    }
  };
}
