import { config } from "../config.js";
import { MemoryStore } from "./memory.js";
import { RedisStore } from "./redis-store.js";
import type { ConversationStore, ConversationStoreStatus } from "./store.js";

const conversationStore: ConversationStore =
  config.storage.backend === "redis"
    ? new RedisStore(
        config.storage.redisUrl!,
        config.storage.redisKeyPrefix,
        config.sessionMaxTurns,
        config.eventDedupeTtlMs,
        config.sessionTtlSeconds
      )
    : new MemoryStore(
        config.sessionMaxTurns,
        config.eventDedupeTtlMs,
        config.sessionTtlSeconds
      );

export async function initializeConversationStore(): Promise<void> {
  await conversationStore.initialize();
}

export function getConversationStoreStatus(): ConversationStoreStatus {
  return conversationStore.getStatus();
}

export { conversationStore };
