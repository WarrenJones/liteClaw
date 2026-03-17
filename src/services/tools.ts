import { type ToolSet } from "ai";
import type { z } from "zod";

import { config } from "../config.js";
import { LiteClawError } from "./errors.js";
import { logError, logInfo } from "./logger.js";
import { withTimeout } from "./resilience.js";
import { registerRuntimeStatusDependencies } from "./runtime-status.js";
import { currentTimeTool } from "./tools/current-time.js";
import { httpFetchTool } from "./tools/http-fetch.js";
import { localStatusTool } from "./tools/local-status.js";

export type ToolExecutionContext = {
  chatId: string;
  eventId: string;
  trigger: "command" | "model";
  inputText?: string;
  userText: string;
  arguments?: Record<string, unknown>;
};

export type ToolExecutionResult = {
  text: string;
  metadata?: Record<string, unknown>;
};

export type LiteClawTool = {
  name: string;
  description: string;
  parameters: z.ZodTypeAny;
  run(context: ToolExecutionContext): Promise<ToolExecutionResult>;
};

const toolRegistry = new Map<string, LiteClawTool>(
  [localStatusTool, currentTimeTool, httpFetchTool].map((tool) => [
    tool.name,
    tool
  ])
);

registerRuntimeStatusDependencies({
  listAvailableToolNames: listAvailableToolNames
});

export function listAvailableTools(): LiteClawTool[] {
  return [...toolRegistry.values()];
}

export function listAvailableToolNames(): string[] {
  return listAvailableTools().map((tool) => tool.name);
}

export function formatAvailableTools(): string {
  const tools = listAvailableTools();

  return [
    "当前已注册工具：",
    ...tools.map((tool) => `- ${tool.name}: ${tool.description}`)
  ].join("\n");
}

/**
 * 将 LiteClaw tool registry 转换为 Vercel AI SDK 的 tools 格式。
 * 桥接层：registry 中每个工具的 `run()` 映射为 SDK 的 `execute`。
 */
export function toAISDKTools(context: {
  chatId: string;
  eventId: string;
  userText: string;
}): ToolSet {
  const sdkTools: ToolSet = {};

  for (const liteClawTool of toolRegistry.values()) {
    const captured = liteClawTool;

    // 直接构造 AI SDK Tool 对象，使用 inputSchema 而非已废弃的 parameters
    sdkTools[captured.name] = {
      description: captured.description,
      inputSchema: captured.parameters,
      execute: async (args: Record<string, unknown>) => {
        const result = await executeTool(captured.name, {
          ...context,
          trigger: "model",
          arguments: args
        });
        return result.text;
      }
    } as ToolSet[string];
  }

  return sdkTools;
}

export async function executeTool(
  name: string,
  context: ToolExecutionContext
): Promise<ToolExecutionResult> {
  const tool = toolRegistry.get(name);

  if (!tool) {
    throw new LiteClawError(`Tool not found: ${name}`, {
      code: "tool_not_found",
      category: "validation",
      details: {
        toolName: name
      }
    });
  }

  logInfo("tool.execution.started", {
    chatId: context.chatId,
    eventId: context.eventId,
    toolName: name,
    trigger: context.trigger
  });

  try {
    const result = await withTimeout(() => tool.run(context), {
      operation: `tool_${name}`,
      timeoutMs: config.agent.toolExecutionTimeoutMs,
      category: "internal",
      details: {
        toolName: name,
        trigger: context.trigger
      }
    });

    logInfo("tool.execution.completed", {
      chatId: context.chatId,
      eventId: context.eventId,
      toolName: name,
      outputLength: result.text.length,
      trigger: context.trigger
    });

    return result;
  } catch (error) {
    logError("tool.execution.failed", {
      chatId: context.chatId,
      eventId: context.eventId,
      toolName: name,
      trigger: context.trigger,
      error
    });

    throw new LiteClawError("Tool execution failed", {
      code: "tool_execution_failed",
      category: "internal",
      retryable: false,
      details: {
        toolName: name
      },
      cause: error
    });
  }
}
