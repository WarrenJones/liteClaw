export type ConversationMessage = {
  role: "user" | "assistant";
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
  resetConversation(chatId: string): Promise<void>;
  tryStartEvent(eventId: string): Promise<boolean>;
  markEventDone(eventId: string): Promise<void>;
  markEventFailed(eventId: string): Promise<void>;
  getStatus(): ConversationStoreStatus;
}
