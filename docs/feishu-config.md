# 飞书长连接配置指南

这份文档用于说明如何把本项目接到真实飞书应用上，并在本地通过 `.env.local` 填入真实配置完成联调。

当前项目默认采用：

- 飞书长连接模式
- 本地直接连飞书
- 不需要公网 webhook 地址

适用范围：

- 当前仓库的 LiteClaw MVP
- 当前代码实现的飞书长连接模式接入
- 当前代码实现的未加密飞书事件

不适用范围：

- 已开启事件加密的场景
- 多租户或多应用并发接入

## 1. 先理解当前代码需要什么

当前项目会从 `.env.local` 读取以下配置：

```bash
PORT=3000
HOST=0.0.0.0

FEISHU_CONNECTION_MODE=long-connection
FEISHU_DOMAIN=feishu
FEISHU_APP_ID=
FEISHU_APP_SECRET=
FEISHU_VERIFICATION_TOKEN=
FEISHU_ENCRYPT_KEY=

MODEL_BASE_URL=
MODEL_API_KEY=
MODEL_ID=

SYSTEM_PROMPT=你是 LiteClaw，一个简洁可靠的助手。
SESSION_MAX_TURNS=10
EVENT_DEDUPE_TTL_MS=600000
```

对应关系如下：

- `FEISHU_CONNECTION_MODE`：飞书接入模式，默认使用 `long-connection`
- `FEISHU_DOMAIN`：飞书环境，国内版通常使用 `feishu`
- `FEISHU_APP_ID`：飞书应用的 `App ID`
- `FEISHU_APP_SECRET`：飞书应用的 `App Secret`
- `FEISHU_VERIFICATION_TOKEN`：只有 webhook 模式才需要
- `FEISHU_ENCRYPT_KEY`：当前项目暂不支持加密事件，建议留空
- `MODEL_BASE_URL`：你的本地模型服务地址
- `MODEL_API_KEY`：模型服务密钥，没有则可继续使用 `EMPTY`
- `MODEL_ID`：模型服务暴露出来的模型 id

注意：

- 当前代码默认通过飞书长连接收事件，不需要公网 URL。
- 当前代码只有在 `FEISHU_CONNECTION_MODE=webhook` 时才会使用 `FEISHU_VERIFICATION_TOKEN`。
- 当前代码监听的飞书事件是 `im.message.receive_v1`。
- 当前代码回复消息时使用的是飞书发送消息接口。

## 2. 创建本地配置文件

在项目根目录执行：

```bash
cp .env.example .env.local
```

然后把你的真实值填进去，例如：

```bash
PORT=3000
HOST=0.0.0.0

FEISHU_CONNECTION_MODE=long-connection
FEISHU_DOMAIN=feishu
FEISHU_APP_ID=cli_xxx
FEISHU_APP_SECRET=xxx
FEISHU_VERIFICATION_TOKEN=
FEISHU_ENCRYPT_KEY=

MODEL_BASE_URL=http://your-model-host/v1
MODEL_API_KEY=EMPTY
MODEL_ID=your-model-id

SYSTEM_PROMPT=你是 LiteClaw，一个简洁可靠的助手。
SESSION_MAX_TURNS=10
EVENT_DEDUPE_TTL_MS=600000
```

建议：

- `.env.local` 不要提交到 Git。
- 如果你当前走长连接模式，可以先把 `FEISHU_VERIFICATION_TOKEN` 留空。
- 只有切换回 webhook 模式时，才需要配置 `FEISHU_VERIFICATION_TOKEN`。

## 3. 在飞书开放平台创建应用

推荐使用：

- 企业自建应用

基础步骤：

1. 打开飞书开放平台。
2. 创建企业自建应用。
3. 进入应用后台，记录 `App ID` 和 `App Secret`。
4. 为应用开启机器人能力。

你需要把这两个值分别填入：

- `FEISHU_APP_ID`
- `FEISHU_APP_SECRET`

## 4. 给应用开启消息相关能力

当前项目要做两件事：

1. 接收飞书消息事件
2. 发送文本消息回复用户

所以飞书应用侧至少要满足：

- 能订阅消息接收事件
- 能调用发送消息接口
- 机器人对目标用户或群可见

