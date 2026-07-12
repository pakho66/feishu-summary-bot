# 飞书对话总结机器人

飞书智能对话总结与待办管理机器人，支持实时总结、待办清单和每日 18:00 定时日报。

## 功能特性

- **智能待办清单**：发送消息自动记录为待办，支持完成、修改、交换位置等操作
- **多指令解析**：一句话可以包含多个指令，如"第二个完成，第五个也完成，将第三个改为买菜"
- **实时总结**：在飞书中发送"总结"即可生成今日对话总结
- **定时日报**：每天 18:00 自动发送工作总结到飞书
- **AI 驱动**：集成 DeepSeek API，生成高质量智能总结
- **云端运行 24/7**：无需开着电脑，Cloudflare Workers 全球边缘网络运行
- **冷启动 <5ms**：完美替代 Vercel，飞书 Webhook 验证秒过

## 项目结构

```
feishu-summary-bot/
├── index.js                   # 主入口文件（Cloudflare Workers）
├── package.json               # 项目配置
├── wrangler.toml              # Cloudflare Workers 部署配置
├── .env.example               # 环境变量模板
├── README.md                  # 项目文档
├── 项目复盘.md                 # 项目开发历程
└── scripts/
    └── test-feishu.js         # 飞书 Webhook 测试脚本
```

## 技术栈

| 组件 | 技术 | 说明 |
|------|------|------|
| 运行时 | Cloudflare Workers | 冷启动 <5ms，全球边缘网络 |
| 存储 | Upstash Redis | 免费套餐，REST API，零依赖调用 |
| AI | DeepSeek (deepseek-chat) | 兼容 OpenAI 格式，国内直连 |
| 部署 | wrangler CLI v4 | Cloudflare 官方部署工具 |
| 域名 | zhanbohao.top | 阿里云购买，Cloudflare DNS 托管 |
| 消息平台 | 飞书开放平台 | 事件订阅 + 消息推送 |

## 快速开始

### 1. 前置准备

