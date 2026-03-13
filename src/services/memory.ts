export type ConversationMessage = {
  role: "user" | "assistant";
  content: string;
};

type EventState = {
  status: "processing" | "done";
  timestamp: number;
};

export class MemoryStore {
  private readonly sessions = new Map<string, ConversationMessage[]>();
  private readonly events = new Map<string, EventState>();

  constructor(
    private readonly maxTurns: number,
    private readonly eventTtlMs: number
  ) {}

  getConversation(chatId: string): ConversationMessage[] {
    return this.sessions.get(chatId) ?? [];
  }

  appendExchange(chatId: string, userText: string, assistantText: string): void {
    const existing = this.getConversation(chatId);
    const next: ConversationMessage[] = [
      ...existing,
      { role: "user", content: userText },
      { role: "assistant", content: assistantText }
    ];

    const maxMessages = Math.max(this.maxTurns, 1) * 2;
    this.sessions.set(chatId, next.slice(-maxMessages));
  }

  resetConversation(chatId: string): void {
    this.sessions.delete(chatId);
  }

  tryStartEvent(eventId: string): boolean {
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

  markEventDone(eventId: string): void {
    if (!this.events.has(eventId)) {
      return;
    }

    this.events.set(eventId, {
      status: "done",
      timestamp: Date.now()
    });
  }

  markEventFailed(eventId: string): void {
    this.events.delete(eventId);
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
