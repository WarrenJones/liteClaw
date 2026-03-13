# Contributing

感谢你关注 LiteClaw。

LiteClaw 的目标不是一次性复刻完整 OpenClaw，而是以清晰、可验证、可演进的方式逐步补齐 OpenClaw 的核心能力。因此我们非常欢迎围绕最小链路、稳定性、可扩展性和 Agent 能力演进的贡献。

## 你可以如何参与

- 提交 bug 反馈
- 提出功能建议
- 改进文档
- 优化代码结构或可维护性
- 补充测试与验证脚本
- 推进与 OpenClaw 能力对齐的里程碑

## 开始之前

请先确认：

- 变更是否符合 LiteClaw 的演进方向
- 是否会引入不必要的复杂度
- 是否会暴露本地模型、密钥或内网配置

对于较大的功能改动，建议先开一个 issue 说明背景、目标和实现思路，再开始编码。

## 本地开发

环境要求：

- Node.js `20+`
- `pnpm`

安装依赖：

```bash
pnpm install
```

创建本地配置：

```bash
cp .env.example .env.local
```

启动开发服务：

```bash
pnpm dev
```

如果你要验证 Redis 持久化，请在 `.env.local` 中增加：

```bash
STORAGE_BACKEND=redis
REDIS_URL=redis://127.0.0.1:6379
```

如果你要排查飞书、Redis 或模型链路，也可以临时提高日志级别：

```bash
LOG_LEVEL=debug
```

类型检查：

```bash
pnpm check
```

构建：

```bash
pnpm build
```

## 提交规范

建议遵循这些原则：

- 保持单个 PR 聚焦一个主题
- 优先提交小而清晰的改动
- 文档更新和代码改动尽量保持同步
- 不要提交 `.env.local`、`.env`、`.npmrc`、`dist`、`node_modules`
- 不要把真实模型地址、密钥、飞书 token 或内网信息写入仓库

## Pull Request 建议

提交 PR 时，建议在描述中说明：

- 变更背景
- 解决的问题
- 主要实现方式
- 是否影响现有行为
- 如何验证

如果改动涉及架构方向，也建议说明它位于哪一个演进阶段：

- Phase 1：最小可运行链路
- Phase 2：Agent 基础能力
- Phase 3：向 OpenClaw 能力对齐

## Issue 建议

提交 issue 时，建议包含：

- 问题现象或需求描述
- 复现步骤
- 预期行为
- 实际行为
- 运行环境

## 安全说明

如果你发现的是安全问题或敏感信息泄露风险，请不要直接把真实凭据提交到 issue 或 PR 中。

## 贡献方向参考

当前比较适合的贡献方向包括：

- 飞书消息处理健壮性
- Redis 持久化完善
- 错误处理与日志
- 命令路由扩展
- 工具调用能力
- 任务执行能力
- 文档与示例完善
