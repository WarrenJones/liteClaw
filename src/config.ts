import { config as loadEnv } from "dotenv";

loadEnv({ path: ".env.local", override: false });
loadEnv();

type FeishuConnectionMode = "long-connection" | "webhook";
type FeishuDomain = "feishu" | "lark";

type AppConfig = {
  host: string;
  port: number;
  systemPrompt: string;
  sessionMaxTurns: number;
  eventDedupeTtlMs: number;
  feishu: {
    appId: string;
    appSecret: string;
    connectionMode: FeishuConnectionMode;
    domain: FeishuDomain;
    verificationToken?: string;
    encryptKey?: string;
  };
  model: {
    baseURL: string;
    apiKey: string;
    id: string;
  };
};

function readRequiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function readOptionalEnv(name: string, fallback: string): string {
  const value = process.env[name]?.trim();
  return value || fallback;
}

function readNumberEnv(name: string, fallback: number): number {
  const value = process.env[name]?.trim();
  if (!value) {
    return fallback;
  }

  const parsed = Number(value);
  if (Number.isNaN(parsed)) {
    throw new Error(`Environment variable ${name} must be a number`);
  }

  return parsed;
}

function readEnumEnv<T extends string>(
  name: string,
  values: readonly T[],
  fallback: T
): T {
  const value = process.env[name]?.trim();
  if (!value) {
    return fallback;
  }

  if (values.includes(value as T)) {
    return value as T;
  }

  throw new Error(
    `Environment variable ${name} must be one of: ${values.join(", ")}`
  );
}

const feishuConnectionMode = readEnumEnv(
  "FEISHU_CONNECTION_MODE",
  ["long-connection", "webhook"] as const,
  "long-connection"
);

export const config: AppConfig = {
  host: readOptionalEnv("HOST", "0.0.0.0"),
  port: readNumberEnv("PORT", 3000),
  systemPrompt: readOptionalEnv(
    "SYSTEM_PROMPT",
    "你是 liteClaw，一个简洁可靠的中文助手。"
  ),
  sessionMaxTurns: readNumberEnv("SESSION_MAX_TURNS", 10),
  eventDedupeTtlMs: readNumberEnv("EVENT_DEDUPE_TTL_MS", 10 * 60 * 1000),
  feishu: {
    appId: readRequiredEnv("FEISHU_APP_ID"),
    appSecret: readRequiredEnv("FEISHU_APP_SECRET"),
    connectionMode: feishuConnectionMode,
    domain: readEnumEnv("FEISHU_DOMAIN", ["feishu", "lark"] as const, "feishu"),
    verificationToken: process.env.FEISHU_VERIFICATION_TOKEN?.trim() || undefined,
    encryptKey: process.env.FEISHU_ENCRYPT_KEY?.trim() || undefined
  },
  model: {
    baseURL: readRequiredEnv("MODEL_BASE_URL"),
    apiKey: readOptionalEnv("MODEL_API_KEY", "EMPTY"),
    id: readRequiredEnv("MODEL_ID")
  }
};

if (
  config.feishu.connectionMode === "webhook" &&
  !config.feishu.verificationToken
) {
  throw new Error(
    "FEISHU_VERIFICATION_TOKEN is required when FEISHU_CONNECTION_MODE=webhook"
  );
}
