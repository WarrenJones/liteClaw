import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../../config.js", () => ({
  config: {
    feishu: { appId: "test-app-id", appSecret: "test-secret" },
    feishuDocSearch: { enabled: true },
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

import { feishuDocSearchTool, resetTokenCache } from "./feishu-doc-search.js";
import { config } from "../../config.js";
import type { ToolExecutionContext } from "../tools.js";

const ctx: ToolExecutionContext = {
  chatId: "c1",
  eventId: "e1",
  trigger: "model" as const,
  userText: "test"
};

function mockFetchSequence(...responses: Array<{ ok: boolean; json: unknown }>) {
  const fn = vi.fn();
  for (const resp of responses) {
    fn.mockResolvedValueOnce({
      ok: resp.ok,
      status: resp.ok ? 200 : 500,
      json: async () => resp.json
    });
  }
  vi.stubGlobal("fetch", fn);
  return fn;
}

describe("feishuDocSearchTool", () => {
  beforeEach(() => {
    resetTokenCache();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns error when feature is disabled", async () => {
    const original = config.feishuDocSearch.enabled;
    (config.feishuDocSearch as { enabled: boolean }).enabled = false;

    const result = await feishuDocSearchTool.run({
      ...ctx,
      arguments: { query: "test" }
    });

    expect(result.text).toContain("飞书文档搜索未启用");
    (config.feishuDocSearch as { enabled: boolean }).enabled = original;
  });

  it("returns error when query is missing", async () => {
    const result = await feishuDocSearchTool.run(ctx);
    expect(result.text).toContain("缺少 query 参数");
  });

  it("searches docs successfully", async () => {
    const fetchMock = mockFetchSequence(
      // token response
      {
        ok: true,
        json: {
          code: 0,
          msg: "ok",
          tenant_access_token: "test-token",
          expire: 7200
        }
      },
      // search response
      {
        ok: true,
        json: {
          code: 0,
          msg: "ok",
          data: {
            docs_entities: [
              {
                docs_token: "abc123",
                docs_type: "doc",
                title: "测试文档",
                owner_id: "u1",
                create_time: "1700000000",
                update_time: "1700001000",
                preview: "这是一段摘要"
              }
            ],
            has_more: false,
            total: 1
          }
        }
      }
    );

    const result = await feishuDocSearchTool.run({
      ...ctx,
      arguments: { query: "测试" }
    });

    expect(result.text).toContain("测试文档");
    expect(result.text).toContain("共找到 1 篇文档");
    expect(result.metadata?.resultCount).toBe(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("returns friendly message when no results found", async () => {
    mockFetchSequence(
      {
        ok: true,
        json: {
          code: 0,
          msg: "ok",
          tenant_access_token: "test-token",
          expire: 7200
        }
      },
      {
        ok: true,
        json: {
          code: 0,
          msg: "ok",
          data: { docs_entities: [], has_more: false, total: 0 }
        }
      }
    );

    const result = await feishuDocSearchTool.run({
      ...ctx,
      arguments: { query: "不存在的文档" }
    });

    expect(result.text).toContain("未找到匹配");
  });

  it("caches tenant access token", async () => {
    const fetchMock = mockFetchSequence(
      // first call: token
      {
        ok: true,
        json: {
          code: 0,
          msg: "ok",
          tenant_access_token: "cached-token",
          expire: 7200
        }
      },
      // first call: search
      {
        ok: true,
        json: { code: 0, msg: "ok", data: { docs_entities: [] } }
      },
      // second call: search (no token request needed)
      {
        ok: true,
        json: { code: 0, msg: "ok", data: { docs_entities: [] } }
      }
    );

    await feishuDocSearchTool.run({ ...ctx, arguments: { query: "a" } });
    await feishuDocSearchTool.run({ ...ctx, arguments: { query: "b" } });

    // Token was only fetched once (first call), second call reuses cached token
    expect(fetchMock).toHaveBeenCalledTimes(3); // 1 token + 2 searches
  });
});
