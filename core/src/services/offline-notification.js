const push = require('./push');

function enabledNotificationChannels(config = {}) {
  const smtpEnabled = typeof config.smtpEnabled === 'boolean' ? config.smtpEnabled
    : (!config.channel || config.channel === 'smtp') && !!(config.smtpHost && config.smtpUser && config.smtpPass && config.recipientEmail);
  const xtuisEnabled = typeof config.xtuisEnabled === 'boolean' ? config.xtuisEnabled : config.channel === 'xtuis' && !!config.token;
  return [smtpEnabled && 'smtp', xtuisEnabled && 'xtuis'].filter(Boolean);
}

function buildOfflineNotification(config, { accountName = '', accountId = '', reason = '', offlineMs = 0, test = false } = {}) {
  const name = String(accountName || accountId || (test ? '测试账号' : '未知账号')).trim();
  const title = String(config.title || '账号下线提醒').trim();
  let content = `${String(config.msg || config.emailContent || '账号下线').trim()}\n账号名称: ${name}`;
  if (reason) content += `\n原因: ${reason}`;
  const minutes = Math.floor(Number(offlineMs) / 60000);
  if (minutes > 0) content += `\n离线时长: ${minutes} 分钟`;
  if (test) content += '\n这是一条下线提醒测试消息。';
  return { title: test ? `${title}（测试）` : title, content };
}

async function sendOfflineNotifications(config, message, senders = push) {
  const channels = enabledNotificationChannels(config);
  const results = await Promise.all(channels.map(async (channel) => {
    try {
      const result = channel === 'smtp'
        ? await senders.sendSmtpEmail({ ...config, subject: message.title, content: message.content })
        : await senders.sendXtuisMessage({ token: config.xtuisToken ?? (config.channel === 'xtuis' ? config.token : ''), ...message });
      return { channel, ok: result?.ok === true, msg: result?.msg || '发送失败' };
    } catch {
      // 外部库错误可能含 SMTP 密码或完整推送 URL，统一返回安全文案。
      return { channel, ok: false, msg: channel === 'smtp' ? '邮件发送失败，请检查 SMTP 配置及网络' : '虾推发送失败，请检查 Token 及网络' };
    }
  }));
  const ok = results.length > 0 && results.every(result => result.ok);
  const msg = results.length === 0 ? '请至少开启一个通知渠道' : results.map(result => `${result.channel === 'smtp' ? '邮件' : '虾推'}: ${result.msg}`).join('；');
  return { ok, msg, results };
}

module.exports = { enabledNotificationChannels, buildOfflineNotification, sendOfflineNotifications };
