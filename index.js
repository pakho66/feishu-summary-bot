// 飞书对话总结机器人 - Cloudflare Workers 版
// 冷启动 <5ms，飞书 Webhook 验证秒过
// 零依赖：使用纯 fetch 调用 Upstash Redis REST API

// ========== Upstash Redis REST 客户端（零依赖） ==========

function createRedis(env) {
  const url = env.UPSTASH_REDIS_REST_URL;
  const token = env.UPSTASH_REDIS_REST_TOKEN;

  async function call(command) {
    const response = await fetch(`${url}/${command.join('/')}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Upstash error ${response.status}: ${text}`);
    }
    return response.json();
  }

  return {
    rpush: (key, value) => call(['rpush', key, encodeURIComponent(value)]),
    lrange: async (key, start, stop) => {
      const result = await call(['lrange', key, start, stop]);
      return result.result || [];
    },
    expire: (key, seconds) => call(['expire', key, seconds]),
    lrem: (key, count, value) => call(['lrem', key, count, encodeURIComponent(value)]),
    lindex: async (key, index) => {
      const result = await call(['lindex', key, index]);
      return result.result;
    },
    llen: async (key) => {
      const result = await call(['llen', key]);
      return result.result;
    },
    lset: (key, index, value) => call(['lset', key, index, encodeURIComponent(value)]),
    del: (key) => call(['del', key]),
  };
}

// ========== 工具函数 ==========

function getTodayKey() {
  return `conversations:${new Date().toISOString().split('T')[0]}`;
}

async function getFeishuToken(CONFIG) {
  const response = await fetch('https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      app_id: CONFIG.FEISHU_APP_ID,
      app_secret: CONFIG.FEISHU_APP_SECRET,
    }),
  });
  const data = await response.json();
  if (data.code === 0) return data.tenant_access_token;
  throw new Error(`获取 token 失败: ${data.msg}`);
}

async function saveConversation(redis, userId, message, role) {
  const key = getTodayKey();
  const entry = JSON.stringify({
    timestamp: new Date().toISOString(),
    userId,
    role,
    content: message,
  });
  await redis.rpush(key, entry);
  await redis.expire(key, 7 * 24 * 3600); // 7天过期
}

async function getTodayConversations(redis) {
  const key = getTodayKey();
  const data = await redis.lrange(key, 0, -1);
  return data.map(item => {
    try { return JSON.parse(item); }
    catch { return item; }
  });
}

function generateStats(convList) {
  return {
    total: convList.length,
    userMessages: convList.filter(m => m.role === 'user').length,
    botMessages: convList.filter(m => m.role === 'bot').length,
    timeRange: {
      start: convList[0]?.timestamp || 'N/A',
      end: convList[convList.length - 1]?.timestamp || 'N/A',
    },
  };
}

async function generateAISummary(CONFIG, convList) {
  if (!CONFIG.OPENAI_API_KEY) return null;
  if (!CONFIG.AI_API_URL) return null;
  try {
    const conversationText = convList
      .map(m => `${m.role === 'user' ? 'pakho' : '机器人'}: ${m.content}`)
      .join('\n');

    const response = await fetch(CONFIG.AI_API_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${CONFIG.OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: CONFIG.AI_MODEL,
        messages: [
          { role: 'system', content: '你是一个专业的对话总结助手。请根据用户提供的对话记录，生成一份简洁的中文总结，直接概括对话的核心内容，不要分章节或列出标题。' },
          { role: 'user', content: `请总结以下对话：\n\n${conversationText}` },
        ],
        temperature: 0.7,
      }),
    });

    const data = await response.json();
    return data.choices?.[0]?.message?.content || null;
  } catch (error) {
    console.error('AI API 调用失败:', error);
    return null;
  }
}

function formatFeishuMessage(aiSummary, date, todos) {
  const now = new Date();
  const time = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  let content = `📅 ${date} ${time} 对话总结\n`;
  if (todos && todos.length > 0) {
    content += `\n📋 未完成待办\n`;
    todos.forEach((todo, i) => {
      content += `${i + 1}. ${todo}\n`;
    });
  } else {
    content += `\n暂无待办`;
  }
  return content;
}

