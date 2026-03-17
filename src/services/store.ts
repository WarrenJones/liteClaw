/**
 * 工具调用记录，对应 LLM 返回的 tool_calls。
 */
export type ToolCallRecord = {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
};

/**
 * 对话消息联合类型，支持 4 种角色：
 * - user: 用户输入
 * - assistant: 模型纯文本回复
 * - assistant + toolCalls: 模型决定调用工具（可能附带 content）
 * - tool: 工具执行结果回传
 */
export type ConversationMessage =
  | { role: "user"; content: string }
  | { role: "assistant"; content: string }
  | {
      role: "assistant";
      content: string;
      toolCalls: ToolCallRecord[];
    }
  | {
      role: "tool";
      toolCallId: string;
      toolName: string;
      content: string;
    };

export type ConversationStoreStatus = {
  backend: "memory" | "redis";
  ready: boolean;
  sessionTtlSeconds: number;
  eventDedupeTtlMs: number;
  redisKeyPrefix?: string;
  lastError?: string;
};

export interface ConversationStore {
  initialize(): Promise<void>;
  getConversation(chatId: string): Promise<ConversationMessage[]>;
  appendExchange(
    chatId: string,
    userText: string,
    assistantText: string
  ): Promise<void>;
  appendMessages(
    chatId: string,
    messages: ConversationMessage[]
  ): Promise<void>;
  resetConversation(chatId: string): Promise<void>;
  tryStartEvent(eventId: string): Promise<boolean>;
  markEventDone(eventId: string): Promise<void>;
  markEventFailed(eventId: string): Promise<void>;
  getStatus(): ConversationStoreStatus;
}
