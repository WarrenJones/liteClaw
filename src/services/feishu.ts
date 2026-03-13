import * as Lark from "@larksuiteoapi/node-sdk";

import { config } from "../config.js";
import {
  normalizeLongConnectionEvent,
  type FeishuLongConnectionEvent,
  type FeishuMessageEventData
} from "../types/feishu.js";
import { LiteClawError } from "./errors.js";
import { logDebug, logError, logInfo, logWarn } from "./logger.js";

const feishuBaseConfig = {
  appId: config.feishu.appId,
  appSecret: config.feishu.appSecret,
  domain:
    config.feishu.domain === "lark" ? Lark.Domain.Lark : Lark.Domain.Feishu
};

const feishuClient = new Lark.Client(feishuBaseConfig);
let wsClient: Lark.WSClient | undefined;

type FeishuLongConnectionStatus =
  | "idle"
  | "starting"
  | "connected"
  | "reconnecting"
  | "error";

type FeishuLongConnectionState = {
  enabled: boolean;
  status: FeishuLongConnectionStatus;
  lastMessage?: string;
  lastError?: string;
  lastConnectedAt?: string;
  lastConnectAttemptAt?: string;
  nextConnectAttemptAt?: string;
};

const feishuLongConnectionState: FeishuLongConnectionState = {
  enabled: config.feishu.connectionMode === "long-connection",
  status:
    config.feishu.connectionMode === "long-connection" ? "idle" : "idle"
};

function formatLogMessage(args: unknown[]): string {
  return args
    .map((value) => {
      if (typeof value === "string") {
        return value;
      }

      try {
        return JSON.stringify(value);
      } catch {
        return String(value);
      }
    })
    .join(" ")
    .trim();
}

function syncReconnectInfo(): void {
  if (!wsClient) {
    return;
  }

  const reconnectInfo = wsClient.getReconnectInfo();
  if (reconnectInfo.lastConnectTime > 0) {
    feishuLongConnectionState.lastConnectAttemptAt = new Date(
      reconnectInfo.lastConnectTime
    ).toISOString();
  }

  if (reconnectInfo.nextConnectTime > 0) {
    feishuLongConnectionState.nextConnectAttemptAt = new Date(
      reconnectInfo.nextConnectTime
    ).toISOString();
  } else {
    feishuLongConnectionState.nextConnectAttemptAt = undefined;
  }
}

function updateLongConnectionState(
  level: "info" | "warn" | "error" | "debug" | "trace",
  args: unknown[]
): void {
  const message = formatLogMessage(args);
  if (!message) {
    return;
  }

  feishuLongConnectionState.lastMessage = message;
  syncReconnectInfo();

  if (message.includes("ws client ready")) {
    feishuLongConnectionState.status = "connected";
    feishuLongConnectionState.lastConnectedAt = new Date().toISOString();
    feishuLongConnectionState.lastError = undefined;
    return;
  }

  if (
    message.includes("reconnect") ||
    message.includes("repeat connection")
  ) {
    feishuLongConnectionState.status = "reconnecting";
    return;
  }

  if (
    message.includes("connect failed") ||
    message.includes("ws connect failed") ||
    message.includes("unable to connect to the server") ||
    message.includes("ws error")
  ) {
    feishuLongConnectionState.status = "error";
    feishuLongConnectionState.lastError = message;
    return;
  }

  if (level === "error") {
    feishuLongConnectionState.status = "error";
    feishuLongConnectionState.lastError = message;
  }
}

const feishuSdkLogger = {
  info: (...args: unknown[]) => {
    updateLongConnectionState("info", args);
    logInfo("feishu.sdk", { sdkLevel: "info", message: formatLogMessage(args) });
  },
  warn: (...args: unknown[]) => {
    updateLongConnectionState("warn", args);
    logWarn("feishu.sdk", { sdkLevel: "warn", message: formatLogMessage(args) });
  },
  error: (...args: unknown[]) => {
    updateLongConnectionState("error", args);
    logError("feishu.sdk", { sdkLevel: "error", message: formatLogMessage(args) });
  },
  debug: (...args: unknown[]) => {
    updateLongConnectionState("debug", args);
    logDebug("feishu.sdk", { sdkLevel: "debug", message: formatLogMessage(args) });
  },
  trace: (...args: unknown[]) => {
    updateLongConnectionState("trace", args);
    logDebug("feishu.sdk", { sdkLevel: "trace", message: formatLogMessage(args) });
  }
};

export function verifyWebhookToken(token?: string): boolean {
  return !!token && !!config.feishu.verificationToken && token === config.feishu.verificationToken;
}

export function isWebhookConfigured(): boolean {
  return !!config.feishu.verificationToken;
}

export function extractTextContent(content: string): string {
  try {
    const parsed = JSON.parse(content) as { text?: string };
    return parsed.text?.trim() || "";
  } catch (error) {
    throw new LiteClawError("Failed to parse Feishu text content", {
      code: "feishu_message_content_parse_failed",
      category: "validation",
      details: {
        contentPreview: content.slice(0, 200)
      },
      cause: error
    });
  }
}

export function getFeishuLongConnectionState(): FeishuLongConnectionState {
  syncReconnectInfo();
  return { ...feishuLongConnectionState };
}

export async function sendTextMessage(
  chatId: string,
  text: string
): Promise<void> {
  try {
    await feishuClient.im.message.create({
      params: {
        receive_id_type: "chat_id"
      },
      data: {
        receive_id: chatId,
        msg_type: "text",
        content: JSON.stringify({ text })
      }
    });
  } catch (error) {
    throw new LiteClawError("Failed to send Feishu text message", {
      code: "feishu_message_send_failed",
      category: "external",
      retryable: true,
      details: {
        chatId,
        textLength: text.length
      },
      cause: error
    });
  }
}

export async function startFeishuLongConnection(
  onMessage: (event: FeishuMessageEventData) => void
): Promise<void> {
  if (wsClient) {
    logDebug("feishu.long_connection.already_started");
    return;
  }

  feishuLongConnectionState.status = "starting";
  feishuLongConnectionState.lastMessage =
    "Initializing Feishu long connection client.";
  feishuLongConnectionState.lastError = undefined;
  feishuLongConnectionState.lastConnectAttemptAt = new Date().toISOString();
  feishuLongConnectionState.nextConnectAttemptAt = undefined;

  const eventDispatcher = new Lark.EventDispatcher({}).register({
    "im.message.receive_v1": async (data) => {
      const event = normalizeLongConnectionEvent(data as FeishuLongConnectionEvent);
      logDebug("feishu.long_connection.event_received", {
        eventId: event.eventId,
        eventType: event.eventType,
        chatId: event.message.chat_id
      });
      onMessage(event);
    }
  });

  wsClient = new Lark.WSClient({
    ...feishuBaseConfig,
    loggerLevel: Lark.LoggerLevel.info,
    logger: feishuSdkLogger
  });

  try {
    await wsClient.start({ eventDispatcher });
  } catch (error) {
    logError("feishu.long_connection.start_failed", {
      error,
      connectionMode: config.feishu.connectionMode
    });
    throw new LiteClawError("Failed to start Feishu long connection", {
      code: "feishu_long_connection_start_failed",
      category: "external",
      retryable: true,
      cause: error
    });
  }

  logInfo("feishu.long_connection.started", {
    domain: config.feishu.domain
  });
}
