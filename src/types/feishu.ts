export type FeishuUrlVerificationPayload = {
  type: "url_verification";
  challenge: string;
  token?: string;
};

export type FeishuEventHeader = {
  app_id?: string;
  create_time?: string;
  event_id: string;
  event_type: string;
  tenant_key?: string;
  token?: string;
};

export type FeishuSenderId = {
  open_id?: string;
  union_id?: string;
  user_id?: string;
};

export type FeishuSender = {
  sender_id?: FeishuSenderId;
  sender_type?: "user" | "app";
  tenant_key?: string;
};

export type FeishuMention = {
  key?: string;
  name?: string;
  id?: FeishuSenderId;
};

export type FeishuMessage = {
  chat_id: string;
  chat_type?: "p2p" | "group";
  content: string;
  mentions?: FeishuMention[];
  message_id: string;
  message_type: string;
};

export type FeishuMessageEvent = {
  message: FeishuMessage;
  sender?: FeishuSender;
};

export type FeishuLongConnectionEvent = {
  event_id?: string;
  event_type?: string;
  sender: FeishuSender;
  message: FeishuMessage;
};

export type FeishuEventPayload = {
  schema?: string;
  header: FeishuEventHeader;
  event: FeishuMessageEvent;
};

export type FeishuWebhookPayload =
  | FeishuUrlVerificationPayload
  | FeishuEventPayload
  | {
      encrypt: string;
    };

export type FeishuMessageEventData = {
  eventId: string;
  eventType: string;
  sender?: FeishuSender;
  message: FeishuMessage;
};

export function isUrlVerificationPayload(
  payload: unknown
): payload is FeishuUrlVerificationPayload {
  if (!payload || typeof payload !== "object") {
    return false;
  }

  const value = payload as Record<string, unknown>;
  return (
    value.type === "url_verification" &&
    typeof value.challenge === "string"
  );
}

export function isEncryptedPayload(
  payload: unknown
): payload is { encrypt: string } {
  if (!payload || typeof payload !== "object") {
    return false;
  }

  return typeof (payload as Record<string, unknown>).encrypt === "string";
}

export function isEventPayload(payload: unknown): payload is FeishuEventPayload {
  if (!payload || typeof payload !== "object") {
    return false;
  }

  const value = payload as Record<string, unknown>;
  const header = value.header as Record<string, unknown> | undefined;
  const event = value.event as Record<string, unknown> | undefined;
  const message = event?.message as Record<string, unknown> | undefined;

  return (
    !!header &&
    typeof header.event_id === "string" &&
    typeof header.event_type === "string" &&
    !!event &&
    !!message &&
    typeof message.chat_id === "string" &&
    typeof message.content === "string" &&
    typeof message.message_id === "string" &&
    typeof message.message_type === "string"
  );
}

export function normalizeWebhookEvent(
  payload: FeishuEventPayload
): FeishuMessageEventData {
  return {
    eventId: payload.header.event_id,
    eventType: payload.header.event_type,
    sender: payload.event.sender,
    message: payload.event.message
  };
}

export function normalizeLongConnectionEvent(
  payload: FeishuLongConnectionEvent
): FeishuMessageEventData {
  return {
    eventId: payload.event_id ?? payload.message.message_id,
    eventType: payload.event_type ?? "im.message.receive_v1",
    sender: payload.sender,
    message: payload.message
  };
}
