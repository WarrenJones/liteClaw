export type ErrorCategory =
  | "validation"
  | "external"
  | "storage"
  | "configuration"
  | "internal";

type LiteClawErrorOptions = {
  code: string;
  category: ErrorCategory;
  retryable?: boolean;
  details?: Record<string, unknown>;
  cause?: unknown;
};

export class LiteClawError extends Error {
  readonly code: string;
  readonly category: ErrorCategory;
  readonly retryable: boolean;
  readonly details?: Record<string, unknown>;
  override readonly cause?: unknown;

  constructor(message: string, options: LiteClawErrorOptions) {
    super(message);
    this.name = "LiteClawError";
    this.code = options.code;
    this.category = options.category;
    this.retryable = options.retryable ?? false;
    this.details = options.details;
    this.cause = options.cause;
  }
}

export function isLiteClawError(error: unknown): error is LiteClawError {
  return error instanceof LiteClawError;
}

export function normalizeError(error: unknown): Record<string, unknown> {
  if (isLiteClawError(error)) {
    return {
      name: error.name,
      message: error.message,
      code: error.code,
      category: error.category,
      retryable: error.retryable,
      details: error.details,
      cause: normalizeCause(error.cause),
      stack: error.stack
    };
  }

  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack
    };
  }

  return {
    name: "UnknownError",
    message: String(error)
  };
}

function normalizeCause(cause: unknown): Record<string, unknown> | undefined {
  if (!cause) {
    return undefined;
  }

  if (cause instanceof Error) {
    return {
      name: cause.name,
      message: cause.message
    };
  }

  return {
    message: String(cause)
  };
}