// ========== 待办管理 ==========

const TODO_KEY = 'todos';

async function getTodos(redis) {
  const data = await redis.lrange(TODO_KEY, 0, -1);
  return data;
}

async function addTodo(redis, content) {
  await redis.rpush(TODO_KEY, content);
}

async function removeTodoByIndex(redis, index) {
  const todos = await redis.lrange(TODO_KEY, 0, -1);
  if (index >= 0 && index < todos.length) {
    await redis.lrem(TODO_KEY, 1, todos[index]);
    return true;
  }
  return false;
}

async function updateTodoByIndex(redis, index, newContent) {
  const todos = await redis.lrange(TODO_KEY, 0, -1);
  if (index >= 0 && index < todos.length) {
    await redis.lset(TODO_KEY, index, newContent);
    return true;
  }
  return false;
}

async function swapTodos(redis, index1, index2) {
  const todos = await redis.lrange(TODO_KEY, 0, -1);
  if (index1 >= 0 && index1 < todos.length && index2 >= 0 && index2 < todos.length && index1 !== index2) {
    const temp = todos[index1];
    await redis.lset(TODO_KEY, index1, todos[index2]);
    await redis.lset(TODO_KEY, index2, temp);
    return true;
  }
  return false;
}

// 解析修改待办指令，返回 { index, mode, text } 或 null
// mode: 'replace' = 替换整个待办, 'append' = 在原待办后面追加
function parseModifyCommand(content) {
  const chineseNums = { '一': 1, '二': 2, '三': 3, '四': 4, '五': 5, '六': 6, '七': 7, '八': 8, '九': 9, '十': 10 };

  function parseNum(s) {
    if (chineseNums[s] !== undefined) return chineseNums[s];
    return parseInt(s, 10);
  }

  // 替换模式：第X个改成/改为/换成/更改为 xxx
  const replacePatterns = [
    /(?:把\s*)?第\s*(\d+|[一二三四五六七八九十]+)\s*个(?:待办)?\s*(?:改成|改为|更改为|换成|修改为|改)\s*[:：]?\s*(.+)/,
    /(?:修改|更改|改)\s*第\s*(\d+|[一二三四五六七八九十]+)\s*个(?:待办)?\s*(?:为|改成|改为)\s*[:：]?\s*(.+)/,
  ];

  for (const pattern of replacePatterns) {
    const match = content.match(pattern);
    if (match) {
      return { index: parseNum(match[1]) - 1, mode: 'replace', text: match[2].trim() };
    }
  }

  // 追加模式：第X个(后面)加/补充/追加 xxx
  const appendPatterns = [
    /第\s*(\d+|[一二三四五六七八九十]+)\s*个(?:待办)?\s*(?:后面)?\s*(?:加|补充|追加|加上)\s*[:：]?\s*(.+)/,
  ];

  for (const pattern of appendPatterns) {
    const match = content.match(pattern);
    if (match) {
      return { index: parseNum(match[1]) - 1, mode: 'append', text: match[2].trim() };
    }
  }

  return null;
}

function parseCompleteCommand(content) {
  const patterns = [
    /第\s*(\d+)\s*个.*(?:完成|好了|做了|搞定|做完)/,
    /第\s*([一二三四五六七八九十]+)\s*个.*(?:完成|好了|做了|搞定|做完)/,
  ];
  const chineseNums = { '一': 1, '二': 2, '三': 3, '四': 4, '五': 5, '六': 6, '七': 7, '八': 8, '九': 9, '十': 10 };
  for (const pattern of patterns) {
    const match = content.match(pattern);
    if (match) {
      let num = match[1];
      if (chineseNums[num] !== undefined) {
        num = chineseNums[num];
      } else {
        num = parseInt(num, 10);
      }
      return num;
    }
  }
  return null;
}

