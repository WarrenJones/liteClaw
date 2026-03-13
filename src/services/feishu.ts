import { config } from "../config.js";

type TenantAccessTokenResponse = {
  code: number;
  expire: number;
  msg: string;
  tenant_access_token: string;
};

type CachedToken = {
  expiresAt: number;
  value: string;
};

let cachedToken: CachedToken | undefined;

async function feishuRequest<T>(
  path: string,
  init: RequestInit,
  accessToken?: string
): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set("content-type", "application/json; charset=utf-8");

  if (accessToken) {
    headers.set("authorization", `Bearer ${accessToken}`);
  }

  const response = await fetch(`${config.feishu.apiBaseUrl}${path}`, {
    ...init,
    headers
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Feishu API request failed (${response.status}): ${body}`);
  }

  return (await response.json()) as T;
}

export function verifyWebhookToken(token?: string): boolean {
  return !!token && token === config.feishu.verificationToken;
}

export function extractTextContent(content: string): string {
  const parsed = JSON.parse(content) as { text?: string };
  return parsed.text?.trim() || "";
}

export async function getTenantAccessToken(): Promise<string> {
  const now = Date.now();
  if (cachedToken && cachedToken.expiresAt > now + 60_000) {
    return cachedToken.value;
  }

  const data = await feishuRequest<TenantAccessTokenResponse>(
    "/open-apis/auth/v3/tenant_access_token/internal",
    {
      method: "POST",
      body: JSON.stringify({
        app_id: config.feishu.appId,
        app_secret: config.feishu.appSecret
      })
    }
  );

  if (data.code !== 0 || !data.tenant_access_token) {
    throw new Error(`Failed to get tenant access token: ${data.msg}`);
  }

  cachedToken = {
    value: data.tenant_access_token,
    expiresAt: now + data.expire * 1000
  };

  return cachedToken.value;
}

export async function sendTextMessage(
  chatId: string,
  text: string
): Promise<void> {
  const accessToken = await getTenantAccessToken();

  await feishuRequest(
    "/open-apis/im/v1/messages?receive_id_type=chat_id",
    {
      method: "POST",
      body: JSON.stringify({
        receive_id: chatId,
        msg_type: "text",
        content: JSON.stringify({ text })
      })
    },
    accessToken
  );
}