- [Node.js](https://nodejs.org) 18+
- [Cloudflare 账号](https://dash.cloudflare.com)（免费）
- [Upstash Redis](https://upstash.com) 账号（免费，无需信用卡）
- [DeepSeek API Key](https://platform.deepseek.com)（或任何兼容 OpenAI 格式的 API）
- [飞书开放平台](https://open.feishu.cn) 开发者账号

### 2. 创建飞书应用

1. 打开 [飞书开放平台](https://open.feishu.cn/app)，创建自建应用
2. 点击 **"添加应用能力"** → 添加 **"机器人"**
3. 记下 **App ID** 和 **App Secret**（在"凭证与基础信息"页面）
4. 在 **"权限管理"** 中开通：`im:message`、`im:message:send`

### 3. 配置 Upstash Redis

1. 注册 [Upstash](https://console.upstash.com)，创建 Redis 数据库
2. 记下 **REST URL** 和 **REST Token**

### 4. 克隆项目并安装

```bash
git clone https://github.com/pakho66/feishu-summary-bot.git
cd feishu-summary-bot
npm install
```

### 5. 配置环境变量（Cloudflare Secrets）

**Secrets 必须通过命令行设置，不能写在 wrangler.toml 里**（会被 deploy 覆盖）：

```bash
npx wrangler secret put UPSTASH_REDIS_REST_URL
npx wrangler secret put UPSTASH_REDIS_REST_TOKEN
npx wrangler secret put FEISHU_APP_ID
npx wrangler secret put FEISHU_APP_SECRET
npx wrangler secret put AI_API_URL
npx wrangler secret put AI_MODEL
npx wrangler secret put OPENAI_API_KEY
npx wrangler secret put VERIFICATION_TOKEN
npx wrangler secret put USER_OPEN_ID
```

| 变量名 | 必填 | 说明 |
|--------|------|------|
| `UPSTASH_REDIS_REST_URL` | ✅ | Upstash Redis REST API 地址 |
| `UPSTASH_REDIS_REST_TOKEN` | ✅ | Upstash Redis 访问 Token |
| `FEISHU_APP_ID` | ✅ | 飞书应用 App ID |
| `FEISHU_APP_SECRET` | ✅ | 飞书应用 App Secret |
| `VERIFICATION_TOKEN` | ✅ | 飞书 Webhook 验证 Token（任意字符串） |
| `OPENAI_API_KEY` | ❌ | DeepSeek API Key（或 OpenAI 兼容 Key） |
| `AI_API_URL` | ❌ | AI API 地址，默认 DeepSeek |
| `AI_MODEL` | ❌ | AI 模型名，默认 `deepseek-chat` |
| `USER_OPEN_ID` | ❌ | 用户 Open ID（定时日报用） |

### 6. 部署到 Cloudflare Workers

```bash
npm run deploy
```

部署成功后会得到：
- **Workers 域名**：`https://feishu-summary-bot.你的账号.workers.dev`
- **自定义域名**：`https://zhanbohao.top`（需要配置 DNS）

> **注意**：`workers.dev` 在中国大陆被墙，必须绑定自定义域名才能被飞书访问。

### 7. 配置飞书事件订阅

1. 回到飞书开放平台 → 你的应用 → **"事件与回调"**
2. 填入：
   - **请求网址**：`https://你的域名/webhook`
   - **验证 Token**：和上面 `VERIFICATION_TOKEN` 保持一致
3. 添加事件订阅：`im.message.receive_v1`（接收消息）
4. 点击保存 → 飞书会自动验证（Workers 冷启动 <5ms，秒过）

### 8. 发布应用

1. **"版本管理与发布"** → 创建版本 → 申请发布
2. 等待审核通过（通常几分钟）
3. 在飞书中搜索你的机器人并添加

## API 接口

### POST `/webhook`

飞书事件接收地址。接收用户消息，触发待办记录和总结生成。

### GET `/health`

健康检查接口。

```bash
curl https://zhanbohao.top/health
```

响应示例：
```json
{
  "status": "healthy",
  "timestamp": "2026-07-12T10:00:00.000Z",
  "config": {
    "hasAppId": true,
    "hasAppSecret": true,
    "hasOpenAIKey": true,
    "hasRedisUrl": true,
    "hasUserId": true
  }
}
```

### GET `/cron/daily-summary`

定时任务入口，由 Cloudflare Workers Cron 每天 10:00 UTC（北京时间 18:00）自动触发，发送当日总结。

配置在 `wrangler.toml`：
```toml
[triggers]
crons = ["0 10 * * *"]
```

### GET `/debug/feishu`

调试接口，用于排查飞书消息发送问题。

## 本地开发

```bash
npm run dev
```

这会启动 wrangler 本地开发服务器，模拟 Cloudflare Workers 环境。

### 测试飞书消息发送

```bash
node scripts/test-feishu.js
```

可以通过 ngrok 暴露本地服务进行端到端测试：

```bash
npx ngrok http 8787
```

## 使用说明

### 待办管理

| 指令示例 | 功能 |
|----------|------|
| `买菜` | 新增一条待办 |
| `总结` | 生成当前待办清单和总结 |
| `第二个完成` | 将第 2 条待办标记为完成（删除） |
| `第四个已经完成` | 同上 |
| `将第三个改为买菜` | 修改第 3 条待办内容 |
| `把第一个和第四个换位置` | 交换两条待办的顺序 |
| `第二个完成，将第三个改为买菜，第四个也完成` | 一句话多指令 |

### 总结生成

- 发送 **"总结"** → 机器人即时回复今日对话总结 + 待办清单
- 每天 **18:00 自动** → 发送当日的完整工作总结

## 数据存储

数据存储在 **Upstash Redis**，按天分 key：

- `conversations:YYYY-MM-DD`（List）：当日对话记录，每条为 JSON
- `todos:YYYY-MM-DD`（List）：当日待办清单
- 数据 7 天自动过期

## 故障排查

### 问题 1：飞书 Webhook 验证失败

检查 `VERIFICATION_TOKEN` 是否与飞书开放平台配置一致。

### 问题 2：机器人不回复消息

1. 确认应用已发布
2. 确认已开通 `im:message` 和 `im:message:send` 权限
3. 检查事件订阅是否添加了 `im.message.receive_v1`
4. 用 `wrangler tail` 查看实时日志定位问题

### 问题 3：定时日报未发送

1. 确认 `USER_OPEN_ID` 已正确配置
2. 检查 `wrangler.toml` 中 crons 配置
3. 在 Cloudflare Dashboard 查看 Cron 触发日志

### 问题 4：AI 总结未生成

1. 确认 `OPENAI_API_KEY` 已配置
2. 确认 `AI_API_URL` 和 `AI_MODEL` 配置正确
3. 用 `wrangler tail` 查看 API 调用错误日志

## 参考资料

- [飞书开放平台文档](https://open.feishu.cn/document/)
- [Cloudflare Workers 文档](https://developers.cloudflare.com/workers/)
- [Upstash Redis 文档](https://upstash.com/docs/redis)
- [DeepSeek API 文档](https://platform.deepseek.com/docs)
