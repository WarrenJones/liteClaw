import { config as loadEnv } from "dotenv";

loadEnv({ path: ".env.local", override: false });
loadEnv();

type AppConfig = {
  host: string;
  port: number;
  systemPrompt: string;
  sessionMaxTurns: number;
  eventDedupeTtlMs: number;
  feishu: {
    appId: string;
    appSecret: string;
    verificationToken: string;
    encryptKey?: string;
    apiBaseUrl: string;
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
    verificationToken: readRequiredEnv("FEISHU_VERIFICATION_TOKEN"),
    encryptKey: process.env.FEISHU_ENCRYPT_KEY?.trim() || undefined,
    apiBaseUrl: readOptionalEnv("FEISHU_API_BASE_URL", "https://open.feishu.cn")
  },
  model: {
    baseURL: readRequiredEnv("MODEL_BASE_URL"),
    apiKey: readOptionalEnv("MODEL_API_KEY", "EMPTY"),
    id: readRequiredEnv("MODEL_ID")
  }
};
