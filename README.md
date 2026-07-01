# 飞书对话总结机器人

🤖 自动生成每日对话总结，支持手动触发和定时发送

## ✨ 功能特性

- ✅ **手动触发**：在飞书私聊中发送"总结"即可生成今日总结
- ✅ **定时发送**：每天 18:00 自动发送总结到飞书
- ✅ **永不过期**：动态获取飞书 token，无需担心过期问题
- ✅ **云端运行**：无需开着电脑，完全自动化
- ✅ **智能总结**：集成 OpenAI API，生成高质量的对话总结
- ✅ **数据统计**：自动统计消息数量、时间范围等信息

## 📂 项目结构

```
feishu-summary-bot/
├── index.js                   # 主服务文件
├── package.json               # 项目依赖
├── vercel.json                # Vercel 部署配置
├── .env.example              # 环境变量模板
├── config/                   # 配置文件目录
│   └── config.json           # 运行时配置（自动生成）
├── data/                     # 数据目录
│   ├── conversations/        # 对话记录存储
│   │   └── YYYY-MM-DD.json
│   └── summaries/           # 总结存储
│       └── YYYY-MM-DD.json
└── scripts/                 # 脚本工具
    └── test-feishu.js       # 飞书 Webhook 测试脚本
```

## 🚀 快速开始

### 1. 创建飞书机器人

