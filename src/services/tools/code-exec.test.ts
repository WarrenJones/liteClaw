import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../../config.js", () => ({
  config: {
    codeExec: { enabled: true, timeoutMs: 5000 }
  }
}));
vi.mock("../logger.js", () => ({
  logDebug: vi.fn(),
  logInfo: vi.fn(),
  logWarn: vi.fn(),
  logError: vi.fn()
}));
vi.mock("../errors.js", async () => await vi.importActual("../errors.js"));
vi.mock("node:child_process", () => ({
  execFile: vi.fn()
}));

import { config } from "../../config.js";
import { execFile } from "node:child_process";
import { codeExecTool } from "./code-exec.js";
import type { ToolExecutionContext } from "../tools.js";

const mockExecFile = vi.mocked(execFile);

const ctx: ToolExecutionContext = {
  chatId: "c1",
  eventId: "e1",
  trigger: "model" as const,
  userText: "test"
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe("codeExecTool", () => {
  it("returns error message when feature is disabled", async () => {
    const original = config.codeExec.enabled;
    config.codeExec.enabled = false;

    const result = await codeExecTool.run({
      ...ctx,
      arguments: { code: "console.log(1)", language: "js" }
    });

    expect(result.text).toContain("代码执行功能未启用");

    config.codeExec.enabled = original;
  });

  it("returns stdout for JS code execution", async () => {
    mockExecFile.mockImplementation(((
      cmd: string,
      args: string[],
      opts: any,
      cb: Function
    ) => {
      expect(cmd).toBe("node");
      expect(args).toContain("-e");
      cb(null, "42\n", "");
      return { unref: vi.fn() } as any;
    }) as any);

    const result = await codeExecTool.run({
      ...ctx,
      arguments: { code: "console.log(42)", language: "js" }
    });

    expect(result.text).toContain("42");
    expect(result.metadata?.language).toBe("js");
    expect(result.metadata?.exitCode).toBe(0);
  });

  it("returns stdout for shell code execution", async () => {
    mockExecFile.mockImplementation(((
      cmd: string,
      args: string[],
      opts: any,
      cb: Function
    ) => {
      expect(cmd).toBe("sh");
      expect(args).toContain("-c");
      cb(null, "hello\n", "");
      return { unref: vi.fn() } as any;
    }) as any);

    const result = await codeExecTool.run({
      ...ctx,
      arguments: { code: "echo hello", language: "shell" }
    });

    expect(result.text).toContain("hello");
    expect(result.metadata?.language).toBe("shell");
  });

  it("includes stderr in output", async () => {
    mockExecFile.mockImplementation(((
      cmd: string,
      args: string[],
      opts: any,
      cb: Function
    ) => {
      cb(null, "out\n", "warn: something\n");
      return { unref: vi.fn() } as any;
    }) as any);

    const result = await codeExecTool.run({
      ...ctx,
      arguments: { code: "console.log('out'); console.error('warn')", language: "js" }
    });

    expect(result.text).toContain("stdout");
    expect(result.text).toContain("stderr");
    expect(result.text).toContain("warn: something");
    expect(result.metadata?.stderrLength).toBeGreaterThan(0);
  });

  it("returns timeout message on execution timeout", async () => {
    mockExecFile.mockImplementation(((
      cmd: string,
      args: string[],
      opts: any,
      cb: Function
    ) => {
      const err = Object.assign(new Error("timeout"), {
        killed: true,
        code: "ETIMEDOUT"
      });
      cb(err, "", "");
      return { unref: vi.fn() } as any;
    }) as any);

    const result = await codeExecTool.run({
      ...ctx,
      arguments: { code: "while(true){}", language: "js" }
    });

    expect(result.text).toContain("执行超时");
    expect(result.metadata?.timedOut).toBe(true);
    expect(result.metadata?.exitCode).toBeNull();
  });

  it("truncates output exceeding 4000 chars", async () => {
    const longOutput = "X".repeat(5000);
    mockExecFile.mockImplementation(((
      cmd: string,
      args: string[],
      opts: any,
      cb: Function
    ) => {
      cb(null, longOutput, "");
      return { unref: vi.fn() } as any;
    }) as any);

    const result = await codeExecTool.run({
      ...ctx,
      arguments: { code: "console.log('x'.repeat(5000))", language: "js" }
    });

    expect(result.text).toContain("...(输出已截断)");
    expect(result.text.length).toBeLessThan(5000);
  });
});
