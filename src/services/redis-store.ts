import { createClient, type RedisClientType } from "redis";

import { config } from "../config.js";
import { LiteClawError } from "./errors.js";
import { logError, logInfo } from "./logger.js";
import { withTimeout } from "./resilience.js";
import type {
  ConversationMessage,
  ConversationStore,
  ConversationStoreStatus,
  ConversationSummary,
  UserFact
} from "./store.js";

function parseConversationMessage(value: string): ConversationMessage {
  const parsed = JSON.parse(value) as Record<string, unknown>;

  if (parsed.role === "tool" && typeof parsed.content === "string") {
    return parsed as ConversationMessage;
  }

  if (
    (parsed.role === "user" || parsed.role === "assistant") &&
    typeof parsed.content === "string"
  ) {
    return parsed as ConversationMessage;
  }

  throw new Error("Invalid conversation message payload in Redis");
}

export class RedisStore implements ConversationStore {
  private readonly client: RedisClientType;
  private readonly status: ConversationStoreStatus;

  constructor(
    redisUrl: string,
    private readonly keyPrefix: string,
    private readonly maxTurns: number,
    private readonly eventTtlMs: number,
    private readonly sessionTtlSeconds: number
  ) {
    this.client = createClient({ url: redisUrl });
    this.status = {
      backend: "redis",
      ready: false,
      sessionTtlSeconds,
      eventDedupeTtlMs: eventTtlMs,
      redisKeyPrefix: keyPrefix
    };

    this.client.on("error", (error) => {
      this.status.ready = false;
      this.status.lastError =
        error instanceof Error ? error.message : String(error);
      logError("store.redis.client_error", {
        backend: "redis",
        error
      });
    });

    this.client.on("ready", () => {
      this.status.ready = true;
      this.status.lastError = undefined;
      logInfo("store.redis.ready", {
        backend: "redis",
        keyPrefix: this.keyPrefix
      });
    });

    this.client.on("end", () => {
      this.status.ready = false;
    });
  }

  async initialize(): Promise<void> {
    if (this.client.isOpen) {
      return;
    }

    await this.execute("initialize", () => this.client.connect());
    this.status.ready = true;
    this.status.lastError = undefined;
  }

  async getConversation(chatId: string): Promise<ConversationMessage[]> {
    const messages = await this.execute("get_conversation", () =>
      this.client.lRange(this.sessionKey(chatId), 0, -1)
    );
    return messages.map(parseConversationMessage);
  }

  async appendExchange(
    chatId: string,
    userText: string,
    assistantText: string
  ): Promise<void> {
    await this.appendMessages(chatId, [
      { role: "user", content: userText },
      { role: "assistant", content: assistantText }
    ]);
  }

  async appendMessages(
    chatId: string,
    messages: ConversationMessage[]
  ): Promise<void> {
    const key = this.sessionKey(chatId);
    const maxMessages = Math.max(this.maxTurns, 1) * 4;
    const serialized = messages.map((m) => JSON.stringify(m));

    await this.execute("append_messages", async () => {
      await this.client
        .multi()
        .rPush(key, serialized)
        .lTrim(key, -maxMessages, -1)
        .expire(key, this.sessionTtlSeconds)
        .exec();
    });
  }

  async resetConversation(chatId: string): Promise<void> {
    await this.execute("reset_conversation", async () => {
      await this.client
        .multi()
        .del(this.sessionKey(chatId))
        .del(this.summaryKey(chatId))
        // facts 不删除 — 长期记忆跨会话保留
        .exec();
    });
  }

  // --- Summary ---

  async getSummary(chatId: string): Promise<ConversationSummary | null> {
    const raw = await this.execute("get_summary", () =>
      this.client.get(this.summaryKey(chatId))
    );
    if (!raw) return null;
    return JSON.parse(raw) as ConversationSummary;
  }

  async setSummary(
    chatId: string,
    summary: ConversationSummary
  ): Promise<void> {
    await this.execute("set_summary", () =>
      this.client.set(this.summaryKey(chatId), JSON.stringify(summary), {
        EX: this.sessionTtlSeconds
      })
    );
  }

  // --- Facts ---

  async getFacts(chatId: string): Promise<UserFact[]> {
    const raw = await this.execute("get_facts", () =>
      this.client.hGetAll(this.factsKey(chatId))
    );
    return Object.entries(raw).map(([key, value]) => {
      const parsed = JSON.parse(value) as { value: string; updatedAt: number };
      return { key, value: parsed.value, updatedAt: parsed.updatedAt };
    });
  }

  async setFact(chatId: string, fact: UserFact): Promise<void> {
    const factsKeyStr = this.factsKey(chatId);
    const payload = JSON.stringify({
      value: fact.value,
      updatedAt: fact.updatedAt
    });
    await this.execute("set_fact", async () => {
      await this.client
        .multi()
        .hSet(factsKeyStr, fact.key, payload)
        .expire(factsKeyStr, this.sessionTtlSeconds * 4)
        .exec();
    });
  }

  async deleteFact(chatId: string, key: string): Promise<void> {
    await this.execute("delete_fact", () =>
      this.client.hDel(this.factsKey(chatId), key)
    );
  }

  async clearFacts(chatId: string): Promise<void> {
    await this.execute("clear_facts", () =>
      this.client.del(this.factsKey(chatId))
    );
  }

  async tryStartEvent(eventId: string): Promise<boolean> {
    const result = await this.execute("try_start_event", () =>
      this.client.set(this.eventKey(eventId), "processing", {
        PX: this.eventTtlMs,
        NX: true
      })
    );

    return result === "OK";
  }

  async markEventDone(eventId: string): Promise<void> {
    await this.execute("mark_event_done", () =>
      this.client.set(this.eventKey(eventId), "done", {
        PX: this.eventTtlMs,
        XX: true
      })
    );
  }

  async markEventFailed(eventId: string): Promise<void> {
    await this.execute("mark_event_failed", () =>
      this.client.del(this.eventKey(eventId))
    );
  }

  getStatus(): ConversationStoreStatus {
    return { ...this.status };
  }

  private sessionKey(chatId: string): string {
    return `${this.keyPrefix}:session:${chatId}`;
  }

  private eventKey(eventId: string): string {
    return `${this.keyPrefix}:event:${eventId}`;
  }

  private summaryKey(chatId: string): string {
    return `${this.keyPrefix}:summary:${chatId}`;
  }

  private factsKey(chatId: string): string {
    return `${this.keyPrefix}:facts:${chatId}`;
  }

  private async execute<T>(
    operation: string,
    runner: () => Promise<T>
  ): Promise<T> {
    try {
      return await withTimeout(runner, {
        operation: `redis_${operation}`,
        timeoutMs: config.timeouts.storageOperationMs,
        category: "storage",
        details: {
          backend: "redis",
          keyPrefix: this.keyPrefix
        }
      });
    } catch (error) {
      throw new LiteClawError(`Redis store operation failed: ${operation}`, {
        code: "conversation_store_operation_failed",
        category: "storage",
        retryable: true,
        details: {
          backend: "redis",
          operation,
          keyPrefix: this.keyPrefix
        },
        cause: error
      });
    }
  }
}
