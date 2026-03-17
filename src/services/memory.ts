import type {
  ConversationMessage,
  ConversationStore,
  ConversationStoreStatus,
  ConversationSummary,
  UserFact
} from "./store.js";

type EventState = {
  status: "processing" | "done";
  timestamp: number;
};

export class MemoryStore implements ConversationStore {
  private readonly sessions = new Map<string, ConversationMessage[]>();
  private readonly summaries = new Map<string, ConversationSummary>();
  private readonly facts = new Map<string, UserFact[]>();
  private readonly events = new Map<string, EventState>();
  private readonly status: ConversationStoreStatus;

  constructor(
    private readonly maxTurns: number,
    private readonly eventTtlMs: number,
    private readonly sessionTtlSeconds: number
  ) {
    this.status = {
      backend: "memory",
      ready: true,
      sessionTtlSeconds,
      eventDedupeTtlMs: eventTtlMs
    };
  }

  async initialize(): Promise<void> {
    return;
  }

  async getConversation(chatId: string): Promise<ConversationMessage[]> {
    return this.sessions.get(chatId) ?? [];
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
    const existing = await this.getConversation(chatId);
    const next = [...existing, ...messages];

    // 按消息条数上限裁剪（工具调用会产生更多消息，所以放宽到 4 倍 turns）
    const maxMessages = Math.max(this.maxTurns, 1) * 4;
    this.sessions.set(chatId, next.slice(-maxMessages));
  }

  async resetConversation(chatId: string): Promise<void> {
    this.sessions.delete(chatId);
    this.summaries.delete(chatId);
    // facts 不删除 — 长期记忆跨会话保留
  }

  // --- Summary ---

  async getSummary(chatId: string): Promise<ConversationSummary | null> {
    return this.summaries.get(chatId) ?? null;
  }

  async setSummary(
    chatId: string,
    summary: ConversationSummary
  ): Promise<void> {
    this.summaries.set(chatId, summary);
  }

  // --- Facts ---

  async getFacts(chatId: string): Promise<UserFact[]> {
    return this.facts.get(chatId) ?? [];
  }

  async setFact(chatId: string, fact: UserFact): Promise<void> {
    const existing = this.facts.get(chatId) ?? [];
    const idx = existing.findIndex((f) => f.key === fact.key);

    if (idx >= 0) {
      existing[idx] = fact;
    } else {
      existing.push(fact);
    }

    this.facts.set(chatId, existing);
  }

  async deleteFact(chatId: string, key: string): Promise<void> {
    const existing = this.facts.get(chatId);
    if (!existing) return;
    this.facts.set(
      chatId,
      existing.filter((f) => f.key !== key)
    );
  }

  async clearFacts(chatId: string): Promise<void> {
    this.facts.delete(chatId);
  }

  async tryStartEvent(eventId: string): Promise<boolean> {
    this.cleanupExpiredEvents();

    const existing = this.events.get(eventId);
    if (existing) {
      return false;
    }

    this.events.set(eventId, {
      status: "processing",
      timestamp: Date.now()
    });

    return true;
  }

  async markEventDone(eventId: string): Promise<void> {
    if (!this.events.has(eventId)) {
      return;
    }

    this.events.set(eventId, {
      status: "done",
      timestamp: Date.now()
    });
  }

  async markEventFailed(eventId: string): Promise<void> {
    this.events.delete(eventId);
  }

  getStatus(): ConversationStoreStatus {
    return { ...this.status };
  }

  private cleanupExpiredEvents(): void {
    const now = Date.now();

    for (const [eventId, state] of this.events) {
      if (now - state.timestamp > this.eventTtlMs) {
        this.events.delete(eventId);
      }
    }
  }
}
