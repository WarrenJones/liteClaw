import * as Lark from "@larksuiteoapi/node-sdk";

import { config } from "../config.js";
import {
  normalizeLongConnectionEvent,
  type FeishuLongConnectionEvent,
  type FeishuMessageEventData
} from "../types/feishu.js";

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
    console.log(...args);
  },
  warn: (...args: unknown[]) => {
    updateLongConnectionState("warn", args);
    console.warn(...args);
  },
  error: (...args: unknown[]) => {
    updateLongConnectionState("error", args);
    console.error(...args);
  },
  debug: (...args: unknown[]) => {
    updateLongConnectionState("debug", args);
    console.debug(...args);
  },
  trace: (...args: unknown[]) => {
    updateLongConnectionState("trace", args);
    console.debug(...args);
  }
};

export function verifyWebhookToken(token?: string): boolean {
  return !!token && !!config.feishu.verificationToken && token === config.feishu.verificationToken;
}

export function isWebhookConfigured(): boolean {
  return !!config.feishu.verificationToken;
}

export function extractTextContent(content: string): string {
  const parsed = JSON.parse(content) as { text?: string };
  return parsed.text?.trim() || "";
}

export function getFeishuLongConnectionState(): FeishuLongConnectionState {
  syncReconnectInfo();
  return { ...feishuLongConnectionState };
}

export async function sendTextMessage(
  chatId: string,
  text: string
): Promise<void> {
  await feishuClient.im.message.create(
    {
      params: {
        receive_id_type: "chat_id"
      },
      data: {
        receive_id: chatId,
        msg_type: "text",
        content: JSON.stringify({ text })
      }
    }
  );
}

export async function startFeishuLongConnection(
  onMessage: (event: FeishuMessageEventData) => void
): Promise<void> {
  if (wsClient) {
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
      onMessage(normalizeLongConnectionEvent(data as FeishuLongConnectionEvent));
    }
  });

  wsClient = new Lark.WSClient({
    ...feishuBaseConfig,
    loggerLevel: Lark.LoggerLevel.info,
    logger: feishuSdkLogger
  });

  await wsClient.start({ eventDispatcher });
}