// 解析交换待办指令：将第X个和第Y个换位置
function parseSwapCommand(content) {
  const chineseNums = { '一': 1, '二': 2, '三': 3, '四': 4, '五': 5, '六': 6, '七': 7, '八': 8, '九': 9, '十': 10 };
  function parseNum(s) {
    if (chineseNums[s] !== undefined) return chineseNums[s];
    return parseInt(s, 10);
  }

  const patterns = [
    /(?:将|把|交换|换|对调|调换).*?第\s*(\d+|[一二三四五六七八九十]+)\s*个.*?第\s*(\d+|[一二三四五六七八九十]+)\s*个.*(?:换|交换|对调|调换|位置)/,
    /第\s*(\d+|[一二三四五六七八九十]+)\s*个?\s*(?:和|与|跟)\s*第\s*(\d+|[一二三四五六七八九十]+)\s*个?\s*(?:换|交换|对调|调换|互换|位置)/,
    /(?:交换|对调)\s*第\s*(\d+|[一二三四五六七八九十]+)\s*个?\s*(?:和|与|跟)\s*第\s*(\d+|[一二三四五六七八九十]+)\s*个?/,
  ];

  for (const pattern of patterns) {
    const match = content.match(pattern);
    if (match) {
      const i1 = parseNum(match[1]) - 1;
      const i2 = parseNum(match[2]) - 1;
      if (!isNaN(i1) && !isNaN(i2) && i1 !== i2) {
        return { index1: i1, index2: i2 };
      }
    }
  }
  return null;
}

// 解析一条消息中的所有待办操作指令（支持多个指令用逗号等分隔符连接）
function parseAllCommands(content) {
  const trimmed = content.trim();

  // 辅助函数：对一个文本片段尝试匹配所有指令类型
  function tryParseSegment(seg) {
    const t = seg.trim();
    if (!t) return null;

    const ci = parseCompleteCommand(t);
    if (ci !== null) return { type: 'complete', index: ci, raw: t };

    const sw = parseSwapCommand(t);
    if (sw !== null) return { type: 'swap', index1: sw.index1, index2: sw.index2, raw: t };

    const md = parseModifyCommand(t);
    if (md !== null) return { type: 'modify', index: md.index, mode: md.mode, text: md.text, raw: t };

    return null;
  }

  // 步骤1：智能分割 —— 只在「后面紧跟指令关键词」的分隔符处分割
  // 指令关键词包括：第、将、把、交换、对调、修改、更改
  // 这样"买苹果，香蕉和橘子"中的逗号不会被误分割，因为逗号后不是"第/将/把"等
  const smartSplitRegex = /\s*(?:[,，；;、]|然后|并且|同时|还有|另外)\s*(?=第|将|把|交换|对调|修改|更改)/g;
  const segments = trimmed.split(smartSplitRegex);

  if (segments.length > 1) {
    // 尝试逐段解析
    const parsed = [];
    let allMatched = true;
    for (const seg of segments) {
      const t = seg.trim();
      if (!t) continue;
      const cmd = tryParseSegment(t);
      if (cmd !== null) {
        parsed.push(cmd);
      } else {
        allMatched = false;
      }
    }
    // 所有片段都匹配了指令 → 确认是多指令消息
    if (allMatched && parsed.length > 0) {
      return parsed;
    }
    // 部分片段没匹配 → 可能是误分割（如"将第一个改为买苹果，第三箱牛奶"）
    // 回退到整段匹配
  }

  // 步骤2：整段匹配（单指令，或误分割回退）
  const single = tryParseSegment(trimmed);
  if (single !== null) {
    return [single];
  }

  // 步骤3：都不是指令 → 返回空（将作为普通待办处理）
  return [];
}

async function sendToFeishu(token, receiveId, text, isGroup = false) {
  const idType = isGroup ? 'chat_id' : 'open_id';
  const response = await fetch(`https://open.feishu.cn/open-apis/im/v1/messages?receive_id_type=${idType}`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      receive_id: receiveId,
      msg_type: 'text',
      content: JSON.stringify({ text }),
    }),
  });
  const data = await response.json();
  console.log('sendToFeishu 结果:', JSON.stringify(data));
  return data.code === 0;
}

// ========== 异步消息处理 ==========

