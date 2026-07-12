// 飞书 Webhook 测试脚本（纯 fetch，兼容 Cloudflare Workers 环境）
// 用法：node scripts/test-feishu.js

const BASE_URL = process.env.TEST_BASE_URL || 'https://zhanbohao.top';
const VERIFICATION_TOKEN = process.env.VERIFICATION_TOKEN || 'your-verification-token-123';

async function test() {
  console.log('='.repeat(60));
  console.log('飞书总结机器人 - Webhook 测试工具');
  console.log('='.repeat(60));

  // 测试 1：URL 验证
  console.log('\n[测试 1] URL 验证请求');
  try {
    const verifyRes = await fetch(`${BASE_URL}/webhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'url_verification',
        challenge: 'test-challenge-123',
        token: VERIFICATION_TOKEN,
      }),
    });
    const verifyData = await verifyRes.json();
    if (verifyData.challenge === 'test-challenge-123') {
      console.log('  状态:', verifyRes.status);
    } else {
      console.log('  结果: challenge 不匹配', verifyData);
    }
  } catch (err) {
    console.error('  失败:', err.message);
  }

  // 测试 2：接收消息事件
  console.log('\n[测试 2] 接收消息事件');
  try {
    const msgRes = await fetch(`${BASE_URL}/webhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        schema: '2.0',
        header: {
          event_id: 'test-event-' + Date.now(),
          event_type: 'im.message.receive_v1',
          create_time: String(Date.now()),
          token: VERIFICATION_TOKEN,
          app_id: 'test-app-id',
        },
        event: {
          sender: {
            sender_id: { open_id: 'ou_test-open-id' },
          },
          message: {
            message_id: 'test-msg-' + Date.now(),
            create_time: String(Date.now()),
            chat_id: 'oc_test-chat-id',
            chat_type: 'p2p',
            message_type: 'text',
            content: JSON.stringify({ text: '总结' }),
          },
        },
      }),
    });
    console.log('  状态:', msgRes.status);
    const msgData = await msgRes.json();
    console.log('  响应:', JSON.stringify(msgData));
  } catch (err) {
    console.error('  失败:', err.message);
  }

  // 测试 3：健康检查
  console.log('\n[测试 3] 健康检查');
  try {
    const healthRes = await fetch(`${BASE_URL}/health`);
    console.log('  状态:', healthRes.status);
    const healthData = await healthRes.json();
    console.log('  响应:', JSON.stringify(healthData, null, 2));
  } catch (err) {
    console.error('  失败:', err.message);
  }

  console.log('\n测试完成！');
}

test();