如果你在飞书后台看到权限名称和本文略有差异，以“消息接收”和“发送消息”相关权限为准。

## 5. 配置事件订阅为长连接模式

当前项目使用的是：

- 长连接模式
- WebSocket 事件接收

这也是 OpenClaw 使用的接入方向。

### 5.1 选择长连接模式

在飞书后台配置事件订阅时：

- 选择长连接模式
- 不要选择 Request URL webhook 模式

这样飞书会通过官方 SDK 建立 WebSocket 长连接推送事件给本地服务。

注意：

- 这种模式不需要公网域名
- 不需要 `cloudflared`
- 不需要 `ngrok`
- 不需要配置 `Request URL`

### 5.2 订阅事件

当前项目只处理这个事件：

```txt
im.message.receive_v1
```

所以在飞书后台至少要订阅它。

### 5.3 加密配置

当前项目暂不支持飞书加密事件。

因此建议：

- 不开启事件加密
- `FEISHU_ENCRYPT_KEY` 留空

如果你开启了事件加密，当前代码无法处理。

## 6. 发布应用并让机器人可用

完成基本配置后，还需要确保机器人真的能收到消息：

1. 发布或启用当前应用版本
2. 确保机器人对测试用户可见
3. 如果要在群里测试，把机器人拉进群

如果没有完成这一步，即使长连接已经连上，用户也可能在飞书侧根本找不到机器人，或者机器人收不到消息。

## 7. 本地启动 LiteClaw

在项目根目录执行：

```bash
pnpm dev
```

正常情况下服务会监听：

```txt
http://0.0.0.0:3000
```

正常情况下，如果长连接接入成功，日志里会出现类似：

```txt
Feishu long connection client initialized
[ws] ws client ready
```

## 8. 做真实消息联调

长连接模式下，不需要先做公网 URL 验证，可以直接按这个顺序联调：

1. 在飞书里找到你的机器人
2. 私聊机器人发送一条文本消息
3. 观察本地服务日志
4. 看机器人是否回复

如果要在群里调试：

1. 先把机器人拉进群
2. 再发送 `@机器人 + 文本消息`
3. 当前代码只会在群聊中被 `@` 时响应

## 9. 后台提示“未检测到应用连接信息”怎么办

如果你在飞书后台配置长连接时看到：

```txt
未检测到应用连接信息，请确保长连接建立成功后再保存配置
```

这通常表示：

- 飞书后台当前还没有检测到你的应用和飞书平台之间存在一个真实、可用的长连接

这不是单纯“选中了长连接模式”就能通过的，必须满足：

1. 你的本地 LiteClaw 进程已经启动
2. LiteClaw 已经用官方 SDK 成功建立长连接
3. 飞书后台刷新后，能够检测到这条连接

### 正确操作顺序

建议按这个顺序做：

1. 先在本地填好 `.env.local`
2. 执行 `pnpm dev`
3. 保持进程不要退出
4. 观察本地日志，确认长连接已经建立
5. 回到飞书后台刷新页面
6. 再点击保存长连接配置

### 你应该看到什么日志

至少应看到类似：

```txt
client ready
event-dispatch is ready
Feishu long connection started
```

如果本地日志里持续出现下面这类信息，说明连接并没有稳定建立成功：

```txt
read ECONNRESET
connect failed
unable to connect to the server
```

这时飞书后台大概率就会一直显示“未检测到应用连接信息”。

### 最常见原因

#### 9.1 应用类型不对

长连接模式要求：

- 企业自建应用

如果不是企业自建应用，飞书后台可能无法正确检测连接。

#### 9.2 本地启动了错误的应用配置

检查 `.env.local`：

- `FEISHU_APP_ID`
- `FEISHU_APP_SECRET`

必须和你当前飞书后台打开的**同一个应用**完全一致。

#### 9.3 飞书环境填错了

当前默认：

```bash
FEISHU_DOMAIN=feishu
```

如果你接的是国际版 Lark 环境，而不是国内版飞书，就要改成：

```bash
FEISHU_DOMAIN=lark
```

如果环境不匹配，长连接可能无法被正确识别。

#### 9.4 后台页面没刷新

有时候本地连接已经建立，但飞书后台当前页面不会自动更新状态。

建议：

