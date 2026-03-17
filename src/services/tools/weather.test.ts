import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../../config.js", () => ({
  config: {
    weather: { apiKey: "test-key", baseUrl: "https://devapi.qweather.com" },
    agent: { toolExecutionTimeoutMs: 5000 }
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
import { weatherTool } from "./weather.js";
import { LiteClawError } from "../errors.js";
import type { ToolExecutionContext } from "../tools.js";

const ctx: ToolExecutionContext = {
  chatId: "c1",
  eventId: "e1",
  trigger: "model" as const,
  userText: "test"
};

const geoSuccessResponse = {
  code: "200",
  location: [
    { id: "101010100", name: "北京", adm1: "北京", country: "中国" }
  ]
};

const weatherSuccessResponse = {
  code: "200",
  now: {
    temp: "25",
    feelsLike: "27",
    text: "晴",
    humidity: "40",
    windDir: "东南风",
    windScale: "3",
    windSpeed: "15",
    vis: "25"
  }
};

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn());
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("weatherTool", () => {
  it("returns error when city param is missing", async () => {
    const result = await weatherTool.run({ ...ctx, arguments: {} });

    expect(result.text).toContain("缺少 city 参数");
  });

  it("returns config error when API key is empty", async () => {
    const original = config.weather.apiKey;
    config.weather.apiKey = "";

    const result = await weatherTool.run({
      ...ctx,
      arguments: { city: "北京" }
    });

    expect(result.text).toContain("天气服务未配置");

    config.weather.apiKey = original;
  });

  it("returns formatted weather on successful two-step flow", async () => {
    const mockFetch = vi.mocked(fetch);
    mockFetch
      .mockResolvedValueOnce(
        new Response(JSON.stringify(geoSuccessResponse), { status: 200 })
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify(weatherSuccessResponse), { status: 200 })
      );

    const result = await weatherTool.run({
      ...ctx,
      arguments: { city: "北京" }
    });

    expect(result.text).toContain("北京");
    expect(result.text).toContain("25°C");
    expect(result.text).toContain("晴");
    expect(result.text).toContain("东南风");
    expect(result.metadata?.temp).toBe("25");
    expect(result.metadata?.locationId).toBe("101010100");
  });

  it("returns friendly error when GeoAPI finds no results", async () => {
    const mockFetch = vi.mocked(fetch);
    mockFetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ code: "200", location: [] }),
        { status: 200 }
      )
    );

    const result = await weatherTool.run({
      ...ctx,
      arguments: { city: "不存在的城市" }
    });

    expect(result.text).toContain("未找到城市");
    expect(result.text).toContain("不存在的城市");
  });

  it("throws LiteClawError on GeoAPI network error", async () => {
    const mockFetch = vi.mocked(fetch);
    mockFetch.mockResolvedValueOnce(
      new Response("Server Error", { status: 500, statusText: "Internal Server Error" })
    );

    await expect(
      weatherTool.run({ ...ctx, arguments: { city: "北京" } })
    ).rejects.toThrow(LiteClawError);
  });
});
