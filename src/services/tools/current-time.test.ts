import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../config.js", () => ({ config: {} }));
vi.mock("../logger.js", () => ({
  logDebug: vi.fn(),
  logInfo: vi.fn(),
  logWarn: vi.fn(),
  logError: vi.fn()
}));
vi.mock("../errors.js", async () => await vi.importActual("../errors.js"));

import { currentTimeTool } from "./current-time.js";
import type { ToolExecutionContext } from "../tools.js";

const ctx: ToolExecutionContext = {
  chatId: "c1",
  eventId: "e1",
  trigger: "model" as const,
  userText: "test"
};

describe("currentTimeTool", () => {
  it("returns formatted time string with default timezone (Asia/Shanghai)", async () => {
    const result = await currentTimeTool.run(ctx);

    expect(result.text).toContain("Asia/Shanghai");
    expect(result.text).toMatch(/当前时间/);
  });

  it("uses custom timezone from arguments", async () => {
    const result = await currentTimeTool.run({
      ...ctx,
      arguments: { timezone: "America/New_York" }
    });

    expect(result.text).toContain("America/New_York");
    expect(result.text).toMatch(/当前时间/);
  });

  it("returns error message for invalid timezone", async () => {
    const result = await currentTimeTool.run({
      ...ctx,
      arguments: { timezone: "Invalid/Zone" }
    });

    expect(result.text).toContain("无法识别时区");
    expect(result.text).toContain("Invalid/Zone");
  });

  it("includes timezone and ISO string in metadata", async () => {
    const result = await currentTimeTool.run(ctx);

    expect(result.metadata).toBeDefined();
    expect(result.metadata!.timezone).toBe("Asia/Shanghai");
    expect(typeof result.metadata!.iso).toBe("string");
    // ISO string should be a valid date
    expect(new Date(result.metadata!.iso as string).getTime()).not.toBeNaN();
  });
});
