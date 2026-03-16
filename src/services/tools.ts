import { LiteClawError } from "./errors.js";
import { logError, logInfo } from "./logger.js";
import { registerRuntimeStatusDependencies } from "./runtime-status.js";
import { localStatusTool } from "./tools/local-status.js";

export type ToolExecutionContext = {
  chatId: string;
  eventId: string;
  trigger: "command";
  inputText?: string;
  userText: string;
};

export type ToolExecutionResult = {
  text: string;
  metadata?: Record<string, unknown>;
};

export type LiteClawTool = {
  name: string;
  description: string;
  run(context: ToolExecutionContext): Promise<ToolExecutionResult>;
};

const toolRegistry = new Map<string, LiteClawTool>(
  [localStatusTool].map((tool) => [tool.name, tool])
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
    const result = await tool.run(context);

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
