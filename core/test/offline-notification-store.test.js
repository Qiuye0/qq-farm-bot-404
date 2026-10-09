const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qq-farm-notification-'));
process.env.FARM_DATA_DIR = dataDir;
fs.writeFileSync(path.join(dataDir, 'store.json'), JSON.stringify({ userOfflineReminders: { legacy: {
  channel: 'smtp', smtpHost: 'host', smtpUser: 'user', smtpPass: 'pass', recipientEmail: 'recipient', emailContent: '旧自定义内容',
} } }));
const store = require('../src/models/store');
test.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));

test('历史邮件设置迁移，保留自定义说明', () => {
  const config = store.getOfflineReminder('legacy');
  assert.equal(config.smtpEnabled, true);
  assert.equal(config.xtuisEnabled, false);
  assert.equal(config.msg, '旧自定义内容');
});

test('四种渠道状态持久化，全部关闭不会因旧 channel 回启', () => {
  for (const smtpEnabled of [false, true]) for (const xtuisEnabled of [false, true]) {
    store.setOfflineReminder({ smtpEnabled, xtuisEnabled, xtuisToken: 'fake-token', title: '标题', msg: '说明' }, 'legacy');
    const config = store.getOfflineReminder('legacy');
    assert.equal(config.smtpEnabled, smtpEnabled);
    assert.equal(config.xtuisEnabled, xtuisEnabled);
    const saved = JSON.parse(fs.readFileSync(path.join(dataDir, 'store.json'))).userOfflineReminders.legacy;
    assert.equal(saved.smtpEnabled, smtpEnabled);
    assert.equal(saved.xtuisEnabled, xtuisEnabled);
    assert.equal(saved.xtuisToken, 'fake-token');
    assert.equal(saved.msg, '说明');
  }
  assert.equal(store.getOfflineReminder('other').xtuisToken, '');
});
