import { z } from "zod";

import { config } from "../../config.js";
import { LiteClawError } from "../errors.js";
import { logDebug } from "../logger.js";
import type { LiteClawTool } from "../tools.js";

// --- Tenant Access Token 缓存 ---

let cachedToken: string | null = null;
let tokenExpiresAt = 0;

/**
 * 重置 token 缓存（用于测试）。
 */
export function resetTokenCache(): void {
  cachedToken = null;
  tokenExpiresAt = 0;
}

async function getTenantAccessToken(timeoutMs: number): Promise<string> {
  // 如果缓存的 token 还有 60 秒以上有效期，直接返回
  if (cachedToken && Date.now() < tokenExpiresAt - 60_000) {
    return cachedToken;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(
      "https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          app_id: config.feishu.appId,
          app_secret: config.feishu.appSecret
        }),
        signal: controller.signal
      }
    );

    clearTimeout(timeout);

    if (!response.ok) {
      throw new LiteClawError("Failed to get tenant access token", {
        code: "tool_execution_failed",
        category: "external",
        retryable: true,
        details: { status: response.status }
      });
    }

    const data = (await response.json()) as {
      code: number;
      msg: string;
      tenant_access_token: string;
      expire: number;
    };

    if (data.code !== 0) {
      throw new LiteClawError("Feishu auth failed", {
        code: "tool_execution_failed",
        category: "external",
        retryable: false,
        details: { feishuCode: data.code, msg: data.msg }
      });
    }

    cachedToken = data.tenant_access_token;
    tokenExpiresAt = Date.now() + data.expire * 1000;

    return cachedToken;
  } catch (error) {
    clearTimeout(timeout);
    if (error instanceof LiteClawError) throw error;

    throw new LiteClawError("Failed to get tenant access token", {
      code: "tool_execution_failed",
      category: "external",
      retryable: true,
      cause: error
    });
  }
}

// --- 文档搜索 ---

type DocEntity = {
  docs_token: string;
  docs_type: string;
  title: string;
  owner_id: string;
  create_time: string;
  update_time: string;
  preview?: string;
};

async function searchDocs(
  query: string,
  token: string,
  timeoutMs: number
): Promise<DocEntity[]> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(
      "https://open.feishu.cn/open-apis/suite/docs-api/search/object",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
          search_key: query,
          count: 5,
          offset: 0,
          owner_ids: [],
          docs_types: []
        }),
        signal: controller.signal
      }
    );

    clearTimeout(timeout);

    if (!response.ok) {
      throw new LiteClawError("Feishu doc search request failed", {
        code: "tool_execution_failed",
        category: "external",
        retryable: true,
        details: { status: response.status }
      });
    }

    const data = (await response.json()) as {
      code: number;
      msg: string;
      data?: {
        docs_entities?: DocEntity[];
        has_more?: boolean;
        total?: number;
      };
    };

    if (data.code !== 0) {
      throw new LiteClawError("Feishu doc search failed", {
        code: "tool_execution_failed",
        category: "external",
        retryable: false,
        details: { feishuCode: data.code, msg: data.msg }
      });
    }

    return data.data?.docs_entities ?? [];
  } catch (error) {
    clearTimeout(timeout);
    if (error instanceof LiteClawError) throw error;

    throw new LiteClawError("Feishu doc search failed", {
      code: "tool_execution_failed",
      category: "external",
      retryable: true,
      cause: error
    });
  }
}

function formatDocResults(docs: DocEntity[]): string {
  if (docs.length === 0) {
    return "未找到匹配的飞书文档。";
  }

  const items = docs.map((doc, i) => {
    const typeLabel =
      doc.docs_type === "doc"
        ? "文档"
        : doc.docs_type === "sheet"
          ? "表格"
          : doc.docs_type === "bitable"
            ? "多维表格"
            : doc.docs_type;
    const url = `https://feishu.cn/${doc.docs_type}/${doc.docs_token}`;
    const preview = doc.preview ? `\n   ${doc.preview}` : "";
    return `${i + 1}. 【${typeLabel}】${doc.title}${preview}\n   🔗 ${url}`;
  });

  return [`共找到 ${docs.length} 篇文档：\n`, ...items].join("\n");
}

export const feishuDocSearchTool: LiteClawTool = {
  name: "feishu_doc_search",
  description: "搜索飞书云文档，返回匹配的文档标题、摘要和链接。",
  parameters: z.object({
    query: z.string().describe("搜索关键词")
  }),
  async run(context) {
    if (!config.feishuDocSearch.enabled) {
      return {
        text: "飞书文档搜索未启用。需要设置 FEISHU_DOC_SEARCH_ENABLED=true 环境变量。"
      };
    }

    const query = context.arguments?.query as string;
    if (!query) {
      return { text: "缺少 query 参数。" };
    }

    const timeoutMs = config.agent.toolExecutionTimeoutMs;

    logDebug("tool.feishu_doc_search.searching", {
      query,
      chatId: context.chatId
    });

    try {
      const token = await getTenantAccessToken(timeoutMs);
      const docs = await searchDocs(query, token, timeoutMs);

      return {
        text: formatDocResults(docs),
        metadata: {
          query,
          resultCount: docs.length
        }
      };
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        return {
          text: `飞书文档搜索超时（${timeoutMs}ms）`,
          metadata: { query }
        };
      }

      throw error;
    }
  }
};
