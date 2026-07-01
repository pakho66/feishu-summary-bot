const express = require('express');
const axios = require('axios');
const OpenAI = require('openai');

const app = express();
app.use(express.json());

// 内存存储（Vercel Serverless 无持久化，重启即清空）
let conversations = [];

// 读取配置（仅从环境变量）
const CONFIG = {
  FEISHU_APP_ID: process.env.FEISHU_APP_ID || '',
  FEISHU_APP_SECRET: process.env.FEISHU_APP_SECRET || '',
  OPENAI_API_KEY: process.env.OPENAI_API_KEY || '',
  VERIFICATION_TOKEN: process.env.VERIFICATION_TOKEN || 'your-verification-token',
  USER_OPEN_ID: process.env.USER_OPEN_ID || ''
};

// 动态获取飞书 access token
async function getFeishuToken() {
  try {
    const response = await axios.post(
      'https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal',
      {
        app_id: CONFIG.FEISHU_APP_ID,
        app_secret: CONFIG.FEISHU_APP_SECRET
      }
    );

    if (response.data.code === 0) {
      console.log('✅ 获取飞书 token 成功');
      return response.data.tenant_access_token;
    }
    throw new Error(`获取 token 失败: ${response.data.msg}`);
  } catch (error) {
    console.error('❌ 获取飞书 token 失败:', error.response?.data || error.message);
    throw error;
  }
}

// 保存对话记录（内存版）
function saveConversation(userId, message, role) {
  conversations.push({
    timestamp: new Date().toISOString(),
    userId,
    role,
    content: message
  });
  console.log(`💾 保存对话记录: ${role} - ${String(message).substring(0, 50)}...`);
}

// 生成统计
function generateStats(convList) {
  return {
    total: convList.length,
    userMessages: convList.filter(m => m.role === 'user').length,
    botMessages: convList.filter(m => m.role === 'bot').length,
    timeRange: {
      start: convList[0]?.timestamp || 'N/A',
      end: convList[convList.length - 1]?.timestamp || 'N/A'
    }
  };
}

// 调用 OpenAI 生成总结
async function generateAISummary(convList) {
  if (!CONFIG.OPENAI_API_KEY) {
    console.log('⚠️  未配置 OpenAI API Key，跳过 AI 总结');
    return null;
  }
  try {
    const openai = new OpenAI({ apiKey: CONFIG.OPENAI_API_KEY });
    const conversationText = convList
      .map(m => `${m.role === 'user' ? '用户' : '机器人'}: ${m.content}`)
      .join('\n');

    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: '你是一个专业的对话总结助手。请根据用户提供的对话记录，生成一份清晰、结构化的中文总结，包含：主要讨论、关键决策、待办事项。'
        },
        { role: 'user', content: `请总结以下对话：\n\n${conversationText}` }
      ],
      temperature: 0.7
    });

    console.log('✅ AI 总结生成成功');
    return response.choices[0].message.content;
  } catch (error) {
    console.error('❌ OpenAI API 调用失败:', error.message);
    return null;
  }
}

// 格式化飞书消息
function formatFeishuMessage(stats, aiSummary, date) {
  let content = `📅 ${date} 对话总结\n\n`;
  content += `📊 统计信息\n`;
  content += `• 消息总数: ${stats.total}\n`;
  content += `• 用户消息: ${stats.userMessages}\n`;
  content += `• 机器人消息: ${stats.botMessages}\n`;
  if (stats.timeRange.start !== 'N/A') {
    content += `• 时间范围: ${stats.timeRange.start.split('T')[1].split('.')[0]} - ${stats.timeRange.end.split('T')[1].split('.')[0]}\n\n`;
  }
  if (aiSummary) {
    content += `🤖 AI 智能总结\n${aiSummary}`;
  } else {
    content += `💡 提示: 配置 OpenAI API Key 以启用 AI 智能总结`;
  }
  return { msg_type: 'text', content: { text: content } };
}

// 发送消息到飞书
async function sendToFeishu(token, receiveId, message) {
  try {
    const response = await axios.post(
      'https://open.feishu.cn/open-apis/im/v1/messages',
      {
        receive_id: receiveId,
        msg_type: message.msg_type,
        content: JSON.stringify(message.content)
      },
      {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        params: { receive_id_type: 'open_id' }
      }
    );

    if (response.data.code === 0) {
      console.log('✅ 消息发送成功');
      return true;
    }
    throw new Error(`发送消息失败: ${response.data.msg}`);
  } catch (error) {
    console.error('❌ 发送消息失败:', error.response?.data || error.message);
    return false;
  }
}

// Webhook 接收飞书消息
app.post('/webhook', async (req, res) => {
  try {
    const body = req.body;
    console.log('📨 收到请求:', JSON.stringify(body, null, 2));

    // URL 验证
    if (body.type === 'url_verification') {
      console.log('✅ URL 验证请求');
      return res.json({ challenge: body.challenge, token: CONFIG.VERIFICATION_TOKEN });
    }

    // 处理消息事件
    if (body.header?.event_type === 'im.message.receive') {
      const message = body.event?.message;
      const sender = body.event?.sender;

      if (!message || !sender) {
        return res.json({ success: true });
      }

      const content = JSON.parse(message?.content || '{}').text || '';
      const senderId = sender.sender_id?.open_id;

      console.log(`📨 收到消息: ${senderId} - ${content}`);

      saveConversation(senderId, content, 'user');

      if (content.includes('总结')) {
        const token = await getFeishuToken();
        await sendToFeishu(token, senderId, {
          msg_type: 'text',
          content: { text: '📊 正在生成今日总结...' }
        });

        if (conversations.length === 0) {
          await sendToFeishu(token, senderId, {
            msg_type: 'text',
            content: { text: '⚠️ 今日暂无对话记录' }
          });
          return res.json({ success: true });
        }

        const stats = generateStats(conversations);
        const aiSummary = await generateAISummary(conversations);
        const today = new Date().toISOString().split('T')[0];
        const summaryMessage = formatFeishuMessage(stats, aiSummary, today);

        await sendToFeishu(token, senderId, summaryMessage);
        console.log('✅ 总结生成并发送成功');
      }
    }

    res.json({ success: true });
  } catch (error) {
    console.error('❌ 处理消息失败:', error);
    res.json({ success: false, error: error.message });
  }
});

