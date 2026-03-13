import { config } from "../config.js";
import { normalizeError } from "./errors.js";

type LogLevel = "debug" | "info" | "warn" | "error";

type LogFields = Record<string, unknown>;

const levelWeight: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40
};

function shouldLog(level: LogLevel): boolean {
  return levelWeight[level] >= levelWeight[config.logLevel];
}

function sanitizeFields(fields: LogFields = {}): LogFields {
  const normalized = Object.entries(fields).reduce<LogFields>(
    (result, [key, value]) => {
      if (value === undefined) {
        return result;
      }

      if (value instanceof Error) {
        result[key] = normalizeError(value);
        return result;
      }

      result[key] = value;
      return result;
    },
    {}
  );

  return normalized;
}

function writeLog(level: LogLevel, event: string, fields?: LogFields): void {
  if (!shouldLog(level)) {
    return;
  }

  const payload = {
    timestamp: new Date().toISOString(),
    level,
    service: "liteclaw",
    event,
    ...sanitizeFields(fields)
  };

  const serialized = JSON.stringify(payload);

  if (level === "error") {
    console.error(serialized);
    return;
  }

  if (level === "warn") {
    console.warn(serialized);
    return;
  }

  console.log(serialized);
}

export function logDebug(event: string, fields?: LogFields): void {
  writeLog("debug", event, fields);
}

export function logInfo(event: string, fields?: LogFields): void {
  writeLog("info", event, fields);
}

export function logWarn(event: string, fields?: LogFields): void {
  writeLog("warn", event, fields);
}

export function logError(event: string, fields?: LogFields): void {
  writeLog("error", event, fields);
}