async function processMessage(body, redis, CONFIG) {
  const message = body.event?.message;
  const sender = body.event?.sender;
  console.log('processMessage 开始:', JSON.stringify({ hasMessage: !!message, hasSender: !!sender, eventType: body.header?.event_type, chatId: message?.chat_id, senderId: sender?.sender_id?.open_id }));
  if (!message || !sender) {
    console.log('processMessage 退出: 缺少 message 或 sender');
    return;
  }

  const content = JSON.parse(message?.content || '{}').text || '';
  const senderId = sender.sender_id?.open_id;
  const chatId = message?.chat_id;  // 群聊时存在，私聊时为空
  const isGroup = !!chatId;
  // 群聊回复到群里，私聊回复给用户
  const replyToId = isGroup ? chatId : senderId;

  console.log('解析消息:', JSON.stringify({ senderId, chatId, isGroup, replyToId, content }));

  // 保存对话记录
  await saveConversation(redis, senderId, content, 'user');
  // 自动记录用户 open_id（用于定时日报推送）
  if (senderId) {
    await redis.rpush('user_open_ids', senderId);
  }

  const token = await getFeishuToken(CONFIG);
  console.log('获取 Token:', token ? 'OK' : 'FAIL');

  // 1. 多指令解析：尝试从消息中提取所有待办操作指令
  const allCommands = parseAllCommands(content);

  if (allCommands.length > 0) {
    // 索引偏移修复：将 destructive 操作（complete）按索引从大到小排序
    // 避免"删第1个和第2个"时，先删第1个导致第2个的索引变成原来的第3个
    const nonDestructive = allCommands.filter(c => c.type !== 'complete');
    const destructive = allCommands
      .filter(c => c.type === 'complete')
      .sort((a, b) => b.index - a.index);  // 从大到小：先处理索引大的
    const sortedCommands = [...nonDestructive, ...destructive];

    const resultLines = [];
    for (const cmd of sortedCommands) {
      if (cmd.type === 'complete') {
        const success = await removeTodoByIndex(redis, cmd.index - 1);
        if (success) {
          resultLines.push(`✅ 第${cmd.index}个待办已完成`);
        } else {
          resultLines.push(`⚠️ 未找到第${cmd.index}个待办`);
        }
      } else if (cmd.type === 'modify') {
        if (cmd.mode === 'replace') {
          const success = await updateTodoByIndex(redis, cmd.index, cmd.text);
          if (success) {
            resultLines.push(`✏️ 第${cmd.index + 1}个待办已改为：${cmd.text}`);
          } else {
            resultLines.push(`⚠️ 未找到第${cmd.index + 1}个待办`);
          }
        } else { // append
          const oldTodo = await redis.lindex(TODO_KEY, cmd.index);
          if (oldTodo) {
            const newTodo = `${oldTodo} ${cmd.text}`;
            await updateTodoByIndex(redis, cmd.index, newTodo);
            resultLines.push(`✏️ 第${cmd.index + 1}个待办已更新为：${newTodo}`);
          } else {
            resultLines.push(`⚠️ 未找到第${cmd.index + 1}个待办`);
          }
        }
      } else if (cmd.type === 'swap') {
        const success = await swapTodos(redis, cmd.index1, cmd.index2);
        if (success) {
          resultLines.push(`🔄 第${cmd.index1 + 1}个和第${cmd.index2 + 1}个已交换位置`);
        } else {
          resultLines.push(`⚠️ 交换失败，请检查编号是否正确`);
        }
      }
    }

    // 发送操作结果
    const todoResultText = `📋 操作结果：\n${resultLines.join('\n')}`;
    await sendToFeishu(token, replyToId, todoResultText, isGroup);

    // 自动发送更新后的总结
    const todos = await getTodos(redis);
    const today = new Date().toISOString().split('T')[0];
    const summaryText = formatFeishuMessage(null, today, todos);
    await sendToFeishu(token, replyToId, summaryText, isGroup);
    return;
  }

  // 2. 检测"总结"指令
  if (content.includes('总结')) {
    const todos = await getTodos(redis);
    const today = new Date().toISOString().split('T')[0];
    const summaryText = formatFeishuMessage(null, today, todos);
    await sendToFeishu(token, replyToId, summaryText, isGroup);
    return;
  }

  // 3. 其他消息 → 记录为待办，并自动发送更新后的总结
  await addTodo(redis, content);
  const todos = await getTodos(redis);
  const today = new Date().toISOString().split('T')[0];
  const summaryText = formatFeishuMessage(null, today, todos);
  await sendToFeishu(token, replyToId, summaryText, isGroup);
}