1. 打开 [飞书开放平台](https://open.feishu.cn/app)
2. 点击 **"创建自建应用"**
3. 填写应用信息：
   - 应用名称：`总结助手`
   - 应用描述：`自动生成对话总结`
4. 点击 **"创建"**
5. 进入应用详情页，点击 **"凭证与基础信息"**
6. 复制以下信息（保存到记事本）：
   - **App ID**（格式：`cli_xxxxxxxxxx`）
   - **App Secret**（点击"查看"按钮）

### 2. 开启机器人能力

1. 点击左侧 **"添加应用能力"**
2. 找到 **"机器人"**，点击 **"添加"**

### 3. 部署到 Vercel

#### 方式 A：一键部署（推荐）

[![Deploy to Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https://github.com/your-username/feishu-summary-bot)

#### 方式 B：手动部署

1. 注册 [Vercel](https://vercel.com)（使用 GitHub 账号登录）
2. 点击 **"New Project"**
3. 导入你的 GitHub 仓库
4. 填写环境变量：
   - `FEISHU_APP_ID`: 你的 App ID
   - `FEISHU_APP_SECRET`: 你的 App Secret
   - `VERIFICATION_TOKEN`: 随便写一个字符串（例如：`my-verification-token-123`）
   - `OPENAI_API_KEY`: 你的 OpenAI API Key（可选）
   - `USER_OPEN_ID`: 你的飞书 Open ID（可选，用于定时发送）
5. 点击 **"Deploy"**
6. 等待 2 分钟，复制生成的 URL（格式：`https://你的项目名.vercel.app`）

### 4. 配置飞书 Webhook

1. 回到 [飞书开放平台](https://open.feishu.cn/app)
2. 进入你的应用
3. 点击左侧 **"事件与回调"**
4. 找到 **"请求网址"**
5. 填写：
   - **请求网址**：`https://你的项目名.vercel.app/webhook`
   - **验证 Token**：填写你在 Vercel 配置的第 4 个环境变量（`VERIFICATION_TOKEN`）
6. 点击 **"保存"**

### 5. 发布应用

1. 点击左侧 **"版本管理与发布"**
2. 点击 **"创建版本"**
3. 填写版本信息，点击 **"保存"**
4. 点击 **"申请发布"**
5. 等待审核（通常几分钟）

### 6. 测试

1. 在飞书中搜索你的机器人（`总结助手`）
2. 点击 **"添加"**
3. 发送消息：`总结`
4. 机器人回复：`📊 正在生成今日总结...`
5. 几秒后，收到总结消息

## 📡 API 接口

### POST `/webhook`

飞书 Webhook 接收地址

**用途**：接收飞书消息，触发总结生成

**配置**：在飞书开放平台配置为事件接收地址

### GET `/generate-summary`

手动触发总结生成

**参数**：
- `date`（可选）：总结日期，格式 `YYYY-MM-DD`，默认今天
- `user_id`（可选）：用户 Open ID，默认配置文件中的 `USER_OPEN_ID`

**示例**：
```bash
curl "https://你的项目名.vercel.app/generate-summary?date=2026-06-30&user_id=ou_xxx"
```

### GET `/cron/daily-summary`

定时任务接口（每天 18:00 自动调用）

**用途**：每天定时生成并发送总结

**配置**：在 `vercel.json` 中配置 cron 表达式

### GET `/health`

健康检查接口

**示例**：
```bash
curl "https://你的项目名.vercel.app/health"
```

**响应**：
```json
{
  "status": "healthy",
  "timestamp": "2026-06-30T19:00:00.000Z",
  "config": {
    "hasAppId": true,
    "hasAppSecret": true,
    "hasOpenAIKey": true,
    "hasUserId": true
  }
}
```

## ⚙️ 配置说明

### 环境变量

| 变量名 | 必填 | 说明 |
|--------|------|------|
| `FEISHU_APP_ID` | ✅ | 飞书应用的 App ID |
| `FEISHU_APP_SECRET` | ✅ | 飞书应用的 App Secret |
| `VERIFICATION_TOKEN` | ✅ | Webhook 验证 Token |
| `OPENAI_API_KEY` | ❌ | OpenAI API Key（用于 AI 总结） |
| `USER_OPEN_ID` | ❌ | 用户 Open ID（用于定时发送） |
| `PORT` | ❌ | 服务器端口（默认：3000） |
| `NODE_ENV` | ❌ | 运行环境（development/production） |

### 定时任务配置

在 `vercel.json` 中修改 cron 表达式：

```json
"crons": [
  {
    "path": "/cron/daily-summary",
    "schedule": "0 10 * * *"
  }
]
```

**常用时间**（北京时间）：

| 时间 | Cron 表达式（UTC） |
|------|---------------------|
| 每天 08:00 | `0 0 * * *` |
| 每天 12:00 | `0 4 * * *` |
| 每天 18:00 | `0 10 * * *` |
| 每天 20:00 | `0 12 * * *` |
| 每周一 09:00 | `0 1 * * 1` |

## 🧪 本地开发

### 1. 安装依赖

```bash
npm install
```

### 2. 配置环境变量

复制 `.env.example` 为 `.env` 并填写真实值：

```bash
cp .env.example .env
```

### 3. 启动开发服务器

```bash
npm run dev
```

### 4. 测试 Webhook

使用 [ngrok](https://ngrok.com) 或 [localtunnel](https://localtunnel.github.io/www/) 暴露本地服务：

```bash
# 安装 localtunnel
npm install -g localtunnel

# 暴露本地服务
lt --port 3000
```

复制生成的 URL，配置到飞书开放平台。

### 5. 测试飞书发送

```bash
node scripts/test-feishu.js
```

## 📝 数据存储

### 对话记录

存储在 `data/conversations/YYYY-MM-DD.json`

**格式**：
```json
[
  {
    "timestamp": "2026-06-30T10:00:00.000Z",
    "userId": "ou_xxx",
    "role": "user",
    "content": "今天讨论了什么？"
  },
  {
    "timestamp": "2026-06-30T10:00:05.000Z",
    "userId": "ou_xxx",
    "role": "bot",
    "content": "讨论了 GitHub Actions 和 Render 的配置。"
  }
]
```

### 总结记录

存储在 `data/summaries/YYYY-MM-DD.json`

**格式**：
```json
{
  "date": "2026-06-30",
  "stats": {
    "total": 42,
    "userMessages": 21,
    "botMessages": 21,
    "timeRange": {
      "start": "2026-06-30T09:00:00.000Z",
      "end": "2026-06-30T18:00:00.000Z"
    }
  },
  "aiSummary": "今天主要讨论了...",
  "generatedAt": "2026-06-30T18:00:00.000Z",
  "autoSent": true
}
```

## 🔧 故障排查

### 问题 1：飞书 Webhook 验证失败

**原因**：`VERIFICATION_TOKEN` 配置不一致

**解决**：
1. 确认飞书开放平台配置的验证 Token
2. 确认 Vercel 环境变量 `VERIFICATION_TOKEN` 的值
3. 两个值必须完全一致

### 问题 2：发送消息失败

**原因**：Token 获取失败或权限不足

**解决**：
1. 检查 `FEISHU_APP_ID` 和 `FEISHU_APP_SECRET` 是否正确
2. 确认应用已开启"机器人"能力
3. 确认应用已发布

### 问题 3：定时任务未执行

**原因**：Vercel Cron 配置错误或用户 Open ID 未配置

**解决**：
1. 检查 `vercel.json` 中的 cron 配置
2. 确认环境变量 `USER_OPEN_ID` 已配置
3. 在 Vercel 控制台手动触发 cron 任务测试

### 问题 4：AI 总结未生成

**原因**：未配置 OpenAI API Key

**解决**：
1. 获取 [OpenAI API Key](https://platform.openai.com/api-keys)
2. 配置环境变量 `OPENAI_API_KEY`
3. 重新部署

## 📚 技术栈

- **运行时**：Node.js 18+
- **框架**：Express.js
- **部署平台**：Vercel
- **API 客户端**：
  - Axios（HTTP 请求）
  - OpenAI SDK（AI 总结）
- **数据存储**：本地 JSON 文件（可扩展为数据库）

## 🔒 安全建议

1. **不要提交 `.env` 文件到 Git**
   - 已在 `.gitignore` 中忽略
   - 使用环境变量或配置文件

2. **限制 Webhook 访问**
   - 验证请求来源 IP（飞书服务器 IP 段）
   - 使用签名验证

3. **保护用户数据**
   - 对话记录包含敏感信息
   - 建议加密存储或使用数据库

## 📖 参考资料

- [飞书开放平台文档](https://open.feishu.cn/document/)
- [飞书机器人开发指南](https://open.feishu.cn/document/ukTMukTMukTM/uAjMxEjLwITMx4CMyETM)
- [Vercel 部署文档](https://vercel.com/docs)
- [Vercel Cron Jobs](https://vercel.com/docs/cron-jobs)

## 📄 许可证

MIT License

## 🤝 贡献

欢迎提交 Issue 和 Pull Request！

---

**开发者**：你的名字
**创建时间**：2026-06-30
**最后更新**：2026-06-30
