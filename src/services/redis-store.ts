import { createClient, type RedisClientType } from "redis";

import type {
  ConversationMessage,
  ConversationStore,
  ConversationStoreStatus
} from "./store.js";

function parseConversationMessage(value: string): ConversationMessage {
  const parsed = JSON.parse(value) as ConversationMessage;
  if (
    (parsed.role !== "user" && parsed.role !== "assistant") ||
    typeof parsed.content !== "string"
  ) {
    throw new Error("Invalid conversation message payload in Redis");
  }

  return parsed;
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
      console.error("Redis client error", error);
    });

    this.client.on("ready", () => {
      this.status.ready = true;
      this.status.lastError = undefined;
    });

    this.client.on("end", () => {
      this.status.ready = false;
    });
  }

  async initialize(): Promise<void> {
    if (this.client.isOpen) {
      return;
    }

    await this.client.connect();
    this.status.ready = true;
    this.status.lastError = undefined;
  }

  async getConversation(chatId: string): Promise<ConversationMessage[]> {
    const messages = await this.client.lRange(this.sessionKey(chatId), 0, -1);
    return messages.map(parseConversationMessage);
  }

  async appendExchange(
    chatId: string,
    userText: string,
    assistantText: string
  ): Promise<void> {
    const key = this.sessionKey(chatId);
    const maxMessages = Math.max(this.maxTurns, 1) * 2;

    await this.client
      .multi()
      .rPush(key, [
        JSON.stringify({ role: "user", content: userText }),
        JSON.stringify({ role: "assistant", content: assistantText })
      ])
      .lTrim(key, -maxMessages, -1)
      .expire(key, this.sessionTtlSeconds)
      .exec();
  }

  async resetConversation(chatId: string): Promise<void> {
    await this.client.del(this.sessionKey(chatId));
  }

  async tryStartEvent(eventId: string): Promise<boolean> {
    const result = await this.client.set(this.eventKey(eventId), "processing", {
      PX: this.eventTtlMs,
      NX: true
    });

    return result === "OK";
  }

  async markEventDone(eventId: string): Promise<void> {
    await this.client.set(this.eventKey(eventId), "done", {
      PX: this.eventTtlMs,
      XX: true
    });
  }

  async markEventFailed(eventId: string): Promise<void> {
    await this.client.del(this.eventKey(eventId));
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
}
