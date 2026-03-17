import { z } from "zod";

import { config } from "../../config.js";
import { LiteClawError } from "../errors.js";
import { logDebug } from "../logger.js";
import type { LiteClawTool } from "../tools.js";

const MAX_RESPONSE_LENGTH = 4_000;

function isDomainAllowed(url: string): boolean {
  const allowed = config.agent.httpFetchAllowedDomains;

  // 如果白名单为空，允许所有域名（开发环境友好）
  if (allowed.length === 0) {
    return true;
  }

  try {
    const hostname = new URL(url).hostname;
    return allowed.some(
      (domain) => hostname === domain || hostname.endsWith(`.${domain}`)
    );
  } catch {
    return false;
  }
}

export const httpFetchTool: LiteClawTool = {
  name: "http_fetch",
  description:
    "发起受控的 HTTP GET 请求，获取指定 URL 的文本内容。支持域名白名单限制。",
  parameters: z.object({
    url: z.string().url().describe("要请求的完整 URL")
  }),
  async run(context) {
    const url = context.arguments?.url as string;

    if (!url) {
      return { text: "缺少 url 参数。" };
    }

    if (!isDomainAllowed(url)) {
      return {
        text: `域名不在白名单中，无法访问该 URL。当前允许的域名：${
          config.agent.httpFetchAllowedDomains.join(", ") || "（未配置白名单，默认允许所有）"
        }`
      };
    }

    logDebug("tool.http_fetch.requesting", {
      url,
      chatId: context.chatId
    });

    try {
      const controller = new AbortController();
      const timeout = setTimeout(
        () => controller.abort(),
        config.agent.toolExecutionTimeoutMs
      );

      const response = await fetch(url, {
        method: "GET",
        headers: {
          "User-Agent": "LiteClaw/0.1.0",
          Accept: "text/plain, application/json, text/html"
        },
        signal: controller.signal
      });

      clearTimeout(timeout);

      if (!response.ok) {
        return {
          text: `HTTP 请求失败：${response.status} ${response.statusText}`,
          metadata: { url, status: response.status }
        };
      }

      let body = await response.text();
      const truncated = body.length > MAX_RESPONSE_LENGTH;

      if (truncated) {
        body = body.slice(0, MAX_RESPONSE_LENGTH) + "\n...(内容已截断)";
      }

      return {
        text: body,
        metadata: {
          url,
          status: response.status,
          contentLength: body.length,
          truncated
        }
      };
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        return {
          text: `HTTP 请求超时（${config.agent.toolExecutionTimeoutMs}ms）`,
          metadata: { url }
        };
      }

      throw new LiteClawError("HTTP fetch failed", {
        code: "tool_execution_failed",
        category: "external",
        retryable: true,
        details: { url },
        cause: error
      });
    }
  }
};
