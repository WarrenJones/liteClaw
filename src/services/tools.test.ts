import { describe, it, expect, vi } from "vitest";

vi.mock("../config.js", () => ({
  config: {
    agent: {
      maxToolRounds: 5,
      toolExecutionTimeoutMs: 5000,
      httpFetchAllowedDomains: []
    },
    weather: { apiKey: "", baseUrl: "" },
    codeExec: { enabled: false, timeoutMs: 5000 },
    feishuDocSearch: { enabled: false }
  }
}));
vi.mock("./logger.js", () => ({
  logDebug: vi.fn(),
  logInfo: vi.fn(),
  logWarn: vi.fn(),
  logError: vi.fn()
}));
vi.mock("./errors.js", async () => await vi.importActual("./errors.js"));
vi.mock("./resilience.js", () => ({
  withTimeout: vi.fn((fn: () => Promise<unknown>) => fn())
}));
vi.mock("./runtime-status.js", () => ({
  registerRuntimeStatusDependencies: vi.fn()
}));

import {
  executeTool,
  listAvailableTools,
  listAvailableToolNames,
  toAISDKTools
} from "./tools.js";
import { LiteClawError } from "./errors.js";

describe("tool registry", () => {
  it("registers base tools (local_status, current_time, http_fetch)", () => {
    const names = listAvailableToolNames();
    expect(names).toContain("local_status");
    expect(names).toContain("current_time");
    expect(names).toContain("http_fetch");
  });

  it("does not register conditional tools when config is disabled", () => {
    const names = listAvailableToolNames();
    expect(names).not.toContain("weather");
    expect(names).not.toContain("code_exec");
    expect(names).not.toContain("feishu_doc_search");
  });

  it("listAvailableTools returns LiteClawTool objects", () => {
    const tools = listAvailableTools();
    for (const tool of tools) {
      expect(tool).toHaveProperty("name");
      expect(tool).toHaveProperty("description");
      expect(tool).toHaveProperty("parameters");
      expect(tool).toHaveProperty("run");
      expect(typeof tool.run).toBe("function");
    }
  });
});

describe("executeTool", () => {
  it("throws tool_not_found for unknown tool", async () => {
    await expect(
      executeTool("nonexistent", {
        chatId: "c1",
        eventId: "e1",
        trigger: "command",
        userText: "test"
      })
    ).rejects.toThrow(LiteClawError);

    await expect(
      executeTool("nonexistent", {
        chatId: "c1",
        eventId: "e1",
        trigger: "command",
        userText: "test"
      })
    ).rejects.toMatchObject({ code: "tool_not_found" });
  });

  it("executes known tool and returns result", async () => {
    const result = await executeTool("current_time", {
      chatId: "c1",
      eventId: "e1",
      trigger: "command",
      userText: "test"
    });

    expect(result.text).toContain("当前时间");
    expect(result.text).toContain("Asia/Shanghai");
  });
});

describe("toAISDKTools", () => {
  it("returns ToolSet with all registered tools", () => {
    const context = { chatId: "c1", eventId: "e1", userText: "test" };
    const sdkTools = toAISDKTools(context);

    expect(sdkTools).toHaveProperty("local_status");
    expect(sdkTools).toHaveProperty("current_time");
    expect(sdkTools).toHaveProperty("http_fetch");
  });

  it("each SDK tool has description, inputSchema, execute", () => {
    const context = { chatId: "c1", eventId: "e1", userText: "test" };
    const sdkTools = toAISDKTools(context);

    for (const [name, tool] of Object.entries(sdkTools)) {
      const t = tool as Record<string, unknown>;
      expect(t.description).toBeDefined();
      expect(t.inputSchema).toBeDefined();
      expect(typeof t.execute).toBe("function");
    }
  });
});
