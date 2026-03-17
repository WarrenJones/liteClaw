import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../../config.js", () => ({
  config: {
    agent: {
      httpFetchAllowedDomains: [],
      toolExecutionTimeoutMs: 5000
    }
  }
}));
vi.mock("../logger.js", () => ({
  logDebug: vi.fn(),
  logInfo: vi.fn(),
  logWarn: vi.fn(),
  logError: vi.fn()
}));
vi.mock("../errors.js", async () => await vi.importActual("../errors.js"));

import { config } from "../../config.js";
import { httpFetchTool } from "./http-fetch.js";
import { LiteClawError } from "../errors.js";
import type { ToolExecutionContext } from "../tools.js";

const ctx: ToolExecutionContext = {
  chatId: "c1",
  eventId: "e1",
  trigger: "model" as const,
  userText: "test"
};

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn());
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("httpFetchTool", () => {
  it("returns body text on successful fetch", async () => {
    const mockFetch = vi.mocked(fetch);
    mockFetch.mockResolvedValue(
      new Response("Hello World", { status: 200 })
    );

    const result = await httpFetchTool.run({
      ...ctx,
      arguments: { url: "https://example.com" }
    });

    expect(result.text).toBe("Hello World");
    expect(result.metadata?.status).toBe(200);
  });

  it("returns error message on HTTP error status", async () => {
    const mockFetch = vi.mocked(fetch);
    mockFetch.mockResolvedValue(
      new Response("Not Found", { status: 404, statusText: "Not Found" })
    );

    const result = await httpFetchTool.run({
      ...ctx,
      arguments: { url: "https://example.com/missing" }
    });

    expect(result.text).toContain("HTTP 请求失败");
    expect(result.text).toContain("404");
    expect(result.metadata?.status).toBe(404);
  });

  it("returns error when domain is not in whitelist", async () => {
    config.agent.httpFetchAllowedDomains = ["allowed.com"];

    const result = await httpFetchTool.run({
      ...ctx,
      arguments: { url: "https://blocked.com/page" }
    });

    expect(result.text).toContain("域名不在白名单中");

    // Reset
    config.agent.httpFetchAllowedDomains = [];
  });

  it("allows all domains when whitelist is empty", async () => {
    config.agent.httpFetchAllowedDomains = [];

    const mockFetch = vi.mocked(fetch);
    mockFetch.mockResolvedValue(
      new Response("OK", { status: 200 })
    );

    const result = await httpFetchTool.run({
      ...ctx,
      arguments: { url: "https://any-domain.com" }
    });

    expect(result.text).toBe("OK");
  });

  it("truncates response over 4000 chars", async () => {
    const longBody = "A".repeat(5000);
    const mockFetch = vi.mocked(fetch);
    mockFetch.mockResolvedValue(
      new Response(longBody, { status: 200 })
    );

    const result = await httpFetchTool.run({
      ...ctx,
      arguments: { url: "https://example.com" }
    });

    expect(result.text.length).toBeLessThan(5000);
    expect(result.text).toContain("...(内容已截断)");
    expect(result.metadata?.truncated).toBe(true);
  });

  it("returns error when url parameter is missing", async () => {
    const result = await httpFetchTool.run({
      ...ctx,
      arguments: {}
    });

    expect(result.text).toContain("缺少 url 参数");
  });
});
