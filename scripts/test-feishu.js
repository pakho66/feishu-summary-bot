const axios = require('axios');
require('dotenv').config();

// 测试飞书 Webhook
async function testFeishuWebhook() {
  const webhookUrl = process.env.TEST_WEBHOOK_URL || 'http://localhost:3000/webhook';
  
  console.log('🧪 测试飞书 Webhook...');
  console.log(`URL: ${webhookUrl}`);
  
  try {
    // 测试 1：URL 验证
    console.log('\n📝 测试 1：URL 验证');
    const verifyResponse = await axios.post(webhookUrl, {
      type: 'url_verification',
      challenge: 'test-challenge-123',
      token: process.env.VERIFICATION_TOKEN || 'your-verification-token'
    });
    
    console.log('✅ URL 验证成功');
    console.log(`   Challenge: ${verifyResponse.data.challenge}`);
    
    // 测试 2：接收消息事件
    console.log('\n📝 测试 2：接收消息事件');
    const messageResponse = await axios.post(webhookUrl, {
      header: {
        event_id: 'test-event-123',
        event_type: 'im.message.receive',
        create_time: Date.now(),
        token: process.env.VERIFICATION_TOKEN || 'your-verification-token',
        app_id: 'test-app-id'
      },
      event: {
        sender: {
          sender_id: {
            user_id: 'test-user-id',
            open_id: 'ou_test-open-id',
            union_id: 'test-union-id'
          }
        },
        message: {
          message_id: 'test-message-id',
          root_id: '',
          create_time: Date.now(),
          chat_id: 'test-chat-id',
          chat_type: 'p2p',
          message_type: 'text',
          content: JSON.stringify({ text: '总结' })
        }
      }
    }, {
      headers: {
        'Content-Type': 'application/json'
      }
    });
    
    console.log('✅ 消息事件处理成功');
    console.log(`   Response: ${JSON.stringify(messageResponse.data)}`);
    
    console.log('\n🎉 所有测试通过！');
    console.log('\n💡 下一步：');
    console.log('   1. 将 Webhook URL 配置到飞书开放平台');
    console.log(`   2. URL: ${webhookUrl}`);
    console.log('   3. 在飞书中添加机器人并测试发送 "总结"');
    
  } catch (error) {
    console.error('\n❌ 测试失败:', error.message);
    
    if (error.response) {
      console.error('   响应状态:', error.response.status);
      console.error('   响应数据:', error.response.data);
    }
    
    if (error.code === 'ECONNREFUSED') {
      console.error('\n💡 提示: 请确保服务器已启动');
      console.error('   运行: npm run dev');
    }
    
    process.exit(1);
  }
}

// 测试发送消息到飞书
async function testSendToFeishu() {
  console.log('\n📝 测试 3：发送消息到飞书');
  
  if (!process.env.FEISHU_APP_ID || !process.env.FEISHU_APP_SECRET) {
    console.warn('⚠️  未配置飞书 App ID 或 App Secret，跳过发送测试');
    return;
  }
  
  try {
    // 获取 token
    const tokenResponse = await axios.post(
      'https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal',
      {
        app_id: process.env.FEISHU_APP_ID,
        app_secret: process.env.FEISHU_APP_SECRET
      }
    );
    
    if (tokenResponse.data.code !== 0) {
      throw new Error(`获取 token 失败: ${tokenResponse.data.msg}`);
    }
    
    const token = tokenResponse.data.tenant_access_token;
    console.log('✅ 获取飞书 token 成功');
    
    // 发送测试消息
    if (!process.env.TEST_USER_OPEN_ID) {
      console.warn('⚠️  未配置 TEST_USER_OPEN_ID，跳过发送测试');
      return;
    }
    
    const sendResponse = await axios.post(
      'https://open.feishu.cn/open-apis/im/v1/messages',
      {
        receive_id: process.env.TEST_USER_OPEN_ID,
        msg_type: 'text',
        content: JSON.stringify({
          text: '🧪 测试消息：飞书机器人配置成功！'
        })
      },
      {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        params: {
          receive_id_type: 'open_id'
        }
      }
    );
    
    if (sendResponse.data.code === 0) {
      console.log('✅ 消息发送成功');
      console.log(`   消息 ID: ${sendResponse.data.data.message_id}`);
    } else {
      throw new Error(`发送消息失败: ${sendResponse.data.msg}`);
    }
    
  } catch (error) {
    console.error('❌ 发送测试失败:', error.message);
    
    if (error.response) {
      console.error('   响应数据:', error.response.data);
    }
  }
}

// 主函数
async function main() {
  console.log('='.repeat(60));
  console.log('🧪 飞书总结机器人 - 测试工具');
  console.log('='.repeat(60));
  
  await testFeishuWebhook();
  await testSendToFeishu();
  
  console.log('\n✅ 所有测试完成！');
}

main();