// ========== 定时日报（18:00 北京时间） ==========

async function dailySummary(redis, CONFIG) {
  // 从 Redis 读取最近交互的用户 open_id
  let userId = CONFIG.USER_OPEN_ID;
  if (!userId) {
    try {
      const ids = await redis.lrange('user_open_ids', 0, 0);
      userId = ids[0];
    } catch (e) {
      console.error('读取用户 open_id 失败:', e);
    }
  }
  if (!userId) {
    console.log('未找到用户 open_id，跳过定时总结');
    return;
  }

  const token = await getFeishuToken(CONFIG);
  const todos = await getTodos(redis);
  if (todos.length === 0) {
    console.log('无待办，不发送总结');
    return;
  }
  const today = new Date().toISOString().split('T')[0];
  const summaryText = formatFeishuMessage(null, today, todos);
  const success = await sendToFeishu(token, userId, summaryText);
  console.log(`定时总结发送${success ? '成功' : '失败'}: ${today}`);
}

// ========== 从 env 创建 Redis 和 CONFIG ==========

function createConfig(env) {
  return {
    FEISHU_APP_ID: env.FEISHU_APP_ID || '',
    FEISHU_APP_SECRET: env.FEISHU_APP_SECRET || '',
    OPENAI_API_KEY: env.OPENAI_API_KEY || '',
    AI_API_URL: env.AI_API_URL || '',
    AI_MODEL: env.AI_MODEL || 'deepseek-chat',
    VERIFICATION_TOKEN: env.VERIFICATION_TOKEN || '',
    USER_OPEN_ID: env.USER_OPEN_ID || '',
  };
}

// ========== 主入口 ==========

