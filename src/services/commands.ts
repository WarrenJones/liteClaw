export type CommandRouteResult =
  | {
      handled: false;
    }
  | {
      handled: true;
      command: "help" | "reset" | "unknown";
      responseText: string;
      resetConversation?: boolean;
    };

const HELP_ALIASES = new Set(["/help", "/h", "帮助", "/帮助"]);
const RESET_ALIASES = new Set(["/reset", "重置会话", "/重置会话"]);

const HELP_RESPONSE = [
  "可用命令：",
  "/help 查看帮助",
  "/reset 重置当前会话",
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

  if (HELP_ALIASES.has(normalized) || HELP_ALIASES.has(commandToken)) {
    return {
      handled: true,
      command: "help",
      responseText: HELP_RESPONSE
    };
  }

  if (RESET_ALIASES.has(normalized) || RESET_ALIASES.has(commandToken)) {
    return {
      handled: true,
      command: "reset",
      responseText: "会话已经重置。",
      resetConversation: true
    };
  }

  if (commandToken.startsWith("/")) {
    return {
      handled: true,
      command: "unknown",
      responseText: `暂不支持命令 ${commandToken}，发送 /help 查看可用命令。`
    };
  }

  return { handled: false };
}
