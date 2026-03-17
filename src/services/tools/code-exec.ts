import { execFile } from "node:child_process";
import { z } from "zod";

import { config } from "../../config.js";
import { logDebug } from "../logger.js";
import type { LiteClawTool } from "../tools.js";

const MAX_OUTPUT_LENGTH = 4_000;
const MAX_BUFFER = 1_024 * 1_024; // 1MB

type ExecResult = {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  timedOut: boolean;
};

function execCommand(
  command: string,
  args: string[],
  timeoutMs: number
): Promise<ExecResult> {
  return new Promise((resolve) => {
    const child = execFile(
      command,
      args,
      {
        timeout: timeoutMs,
        maxBuffer: MAX_BUFFER,
        encoding: "utf-8"
      },
      (error, stdout, stderr) => {
        const timedOut = !!(
          error &&
          "killed" in error &&
          error.killed &&
          "code" in error &&
          error.code === "ETIMEDOUT"
        );

        resolve({
          stdout: stdout || "",
          stderr: stderr || "",
          exitCode: timedOut ? null : (error ? 1 : 0),
          timedOut
        });
      }
    );

    // 确保子进程不阻止父进程退出
    child.unref?.();
  });
}

function truncateOutput(output: string): string {
  if (output.length <= MAX_OUTPUT_LENGTH) {
    return output;
  }
  return output.slice(0, MAX_OUTPUT_LENGTH) + "\n...(输出已截断)";
}

function formatResult(result: ExecResult): string {
  const parts: string[] = [];

  if (result.timedOut) {
    parts.push(`⏱️ 执行超时（${config.codeExec.timeoutMs}ms）`);
  }

  if (result.stdout) {
    parts.push(`📤 stdout:\n${truncateOutput(result.stdout)}`);
  }

  if (result.stderr) {
    parts.push(`⚠️ stderr:\n${truncateOutput(result.stderr)}`);
  }

  if (!result.stdout && !result.stderr && !result.timedOut) {
    parts.push("（无输出）");
  }

  if (result.exitCode !== null && result.exitCode !== 0) {
    parts.push(`退出码：${result.exitCode}`);
  }

  return parts.join("\n\n");
}

export const codeExecTool: LiteClawTool = {
  name: "code_exec",
  description:
    "在受控沙箱环境中执行代码片段。支持 JavaScript（Node.js）和 Shell 脚本。",
  parameters: z.object({
    code: z.string().describe("要执行的代码"),
    language: z
      .enum(["js", "shell"])
      .default("js")
      .describe("代码语言：js (Node.js) 或 shell")
  }),
  async run(context) {
    if (!config.codeExec.enabled) {
      return {
        text: "代码执行功能未启用。需要设置 CODE_EXEC_ENABLED=true 环境变量。"
      };
    }

    const code = context.arguments?.code as string;
    const language = (context.arguments?.language as string) || "js";

    if (!code) {
      return { text: "缺少 code 参数。" };
    }

    logDebug("tool.code_exec.executing", {
      language,
      codeLength: code.length,
      chatId: context.chatId
    });

    const [command, args] =
      language === "shell"
        ? ["sh", ["-c", code]]
        : ["node", ["-e", code]];

    const result = await execCommand(
      command,
      args,
      config.codeExec.timeoutMs
    );

    return {
      text: formatResult(result),
      metadata: {
        language,
        exitCode: result.exitCode,
        timedOut: result.timedOut,
        stdoutLength: result.stdout.length,
        stderrLength: result.stderr.length
      }
    };
  }
};
