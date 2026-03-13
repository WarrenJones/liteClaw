# LiteClaw MVP

最小可用版 `liteClaw`，目标是打通：

`飞书消息 -> LiteClaw webhook -> 本地 OpenAI-compatible 模型 -> 飞书回复`

当前实现基于：

- TypeScript
- Node.js
- Hono
- AI SDK
- 飞书应用机器人事件订阅

## 当前能力

- `GET /healthz` 健康检查
- `POST /feishu/webhook` 飞书事件接收
- 支持飞书 `url_verification`
- 支持飞书文本消息解析
- 支持按 `chat_id` 的内存多轮会话
- 支持 `event_id` 去重
- 支持 `/reset` 和 `重置会话`
- 支持通过 OpenAI-compatible 接口调用本地模型

## 当前限制

- 只支持文本消息
- 只支持未加密的飞书事件
- 会话存储在内存中，重启后丢失
- 还没有接 Redis / DB
- 还没有工具调用

## 目录结构

```txt
src/
  config.ts
  index.ts
  routes/feishu.ts
  services/feishu.ts
  services/llm.ts
  services/memory.ts
  types/feishu.ts
docs/
  liteclaw-feishu-mvp.md
```

## 1. 安装依赖

```bash
pnpm install
```

## 2. 配置环境变量

复制 `.env.example` 为 `.env.local`，并填写你自己的本地配置：

```bash
cp .env.example .env.local
```

关键项说明：

- `FEISHU_APP_ID` / `FEISHU_APP_SECRET`：飞书应用配置
- `FEISHU_VERIFICATION_TOKEN`：飞书事件订阅 token
- `MODEL_BASE_URL`：你的本地模型网关地址
- `MODEL_ID`：你本地服务暴露的模型 id

## 3. 启动开发服务

```bash
pnpm dev
```

默认监听：

- `http://0.0.0.0:3000`

## 4. 飞书配置

在飞书开放平台中：

1. 创建企业自建应用
2. 开启机器人能力
3. 配置事件订阅
4. 将回调地址指向：

```txt
https://your-domain.example.com/feishu/webhook
```

如果本地开发，可使用 tunnel 暴露公网地址。

注意：

- 这版 MVP 暂不支持加密事件，请先关闭事件加密或后续补上解密逻辑。
- `.env.local` 和 `.npmrc` 已加入忽略规则，不会默认提交到 Git。

## 5. 本地验证

健康检查：

```bash
curl http://127.0.0.1:3000/healthz
```

飞书 URL 验证：

```bash
curl -X POST http://127.0.0.1:3000/feishu/webhook \
  -H 'content-type: application/json' \
  -d '{"type":"url_verification","challenge":"abc123","token":"YOUR_TOKEN"}'
```

预期返回：

```json
{"challenge":"abc123"}
```

## 6. 开发下一步建议

推荐继续按这个顺序演进：

1. 接入真实飞书应用凭据完成联调
2. 把会话存储切到 Redis
3. 增加群聊 @ 机器人识别
4. 增加更完整的错误码和日志
5. 增加工具调用和命令路由

## 方案文档

详细技术方案见：

- [docs/liteclaw-feishu-mvp.md](/Users/zhongwowen.3/liteClaw/docs/liteclaw-feishu-mvp.md)
