const test = require('node:test');
const assert = require('node:assert/strict');
const { enabledNotificationChannels, buildOfflineNotification, sendOfflineNotifications } = require('../src/services/offline-notification');
const { sendXtuisMessage } = require('../src/services/push');
const { createReloginReminderService } = require('../src/runtime/relogin-reminder');

for (const smtpEnabled of [false, true]) {
  for (const xtuisEnabled of [false, true]) {
    test(`渠道组合: 邮件=${smtpEnabled}, 虾推=${xtuisEnabled}`, async () => {
      const calls = [];
      const config = { smtpEnabled, xtuisEnabled, xtuisToken: 'fake-token' };
      const result = await sendOfflineNotifications(config, buildOfflineNotification(config, { accountName: '农场 A' }), {
        sendSmtpEmail: async payload => { calls.push('smtp'); assert.match(payload.content, /账号名称: 农场 A/); return { ok: true }; },
        sendXtuisMessage: async payload => { calls.push('xtuis'); assert.match(payload.content, /账号名称: 农场 A/); return { ok: true }; },
      });
      assert.deepEqual(calls.sort(), [smtpEnabled && 'smtp', xtuisEnabled && 'xtuis'].filter(Boolean).sort());
      assert.equal(result.ok, smtpEnabled || xtuisEnabled);
    });
  }
}

test('标题说明使用自定义文本，账号名和下线上下文始终附带', () => {
  assert.deepEqual(buildOfflineNotification({ title: '快来看看', msg: '请重新登录\n第二行' }, { accountName: 'kk', reason: '异地登录', offlineMs: 120000 }), {
    title: '快来看看', content: '请重新登录\n第二行\n账号名称: kk\n原因: 异地登录\n离线时长: 2 分钟',
  });
  assert.match(buildOfflineNotification({}, { test: true }).content, /账号名称: 测试账号/);
});

test('一个渠道异常不阻止另一个渠道发送，错误不包含密钥', async () => {
  let sent = false;
  const result = await sendOfflineNotifications({ smtpEnabled: true, xtuisEnabled: true }, { title: '标题', content: '说明' }, {
    sendSmtpEmail: async () => { throw new Error('password=secret'); },
    sendXtuisMessage: async () => { sent = true; return { ok: true, msg: '已受理' }; },
  });
  assert.equal(sent, true);
  assert.equal(result.ok, false);
  assert.equal(result.results[1].ok, true);
  assert.doesNotMatch(JSON.stringify(result), /secret/);
});

test('虾推严格编码中文、换行和 URL 特殊字符', async () => {
  const result = await sendXtuisMessage({ token: 'fake-token', title: '标题 & ? #', content: '账号名称: A\n说明=100%' }, async (input, options) => {
    const url = new URL(input);
    assert.equal(url.origin, 'https://wx.xtuis.cn');
    assert.equal(url.pathname, '/fake-token.send');
    assert.equal(url.searchParams.get('text'), '标题 & ? #');
    assert.equal(url.searchParams.get('desp'), '账号名称: A\n说明=100%');
    assert.equal(options.timeout, 10000);
    return { ok: true, text: async () => JSON.stringify({ code: 200, msg: '成功' }) };
  });
  assert.equal(result.ok, true);
});

test('虾推拒绝 HTTP 错误、业务失败及未知响应，网络异常隐藏 Token', async () => {
  const payload = { token: 'private-token', title: '标题', content: '说明' };
  for (const response of [
    { ok: false, status: 429 },
    { ok: true, text: async () => '{"code":403,"msg":"invalid token"}' },
    { ok: true, text: async () => '<html>proxy error</html>' },
    { ok: true, text: async () => '{}' },
    { ok: true, text: async () => '{"success":false,"msg":"success"}' },
  ]) assert.equal((await sendXtuisMessage(payload, async () => response)).ok, false);
  await assert.rejects(sendXtuisMessage(payload, async () => { throw new Error('URL contains private-token'); }), error => !error.message.includes('private-token'));
  await assert.rejects(sendXtuisMessage({ ...payload, token: '../other?token' }), /格式无效/);
  assert.equal((await sendXtuisMessage(payload, async () => ({ ok: true, text: async () => '{"status":"queued","msg_id":"fake-id"}' }))).ok, true);
});

test('运行时按账号所属用户取配置，缺省账号名从账号记录补全', async () => {
  const calls = [];
  const service = createReloginReminderService({
    store: { getOfflineReminder: username => { assert.equal(username, 'alice'); return { smtpEnabled: false, xtuisEnabled: true, xtuisToken: 'fake-token', title: '自定义', msg: '说明' }; } },
    getAccounts: () => ({ accounts: [{ id: 'a1', username: 'alice', name: '小农场' }] }),
    sendXtuisMessage: async message => { calls.push(message); return { ok: true }; },
    log: () => {},
  });
  await service.triggerOfflineReminder({ accountId: 'a1', reason: 'kickout' });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].title, '自定义');
  assert.match(calls[0].content, /账号名称: 小农场/);
});

test('旧邮件配置兼容，显式关闭优先于历史 channel 字段', () => {
  const legacy = { channel: 'smtp', smtpHost: 'host', smtpUser: 'user', smtpPass: 'pass', recipientEmail: 'recipient' };
  assert.deepEqual(enabledNotificationChannels(legacy), ['smtp']);
  assert.deepEqual(enabledNotificationChannels({ ...legacy, smtpEnabled: false, xtuisEnabled: false }), []);
  assert.deepEqual(enabledNotificationChannels({}), []);
});
