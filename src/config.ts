import { config as loadEnv } from "dotenv";

loadEnv({ path: ".env.local", override: false });
loadEnv();

type FeishuConnectionMode = "long-connection" | "webhook";
type FeishuDomain = "feishu" | "lark";
type LogLevel = "debug" | "info" | "warn" | "error";
type StorageBackend = "memory" | "redis";

type AppConfig = {
  host: string;
  port: number;
  logLevel: LogLevel;
  systemPrompt: string;
  sessionMaxTurns: number;
  sessionTtlSeconds: number;
  eventDedupeTtlMs: number;
  storage: {
    backend: StorageBackend;
    redisUrl?: string;
    redisKeyPrefix: string;
  };
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
    timeoutMs: number;
    maxRetries: number;
    retryDelayMs: number;
  };
  timeouts: {
    feishuRequestMs: number;
    storageOperationMs: number;
  };
  rateLimit: {
    maxMessages: number;
    windowMs: number;
  };
  agent: {
    maxToolRounds: number;
    toolExecutionTimeoutMs: number;
    httpFetchAllowedDomains: string[];
  };
  weather: {
    apiKey: string;
    baseUrl: string;
  };
  codeExec: {
    enabled: boolean;
    timeoutMs: number;
  };
  feishuDocSearch: {
    enabled: boolean;
  };
  memory: {
    summarizeThreshold: number;
    recentWindow: number;
    maxFacts: number;
    factsExtractionEnabled: boolean;
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

const storageBackend = readEnumEnv(
  "STORAGE_BACKEND",
  ["memory", "redis"] as const,
  "memory"
);

export const config: AppConfig = {
  host: readOptionalEnv("HOST", "0.0.0.0"),
  port: readNumberEnv("PORT", 3000),
  logLevel: readEnumEnv(
    "LOG_LEVEL",
    ["debug", "info", "warn", "error"] as const,
    "info"
  ),
  systemPrompt: readOptionalEnv(
    "SYSTEM_PROMPT",
    "你是 liteClaw，一个简洁可靠的中文助手。"
  ),
  sessionMaxTurns: readNumberEnv("SESSION_MAX_TURNS", 10),
  sessionTtlSeconds: readNumberEnv("SESSION_TTL_SECONDS", 7 * 24 * 60 * 60),
  eventDedupeTtlMs: readNumberEnv("EVENT_DEDUPE_TTL_MS", 10 * 60 * 1000),
  storage: {
    backend: storageBackend,
    redisUrl: process.env.REDIS_URL?.trim() || undefined,
    redisKeyPrefix: readOptionalEnv("REDIS_KEY_PREFIX", "liteclaw")
  },
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
    id: readRequiredEnv("MODEL_ID"),
    timeoutMs: readNumberEnv("LLM_TIMEOUT_MS", 30_000),
    maxRetries: readNumberEnv("LLM_MAX_RETRIES", 1),
    retryDelayMs: readNumberEnv("LLM_RETRY_DELAY_MS", 500)
  },
  timeouts: {
    feishuRequestMs: readNumberEnv("FEISHU_REQUEST_TIMEOUT_MS", 10_000),
    storageOperationMs: readNumberEnv("STORAGE_OPERATION_TIMEOUT_MS", 5_000)
  },
  rateLimit: {
    maxMessages: readNumberEnv("RATE_LIMIT_MAX_MESSAGES", 5),
    windowMs: readNumberEnv("RATE_LIMIT_WINDOW_MS", 10_000)
  },
  agent: {
    maxToolRounds: readNumberEnv("MAX_TOOL_ROUNDS", 5),
    toolExecutionTimeoutMs: readNumberEnv("TOOL_EXECUTION_TIMEOUT_MS", 10_000),
    httpFetchAllowedDomains: readOptionalEnv("HTTP_FETCH_ALLOWED_DOMAINS", "")
      .split(",")
      .map((d) => d.trim())
      .filter(Boolean)
  },
  weather: {
    apiKey: readOptionalEnv("QWEATHER_API_KEY", ""),
    baseUrl: readOptionalEnv(
      "QWEATHER_BASE_URL",
      "https://devapi.qweather.com"
    )
  },
  codeExec: {
    enabled: readOptionalEnv("CODE_EXEC_ENABLED", "false") === "true",
    timeoutMs: readNumberEnv("CODE_EXEC_TIMEOUT_MS", 5_000)
  },
  feishuDocSearch: {
    enabled:
      readOptionalEnv("FEISHU_DOC_SEARCH_ENABLED", "false") === "true"
  },
  memory: {
    summarizeThreshold: readNumberEnv("MEMORY_SUMMARIZE_THRESHOLD", 24),
    recentWindow: readNumberEnv("MEMORY_RECENT_WINDOW", 16),
    maxFacts: readNumberEnv("MEMORY_MAX_FACTS", 10),
    factsExtractionEnabled:
      readOptionalEnv("MEMORY_FACTS_ENABLED", "false") === "true"
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

if (config.storage.backend === "redis" && !config.storage.redisUrl) {
  throw new Error("REDIS_URL is required when STORAGE_BACKEND=redis");
}
