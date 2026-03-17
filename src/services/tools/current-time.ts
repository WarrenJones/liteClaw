import { z } from "zod";

import type { LiteClawTool } from "../tools.js";

export const currentTimeTool: LiteClawTool = {
  name: "current_time",
  description: "获取当前日期和时间。可指定时区，默认为 Asia/Shanghai。",
  parameters: z.object({
    timezone: z
      .string()
      .describe("IANA 时区标识，如 Asia/Shanghai、America/New_York")
      .optional()
  }),
  async run(context) {
    const timezone = (context.arguments?.timezone as string) || "Asia/Shanghai";

    try {
      const now = new Date();
      const formatted = now.toLocaleString("zh-CN", {
        timeZone: timezone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: false
      });

      const iso = now.toLocaleString("en-US", {
        timeZone: timezone,
        timeZoneName: "longOffset"
      });

      return {
        text: `当前时间（${timezone}）：${formatted}`,
        metadata: { timezone, iso: now.toISOString() }
      };
    } catch {
      return {
        text: `无法识别时区 "${timezone}"，请使用 IANA 格式（如 Asia/Shanghai）。`
      };
    }
  }
};