export default {
  // HTTP 请求处理
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;

    const redis = createRedis(env);
    const CONFIG = createConfig(env);

    const headers = {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    };

    try {
      // CORS preflight
      if (method === 'OPTIONS') {
        return new Response(null, {
          headers: {
            ...headers,
            'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type',
          },
        });
      }

      // ===== POST /webhook - 飞书 Webhook =====
      if (path === '/webhook' && method === 'POST') {
        const body = await request.json();
        console.log('收到飞书请求:', JSON.stringify(body).substring(0, 200));

        // URL 验证（飞书订阅时触发）—— 必须同步立即返回！
        if (body.type === 'url_verification') {
          console.log('飞书 URL 验证请求，立即返回 challenge');
          return new Response(JSON.stringify({
            challenge: body.challenge,
            token: CONFIG.VERIFICATION_TOKEN,
          }), { headers });
        }

        // 消息事件 —— ctx.waitUntil 异步处理，飞书立即收到 200
        if (body.header?.event_type?.startsWith('im.message.receive')) {
          ctx.waitUntil(processMessage(body, redis, CONFIG));
          return new Response(JSON.stringify({ success: true }), { headers });
        }

        return new Response(JSON.stringify({ success: true }), { headers });
      }

      // ===== GET /health - 健康检查 =====
      if (path === '/health' && method === 'GET') {
        // 诊断：列出 env 中存在的所有 key 名称（不暴露值）
        const envKeys = Object.keys(env);
        const conversations = await getTodayConversations(redis);
        return new Response(JSON.stringify({
          status: 'healthy',
          timestamp: new Date().toISOString(),
          todayConversations: conversations.length,
          runtime: 'cloudflare-workers',
          envKeys,
          config: {
            hasAppId: !!CONFIG.FEISHU_APP_ID,
            hasAppSecret: !!CONFIG.FEISHU_APP_SECRET,
            hasOpenAIKey: !!CONFIG.OPENAI_API_KEY,
            hasAIUrl: !!CONFIG.AI_API_URL,
            aiModel: CONFIG.AI_MODEL,
            hasUserId: !!CONFIG.USER_OPEN_ID,
            hasRedis: !!env.UPSTASH_REDIS_REST_URL,
          },
        }), { headers });
      }

      // ===== POST /cron/daily-summary - 手动触发日报 =====
      if (path === '/cron/daily-summary') {
        ctx.waitUntil(dailySummary(redis, CONFIG));
        return new Response(JSON.stringify({ success: true, message: 'Daily summary triggered' }), { headers });
      }

      // ===== GET /debug/feishu - 飞书 API 诊断 =====
      if (path === '/debug/feishu' && method === 'GET') {
        let result = { tokenTest: '', sendTest: '' };
        try {
          const token = await getFeishuToken(CONFIG);
          result.tokenTest = 'OK';
          // 尝试获取机器人信息以验证 token 有效
          const infoResp = await fetch('https://open.feishu.cn/open-apis/bot/v3/info', {
            headers: { 'Authorization': `Bearer ${token}` },
          });
          const infoData = await infoResp.json();
          result.tokenInfo = { code: infoData.code, msg: infoData.msg };
          result.sendTest = 'token valid';
        } catch (e) {
          result.tokenTest = `FAIL: ${e.message}`;
        }
        return new Response(JSON.stringify(result, null, 2), { headers });
      }

      // ===== GET / - 首页 =====
      if (path === '/' && method === 'GET') {
        const conversations = await getTodayConversations(redis);
        const html = `<!DOCTYPE html>
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
    .cf { background: #f6821f; color: white; }
  </style>
</head>
<body>
  <div class="card">
    <h1>🤖 飞书对话总结机器人 <span class="badge cf">Cloudflare Workers</span></h1>
    <p>运行中 · 今日对话 ${conversations.length} 条 · 冷启动 &lt;5ms</p>
  </div>
  <div class="card status">
    <h3>📊 系统状态</h3>
    <ul>
      <li>${CONFIG.FEISHU_APP_ID ? '✅' : '❌'} 飞书 App ID ${CONFIG.FEISHU_APP_ID ? '<span class="badge ok">已配置</span>' : '<span class="badge warn">未配置</span>'}</li>
      <li>${CONFIG.FEISHU_APP_SECRET ? '✅' : '❌'} 飞书 App Secret ${CONFIG.FEISHU_APP_SECRET ? '<span class="badge ok">已配置</span>' : '<span class="badge warn">未配置</span>'}</li>
      <li>${env.UPSTASH_REDIS_REST_URL ? '✅' : '❌'} Redis 存储 ${env.UPSTASH_REDIS_REST_URL ? '<span class="badge ok">已连接</span>' : '<span class="badge warn">未配置</span>'}</li>
      <li>${CONFIG.OPENAI_API_KEY ? '✅' : '⚠️'} OpenAI API Key ${CONFIG.OPENAI_API_KEY ? '<span class="badge ok">已配置</span>' : '<span class="badge warn">未配置（可选）</span>'}</li>
      <li>${CONFIG.USER_OPEN_ID ? '✅' : '⚠️'} 用户 Open ID ${CONFIG.USER_OPEN_ID ? '<span class="badge ok">已配置</span>' : '<span class="badge warn">未配置（定时日报需要）</span>'}</li>
    </ul>
  </div>
  <div class="card">
    <h3>📡 API 接口</h3>
    <div class="endpoint"><strong>POST /webhook</strong> — 飞书 Webhook 接收地址（验证 &lt;5ms）</div>
    <div class="endpoint"><strong>GET /health</strong> — 健康检查</div>
    <div class="endpoint"><strong>POST /cron/daily-summary</strong> — 手动触发日报</div>
  </div>
</body>
</html>`;
        return new Response(html, {
          headers: { 'Content-Type': 'text/html; charset=utf-8' },
        });
      }

      // 404
      return new Response(JSON.stringify({ error: 'Not Found' }), {
        status: 404,
        headers,
      });
    } catch (error) {
      console.error('处理请求失败:', error);
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500,
        headers,
      });
    }
  },

  // Cron 定时触发（每天 18:00 北京时间 = 10:00 UTC）
  async scheduled(event, env, ctx) {
    const redis = createRedis(env);
    const CONFIG = createConfig(env);
    ctx.waitUntil(dailySummary(redis, CONFIG));
  },
};
