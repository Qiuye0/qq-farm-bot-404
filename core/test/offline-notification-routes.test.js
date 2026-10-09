const test = require('node:test');
const assert = require('node:assert/strict');
const push = require('../src/services/push');
const { registerAdminSettingsRoutes } = require('../src/controllers/admin-settings-routes');

function harness({ accessible = true } = {}) {
  const routes = new Map();
  registerAdminSettingsRoutes({
    app: Object.fromEntries(['get', 'post', 'put'].map(method => [method, (url, handler) => routes.set(`${method} ${url}`, handler)])),
    store: {
      getOfflineReminder: () => ({ smtpEnabled: false, xtuisEnabled: false }),
      getAccounts: () => ({ accounts: [{ id: 'a1', name: '账号甲' }] }),
    },
    getAccountIdFromRequest: req => req.headers?.['x-account-id'] || '',
    canAccessAccount: () => accessible,
  });
  return async (req) => {
    let status = 200;
    let body;
    const res = { status: code => { status = code; return res; }, json: value => { body = value; return res; } };
    await routes.get('post /api/settings/offline-reminder/test')(req, res);
    return { status, body };
  };
}

test('测试接口只通知已开启的渠道，使用当前账号名和自定义标题说明', async (t) => {
  const original = push.sendXtuisMessage;
  const calls = [];
  push.sendXtuisMessage = async message => { calls.push(message); return { ok: true, msg: '已受理' }; };
  t.after(() => { push.sendXtuisMessage = original; });
  const invoke = harness();
  const result = await invoke({ currentUser: { username: 'alice' }, headers: { 'x-account-id': 'a1' }, body: { smtpEnabled: false, xtuisEnabled: true, xtuisToken: 'fake-token', title: '自定义标题', msg: '自定义说明' } });
  assert.equal(result.status, 200);
  assert.equal(result.body.ok, true);
  assert.equal(calls[0].title, '自定义标题（测试）');
  assert.match(calls[0].content, /自定义说明\n账号名称: 账号甲/);
});

test('全关、未登录及无账号权限不会发出任何请求', async (t) => {
  const original = push.sendXtuisMessage;
  push.sendXtuisMessage = async () => { assert.fail('不应发送通知'); };
  t.after(() => { push.sendXtuisMessage = original; });
  assert.equal((await harness()({ body: {} })).status, 401);
  assert.equal((await harness({ accessible: false })({ currentUser: { username: 'alice' }, headers: { 'x-account-id': 'a1' }, body: { xtuisEnabled: true } })).status, 403);
  const disabled = await harness()({ currentUser: { username: 'alice' }, body: { smtpEnabled: false, xtuisEnabled: false } });
  assert.equal(disabled.status, 400);
  assert.match(disabled.body.error, /至少开启/);
});

test('部分渠道失败时测试接口包含各渠道结果，成功渠道仍发送', async (t) => {
  const smtp = push.sendSmtpEmail;
  const xtuis = push.sendXtuisMessage;
  let sent = false;
  push.sendSmtpEmail = async () => { throw new Error('secret'); };
  push.sendXtuisMessage = async () => { sent = true; return { ok: true, msg: '已受理' }; };
  t.after(() => { push.sendSmtpEmail = smtp; push.sendXtuisMessage = xtuis; });
  const result = await harness()({ currentUser: { username: 'alice' }, body: { smtpEnabled: true, xtuisEnabled: true, xtuisToken: 'fake-token' } });
  assert.equal(result.status, 400);
  assert.equal(sent, true);
  assert.deepEqual(result.body.data.results.map(item => item.ok), [false, true]);
  assert.doesNotMatch(JSON.stringify(result.body), /secret/);
});