// 手动触发总结
app.get('/generate-summary', async (req, res) => {
  try {
    const userId = req.query.user_id || CONFIG.USER_OPEN_ID;
    if (!userId) {
      return res.status(400).json({ error: '缺少 user_id 参数' });
    }
    if (conversations.length === 0) {
      return res.status(404).json({ error: '未找到对话记录' });
    }
    const stats = generateStats(conversations);
    const aiSummary = await generateAISummary(conversations);
    const today = new Date().toISOString().split('T')[0];
    res.json({ success: true, summary: { date: today, stats, aiSummary } });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 定时任务
app.get('/cron/daily-summary', async (req, res) => {
  try {
    const userId = CONFIG.USER_OPEN_ID;
    if (!userId) return res.status(400).json({ error: '未配置 USER_OPEN_ID' });
    if (conversations.length === 0) {
      return res.json({ success: true, message: '今日暂无对话记录' });
    }
    const stats = generateStats(conversations);
    const aiSummary = await generateAISummary(conversations);
    const today = new Date().toISOString().split('T')[0];
    const message = formatFeishuMessage(stats, aiSummary, today);
    const token = await getFeishuToken();
    const success = await sendToFeishu(token, userId, message);
    res.json({ success, message: success ? '每日总结发送成功' : '发送失败' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 健康检查
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    config: {
      hasAppId: !!CONFIG.FEISHU_APP_ID,
      hasAppSecret: !!CONFIG.FEISHU_APP_SECRET,
      hasOpenAIKey: !!CONFIG.OPENAI_API_KEY,
      hasUserId: !!CONFIG.USER_OPEN_ID
    }
  });
});

// 首页
app.get('/', (req, res) => {
  res.send(`<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>飞书对话总结机器人</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 800px; margin: 50px auto; padding: 20px; background: #f5f5f5; }
    .card { background: white; padding: 24px; border-radius: 12px; box-shadow: 0 2px 8px rgba(0,0,0,0.05); margin-bottom: 20px; }
    h1 { color: #1f1f1f; margin-top: 0; }
    .status ul { list-style: none; padding: 0; }
    .status li { padding: 6px 0; }
    .endpoint { padding: 12px; background: #fafafa; border: 1px solid #e8e8e8; border-radius: 6px; margin: 10px 0; font-size: 14px; }
    code { background: #f0f0f0; padding: 2px 8px; border-radius: 4px; font-size: 13px; }
    .badge { display: inline-block; padding: 4px 10px; border-radius: 4px; font-size: 12px; margin-left: 8px; }
    .ok { background: #d4edda; color: #155724; }
    .warn { background: #fff3cd; color: #856404; }
  </style>
</head>
<body>
  <div class="card">
    <h1>🤖 飞书对话总结机器人</h1>
    <p>运行在 Vercel Serverless 上</p>
  </div>
  <div class="card status">
    <h3>📊 系统状态</h3>
    <ul>
      <li>${CONFIG.FEISHU_APP_ID ? '✅' : '❌'} 飞书 App ID ${CONFIG.FEISHU_APP_ID ? '<span class="badge ok">已配置</span>' : '<span class="badge warn">未配置</span>'}</li>
      <li>${CONFIG.FEISHU_APP_SECRET ? '✅' : '❌'} 飞书 App Secret ${CONFIG.FEISHU_APP_SECRET ? '<span class="badge ok">已配置</span>' : '<span class="badge warn">未配置</span>'}</li>
      <li>${CONFIG.OPENAI_API_KEY ? '✅' : '⚠️'} OpenAI API Key ${CONFIG.OPENAI_API_KEY ? '<span class="badge ok">已配置</span>' : '<span class="badge warn">未配置（可选）</span>'}</li>
      <li>${CONFIG.USER_OPEN_ID ? '✅' : '⚠️'} 用户 Open ID ${CONFIG.USER_OPEN_ID ? '<span class="badge ok">已配置</span>' : '<span class="badge warn">未配置（可选）</span>'}</li>
    </ul>
  </div>
  <div class="card">
    <h3>📡 API 接口</h3>
    <div class="endpoint"><strong>POST /webhook</strong> — 飞书 Webhook 接收地址</div>
    <div class="endpoint"><strong>GET /generate-summary</strong> — 手动触发总结<br><code>/generate-summary?user_id=xxx</code></div>
    <div class="endpoint"><strong>GET /cron/daily-summary</strong> — 定时任务（每天 18:00）</div>
    <div class="endpoint"><strong>GET /health</strong> — 健康检查</div>
  </div>
</body>
</html>`);
});

module.exports = app;