- 本地服务先保持运行
- 回到飞书后台手动刷新页面
- 再重新进入“事件与回调 -> 订阅方式”

#### 9.5 网络环境拦截了 WebSocket

如果本地网络、公司代理或安全策略拦截了 WebSocket，SDK 可能会反复重连，后台就检测不到稳定连接。

典型表现：

- 本地日志里不断出现 `ECONNRESET`
- 能启动，但不能长期保持连接

如果你还需要访问只在公司内网可达的模型服务，当前更推荐：

- 飞书连接走外网或手机热点
- 公司内网能力通过 VPN 保留

这种“热点 + 公司 VPN”的组合通常比本地代理更稳定，也更容易同时满足飞书和模型两端的访问要求。

#### 9.6 应用还未完成基础启用

建议至少确认：

- 机器人能力已开启
- 事件订阅模块已开启
- 应用版本已发布或启用

### 遇到这个问题时的最短排查路径

1. 确认是企业自建应用
2. 确认 `.env.local` 的 `FEISHU_APP_ID` / `FEISHU_APP_SECRET` 对应的是当前这个应用
3. 本地执行 `pnpm dev`
4. 看日志里是否依次出现 `Feishu long connection client initialized` 和 `[ws] ws client ready`
5. 如果日志报 `ECONNRESET` 或 `connect failed`，先不要保存后台配置
6. 日志稳定后，刷新飞书后台页面再保存

## 10. 常见问题排查

### 10.1 `Encrypted Feishu events are not supported in this MVP`

原因：

- 飞书事件加密开启了，但当前代码不支持解密

处理：

- 关闭飞书事件加密
- `FEISHU_ENCRYPT_KEY` 留空

### 10.2 长连接没有建立成功

常见原因：

- `FEISHU_APP_ID` 错了
- `FEISHU_APP_SECRET` 错了
- 应用还没有正确启用
- 事件订阅没有切到长连接模式

处理：

- 重新核对应用后台的 `App ID` 和 `App Secret`
- 确认飞书后台选择的是长连接
- 查看本地启动日志

### 10.3 飞书里发消息没有回复

常见原因：

- 没有订阅 `im.message.receive_v1`
- 机器人没有被加入测试群
- 机器人对当前用户不可见
- 模型服务不可访问
- `MODEL_BASE_URL` / `MODEL_ID` 配置错误

这时建议先看本地日志是否出现：

- `Received Feishu message event`
- `Preparing model request`
- `Calling model`
- `Model reply received`
- `Sending Feishu reply`

如果已经看到 `Calling model`，说明消息已经进到模型层。
如果已经看到 `Sending Feishu reply`，说明 LiteClaw 已经调用了飞书发送消息接口，下一步应检查飞书会话可见性或群聊展示问题。

### 10.4 收到事件但回复失败

检查：

- 本地模型服务是否可访问
- 飞书发送消息接口权限是否开通
- 应用是否已正确发布

### 10.5 我还是想用 webhook

可以，但需要额外满足：

- 设置 `FEISHU_CONNECTION_MODE=webhook`
- 配置 `FEISHU_VERIFICATION_TOKEN`
- 在飞书后台切回 Request URL 模式
- 提供公网 HTTPS 地址

也就是例如：

```bash
FEISHU_CONNECTION_MODE=webhook
FEISHU_VERIFICATION_TOKEN=your-webhook-token
```

然后把飞书回调地址配置为：

```txt
https://your-domain.example.com/feishu/webhook
```

## 11. 推荐的联调顺序

建议按这个顺序做，不容易绕晕：

1. 填好 `.env.local`
2. 本地启动 LiteClaw
3. 飞书后台配置长连接模式
4. 订阅 `im.message.receive_v1`
5. 发布应用
6. 私聊机器人发送文本消息
7. 跑通后再测群聊

## 12. 相关文档

- [README](../README.md)
- [技术方案](./liteclaw-feishu-mvp.md)

飞书官方文档：

- [事件订阅总览](https://open.feishu.cn/document/server-docs/event-subscription-guide/overview)
- [请求地址订阅配置说明](https://open.feishu.cn/document/server-docs/event-subscription-guide/event-subscription-configure-/request-url-configuration-case)
- [发送消息 API](https://open.feishu.cn/document/server-docs/im-v1/message/create)
