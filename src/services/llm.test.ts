import { describe, it, expect, vi } from "vitest";

vi.mock("@ai-sdk/openai-compatible", () => ({
  createOpenAICompatible: vi.fn(() => vi.fn())
}));
vi.mock("ai", () => ({ generateText: vi.fn(), stepCountIs: vi.fn() }));
vi.mock("../config.js", () => ({
  config: {
    model: {
      apiKey: "k",
      baseURL: "http://localhost",
      id: "m",
      timeoutMs: 1000,
      maxRetries: 0,
      retryDelayMs: 0
    },
    systemPrompt: "test",
    agent: {
      maxToolRounds: 3,
      toolExecutionTimeoutMs: 5000,
      httpFetchAllowedDomains: []
    }
  }
}));
vi.mock("./errors.js", async () => await vi.importActual("./errors.js"));
vi.mock("./logger.js", () => ({
  logInfo: vi.fn(),
  logDebug: vi.fn(),
  logWarn: vi.fn(),
  logError: vi.fn()
}));
vi.mock("./resilience.js", () => ({
  withTimeout: vi.fn((fn: Function) => fn()),
  withRetry: vi.fn((fn: Function) => fn(0))
}));
vi.mock("./tools.js", () => ({ toAISDKTools: vi.fn(() => ({})) }));

import { toSDKMessages, convertResponseMessages } from "./llm.js";
import type { ConversationMessage } from "./store.js";

describe("toSDKMessages", () => {
  it("converts a user message", () => {
    const messages: ConversationMessage[] = [
      { role: "user", content: "hello" }
    ];

    expect(toSDKMessages(messages)).toEqual([
      { role: "user", content: "hello" }
    ]);
  });

  it("converts a plain assistant message", () => {
    const messages: ConversationMessage[] = [
      { role: "assistant", content: "hi there" }
    ];

    expect(toSDKMessages(messages)).toEqual([
      { role: "assistant", content: "hi there" }
    ]);
  });

  it("converts an assistant message with tool calls", () => {
    const messages: ConversationMessage[] = [
      {
        role: "assistant",
        content: "Let me check",
        toolCalls: [
          { id: "tc1", name: "search", arguments: { query: "weather" } }
        ]
      }
    ];

    const result = toSDKMessages(messages);

    expect(result).toEqual([
      {
        role: "assistant",
        content: [
          { type: "text", text: "Let me check" },
          {
            type: "tool-call",
            toolCallId: "tc1",
            toolName: "search",
            args: { query: "weather" }
          }
        ]
      }
    ]);
  });

  it("converts an assistant message with tool calls but empty content", () => {
    const messages: ConversationMessage[] = [
      {
        role: "assistant",
        content: "",
        toolCalls: [
          { id: "tc2", name: "fetch", arguments: { url: "http://x.com" } }
        ]
      }
    ];

    const result = toSDKMessages(messages);

    // empty content should be omitted from parts array
    expect(result).toEqual([
      {
        role: "assistant",
        content: [
          {
            type: "tool-call",
            toolCallId: "tc2",
            toolName: "fetch",
            args: { url: "http://x.com" }
          }
        ]
      }
    ]);
  });

  it("converts a tool message", () => {
    const messages: ConversationMessage[] = [
      {
        role: "tool",
        toolCallId: "tc1",
        toolName: "search",
        content: "some result"
      }
    ];

    expect(toSDKMessages(messages)).toEqual([
      {
        role: "tool",
        content: [
          {
            type: "tool-result",
            toolCallId: "tc1",
            toolName: "search",
            result: "some result"
          }
        ]
      }
    ]);
  });

  it("converts a mixed conversation in order", () => {
    const messages: ConversationMessage[] = [
      { role: "user", content: "What is the weather?" },
      {
        role: "assistant",
        content: "",
        toolCalls: [
          { id: "tc1", name: "weather", arguments: { city: "Tokyo" } }
        ]
      },
      {
        role: "tool",
        toolCallId: "tc1",
        toolName: "weather",
        content: "Sunny 25C"
      },
      { role: "assistant", content: "It is sunny and 25C in Tokyo." }
    ];

    const result = toSDKMessages(messages);
    expect(result).toHaveLength(4);
    expect(result[0].role).toBe("user");
    expect(result[1].role).toBe("assistant");
    expect(result[1].content).toBeInstanceOf(Array);
    expect(result[2].role).toBe("tool");
    expect(result[3]).toEqual({
      role: "assistant",
      content: "It is sunny and 25C in Tokyo."
    });
  });
});

describe("convertResponseMessages", () => {
  it("converts an assistant message with string content", () => {
    const responseMessages = [
      { role: "assistant", content: "plain reply" }
    ];

    expect(convertResponseMessages(responseMessages)).toEqual([
      { role: "assistant", content: "plain reply" }
    ]);
  });

  it("converts an assistant message with text parts array", () => {
    const responseMessages = [
      {
        role: "assistant",
        content: [
          { type: "text", text: "Hello " },
          { type: "text", text: "world" }
        ]
      }
    ];

    expect(convertResponseMessages(responseMessages)).toEqual([
      { role: "assistant", content: "Hello world" }
    ]);
  });

  it("converts an assistant message with tool-call parts", () => {
    const responseMessages = [
      {
        role: "assistant",
        content: [
          { type: "text", text: "Calling tool" },
          {
            type: "tool-call",
            toolCallId: "tc1",
            toolName: "search",
            args: { q: "test" }
          }
        ]
      }
    ];

    const result = convertResponseMessages(responseMessages);

    expect(result).toEqual([
      {
        role: "assistant",
        content: "Calling tool",
        toolCalls: [
          { id: "tc1", name: "search", arguments: { q: "test" } }
        ]
      }
    ]);
  });

  it("converts a tool message with tool-result parts", () => {
    const responseMessages = [
      {
        role: "tool",
        content: [
          {
            type: "tool-result",
            toolCallId: "tc1",
            toolName: "search",
            result: "found it"
          }
        ]
      }
    ];

    expect(convertResponseMessages(responseMessages)).toEqual([
      {
        role: "tool",
        toolCallId: "tc1",
        toolName: "search",
        content: "found it"
      }
    ]);
  });

  it("serializes non-string tool-result to JSON", () => {
    const responseMessages = [
      {
        role: "tool",
        content: [
          {
            type: "tool-result",
            toolCallId: "tc2",
            toolName: "fetch",
            result: { status: 200, body: "ok" }
          }
        ]
      }
    ];

    const result = convertResponseMessages(responseMessages);
    expect(result[0]).toMatchObject({
      role: "tool",
      content: JSON.stringify({ status: 200, body: "ok" })
    });
  });

  it("handles tool-call with missing args gracefully", () => {
    const responseMessages = [
      {
        role: "assistant",
        content: [
          {
            type: "tool-call",
            toolCallId: "tc3",
            toolName: "noop"
            // no args property
          }
        ]
      }
    ];

    const result = convertResponseMessages(responseMessages);
    expect(result).toEqual([
      {
        role: "assistant",
        content: "",
        toolCalls: [{ id: "tc3", name: "noop", arguments: {} }]
      }
    ]);
  });

  it("handles tool-result with no result property", () => {
    const responseMessages = [
      {
        role: "tool",
        content: [
          {
            type: "tool-result",
            toolCallId: "tc4",
            toolName: "empty"
            // no result property
          }
        ]
      }
    ];

    const result = convertResponseMessages(responseMessages);
    expect(result[0]).toMatchObject({
      role: "tool",
      content: ""
    });
  });

  it("returns empty array for empty input", () => {
    expect(convertResponseMessages([])).toEqual([]);
  });
});
