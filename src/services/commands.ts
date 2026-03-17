import { formatAvailableTools } from "./tools.js";

export type CommandRouteResult =
  | {
      handled: false;
    }
  | {
      handled: true;
      kind: "response";
      command: "help" | "reset" | "forget" | "tools" | "unknown";
      responseText: string;
      resetConversation?: boolean;
      clearFacts?: boolean;
    }
  | {
      handled: true;
      kind: "tool";
      command: "status";
      toolName: "local_status";
      inputText?: string;
    };

const HELP_ALIASES = new Set(["/help", "/h", "帮助", "/帮助"]);
const RESET_ALIASES = new Set(["/reset", "重置会话", "/重置会话"]);
const STATUS_ALIASES = new Set(["/status", "/s", "状态", "/状态"]);
const FORGET_ALIASES = new Set(["/forget", "/忘记", "忘记我"]);
const TOOLS_ALIASES = new Set(["/tools", "/tool", "工具", "/工具"]);

const HELP_RESPONSE = [
  "可用命令：",
  "/help 查看帮助",
  "/reset 重置当前会话（保留记忆）",
  "/forget 清除我记住的你的信息",
  "/status 查看当前运行状态",
  "/tools 查看已注册工具",
  "",
  "使用提示：",
  "私聊可以直接提问",
  "群聊请先 @我 再发送消息"
].join("\n");

export function routeCommand(text: string): CommandRouteResult {
  const normalized = text.trim();
  if (!normalized) {
    return { handled: false };
  }

  const commandToken = normalized.split(/\s+/, 1)[0] ?? normalized;
  const inputText = normalized.slice(commandToken.length).trim();

  if (HELP_ALIASES.has(normalized) || HELP_ALIASES.has(commandToken)) {
    return {
      handled: true,
      kind: "response",
      command: "help",
      responseText: HELP_RESPONSE
    };
  }

  if (RESET_ALIASES.has(normalized) || RESET_ALIASES.has(commandToken)) {
    return {
      handled: true,
      kind: "response",
      command: "reset",
      responseText: "会话已经重置。",
      resetConversation: true
    };
  }

  if (FORGET_ALIASES.has(normalized) || FORGET_ALIASES.has(commandToken)) {
    return {
      handled: true,
      kind: "response",
      command: "forget",
      responseText: "已清除记住的信息。",
      clearFacts: true
    };
  }

  if (STATUS_ALIASES.has(normalized) || STATUS_ALIASES.has(commandToken)) {
    return {
      handled: true,
      kind: "tool",
      command: "status",
      toolName: "local_status",
      inputText
    };
  }

  if (TOOLS_ALIASES.has(normalized) || TOOLS_ALIASES.has(commandToken)) {
    return {
      handled: true,
      kind: "response",
      command: "tools",
      responseText: formatAvailableTools()
    };
  }

  if (commandToken.startsWith("/")) {
    return {
      handled: true,
      kind: "response",
      command: "unknown",
      responseText: `暂不支持命令 ${commandToken}，发送 /help 查看可用命令。`
    };
  }

  return { handled: false };
}
