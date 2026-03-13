import { LiteClawError, isLiteClawError } from "./errors.js";
import { logWarn } from "./logger.js";

type TimeoutCategory = "external" | "storage" | "internal";

type RetryOptions = {
  operation: string;
  maxRetries: number;
  delayMs: number;
  shouldRetry?: (error: unknown) => boolean;
  details?: Record<string, unknown>;
};

type TimeoutOptions = {
  operation: string;
  timeoutMs: number;
  category: TimeoutCategory;
  details?: Record<string, unknown>;
};

export async function withTimeout<T>(
  runner: () => Promise<T>,
  options: TimeoutOptions
): Promise<T> {
  if (options.timeoutMs <= 0) {
    return runner();
  }

  let timeoutId: NodeJS.Timeout | undefined;

  try {
    return await Promise.race([
      runner(),
      new Promise<T>((_, reject) => {
        timeoutId = setTimeout(() => {
          reject(
            new LiteClawError(`Operation timed out: ${options.operation}`, {
              code: "operation_timed_out",
              category: options.category,
              retryable: true,
              details: {
                operation: options.operation,
                timeoutMs: options.timeoutMs,
                ...options.details
              }
            })
          );
        }, options.timeoutMs);
      })
    ]);
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
}

export async function withRetry<T>(
  runner: (attempt: number) => Promise<T>,
  options: RetryOptions
): Promise<T> {
  const shouldRetry = options.shouldRetry ?? defaultShouldRetry;

  for (let attempt = 0; attempt <= options.maxRetries; attempt += 1) {
    try {
      return await runner(attempt);
    } catch (error) {
      const canRetry = attempt < options.maxRetries && shouldRetry(error);
      if (!canRetry) {
        throw error;
      }

      logWarn("resilience.retry_scheduled", {
        operation: options.operation,
        attempt: attempt + 1,
        maxRetries: options.maxRetries,
        delayMs: options.delayMs,
        error
      });

      await delay(options.delayMs);
    }
  }

  throw new LiteClawError("Retry loop exited unexpectedly", {
    code: "retry_loop_unreachable",
    category: "internal",
    details: {
      operation: options.operation,
      ...options.details
    }
  });
}

function defaultShouldRetry(error: unknown): boolean {
  if (isLiteClawError(error)) {
    return error.retryable;
  }

  return false;
}

function delay(ms: number): Promise<void> {
  if (ms <= 0) {
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
