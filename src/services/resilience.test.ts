import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("./logger.js", () => ({
  logWarn: vi.fn(),
  logInfo: vi.fn(),
  logDebug: vi.fn(),
  logError: vi.fn()
}));

import { withTimeout, withRetry } from "./resilience.js";
import { LiteClawError } from "./errors.js";

describe("withTimeout", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns value when runner resolves before timeout", async () => {
    const runner = () => Promise.resolve("ok");

    const result = await withTimeout(runner, {
      operation: "test_op",
      timeoutMs: 5000,
      category: "internal"
    });

    expect(result).toBe("ok");
  });

  it("throws LiteClawError with code operation_timed_out when runner exceeds timeout", async () => {
    let resolveRunner!: (v: string) => void;
    const runner = () => new Promise<string>((resolve) => { resolveRunner = resolve; });

    const promise = withTimeout(runner, {
      operation: "slow_op",
      timeoutMs: 1000,
      category: "external"
    });

    // Attach a catch handler before advancing timers to prevent unhandled rejection
    const settled = promise.catch((e: unknown) => e);

    await vi.advanceTimersByTimeAsync(1000);

    const error = await settled;

    // Resolve the dangling runner promise to clean up
    resolveRunner("cleanup");

    expect(error).toBeInstanceOf(LiteClawError);
    expect(error).toMatchObject({
      code: "operation_timed_out",
      category: "external",
      retryable: true,
      details: expect.objectContaining({
        operation: "slow_op",
        timeoutMs: 1000
      })
    });
  });

  it("runs runner directly without timeout when timeoutMs <= 0", async () => {
    const runner = () => Promise.resolve(42);

    const result = await withTimeout(runner, {
      operation: "no_timeout",
      timeoutMs: 0,
      category: "internal"
    });

    expect(result).toBe(42);
  });

  it("propagates runner errors even when within timeout", async () => {
    const runner = () => Promise.reject(new Error("boom"));

    await expect(
      withTimeout(runner, {
        operation: "failing_op",
        timeoutMs: 5000,
        category: "storage"
      })
    ).rejects.toThrow("boom");
  });
});

describe("withRetry", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns value on first success without retrying", async () => {
    const runner = vi.fn().mockResolvedValue("first_try");

    const result = await withRetry(runner, {
      operation: "simple",
      maxRetries: 3,
      delayMs: 100
    });

    expect(result).toBe("first_try");
    expect(runner).toHaveBeenCalledTimes(1);
    expect(runner).toHaveBeenCalledWith(0);
  });

  it("retries up to maxRetries on retryable LiteClawError then succeeds", async () => {
    const retryableError = new LiteClawError("transient", {
      code: "transient",
      category: "external",
      retryable: true
    });

    const runner = vi.fn()
      .mockRejectedValueOnce(retryableError)
      .mockRejectedValueOnce(retryableError)
      .mockResolvedValueOnce("recovered");

    const promise = withRetry(runner, {
      operation: "flaky",
      maxRetries: 3,
      delayMs: 100
    });

    // advance past two delay periods
    await vi.advanceTimersByTimeAsync(100);
    await vi.advanceTimersByTimeAsync(100);

    const result = await promise;
    expect(result).toBe("recovered");
    expect(runner).toHaveBeenCalledTimes(3);
    expect(runner).toHaveBeenNthCalledWith(1, 0);
    expect(runner).toHaveBeenNthCalledWith(2, 1);
    expect(runner).toHaveBeenNthCalledWith(3, 2);
  });

  it("throws immediately when shouldRetry returns false", async () => {
    const error = new LiteClawError("fatal", {
      code: "fatal",
      category: "internal",
      retryable: true
    });

    const runner = vi.fn().mockRejectedValue(error);

    await expect(
      withRetry(runner, {
        operation: "no_retry",
        maxRetries: 5,
        delayMs: 100,
        shouldRetry: () => false
      })
    ).rejects.toThrow("fatal");

    expect(runner).toHaveBeenCalledTimes(1);
  });

  it("throws when default shouldRetry sees non-retryable LiteClawError", async () => {
    const error = new LiteClawError("permanent", {
      code: "permanent",
      category: "validation",
      retryable: false
    });

    const runner = vi.fn().mockRejectedValue(error);

    await expect(
      withRetry(runner, {
        operation: "non_retryable",
        maxRetries: 3,
        delayMs: 100
      })
    ).rejects.toThrow("permanent");

    expect(runner).toHaveBeenCalledTimes(1);
  });

  it("throws when default shouldRetry sees a plain Error (non-retryable)", async () => {
    const runner = vi.fn().mockRejectedValue(new Error("plain"));

    await expect(
      withRetry(runner, {
        operation: "plain_error",
        maxRetries: 3,
        delayMs: 100
      })
    ).rejects.toThrow("plain");

    expect(runner).toHaveBeenCalledTimes(1);
  });

  it("exhausts all retries and throws the last error", async () => {
    const retryableError = new LiteClawError("still failing", {
      code: "transient",
      category: "external",
      retryable: true
    });

    const runner = vi.fn().mockRejectedValue(retryableError);

    const promise = withRetry(runner, {
      operation: "always_fails",
      maxRetries: 2,
      delayMs: 50
    });

    // Catch the rejection early so it doesn't become unhandled
    const settled = promise.catch((e: unknown) => e);

    await vi.advanceTimersByTimeAsync(50);
    await vi.advanceTimersByTimeAsync(50);

    const error = await settled;
    expect(error).toBeInstanceOf(LiteClawError);
    expect((error as LiteClawError).message).toBe("still failing");
    // initial attempt + 2 retries = 3 calls
    expect(runner).toHaveBeenCalledTimes(3);
  });
});
