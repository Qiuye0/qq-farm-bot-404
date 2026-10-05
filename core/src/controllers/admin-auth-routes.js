const crypto = require('node:crypto');
const {
  clearAdminSessionCookie,
  getAdminRequestToken,
  setAdminSessionCookie,
} = require('./admin-session-manager');

const ACCESS_CODE_DIGEST = crypto.createHash('sha256').update('chenjunjie').digest();
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const MAX_LOGIN_FAILURES = 5;
const MAX_TRACKED_CLIENTS = 10000;

function createLoginLimiter({ now = Date.now } = {}) {
  const attempts = new Map();

  function check(req, res) {
    const time = now();
    for (const [client, entry] of attempts) {
      if (entry.resetAt <= time)
        attempts.delete(client);
    }
    // Do not trust arbitrary X-Forwarded-For values on a publicly exposed port.
    const key = req.socket?.remoteAddress || 'unknown';
    const entry = attempts.get(key);
    if ((entry && entry.failures >= MAX_LOGIN_FAILURES)
      || (!entry && attempts.size >= MAX_TRACKED_CLIENTS)) {
      const resetAt = entry?.resetAt || time + LOGIN_WINDOW_MS;
      res.setHeader('Retry-After', Math.max(1, Math.ceil((resetAt - time) / 1000)));
      res.status(429).json({ ok: false, error: '验证次数过多，请稍后再试' });
      return null;
    }
    return {
      fail() {
        attempts.set(key, {
          failures: (entry?.failures || 0) + 1,
          resetAt: entry?.resetAt || time + LOGIN_WINDOW_MS,
        });
      },
      success() {
        attempts.delete(key);
      },
    };
  }
  return { check };
}

function registerAdminAuthRoutes({
  app,
  createAdminSession,
  requireAdminToken,
  invalidateAdminSessionAndDisconnect,
  limiter = createLoginLimiter(),
}) {
  app.post('/api/login', (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    const attempt = limiter.check(req, res);
    if (!attempt) return;
    const code = req.body?.code;
    const validInput = typeof code === 'string' && code.length <= 128;
    const digest = crypto.createHash('sha256').update(validInput ? code : '').digest();
    if (!validInput || !crypto.timingSafeEqual(digest, ACCESS_CODE_DIGEST)) {
      attempt.fail();
      return res.status(401).json({ ok: false, error: 'Code 不正确' });
    }
    attempt.success();
    const admin = {
      username: 'admin',
      role: 'admin',
      card: null,
      accountLimit: Number.MAX_SAFE_INTEGER,
      mustChangePassword: false,
    };
    const previousToken = getAdminRequestToken(req);
    if (previousToken)
      invalidateAdminSessionAndDisconnect(previousToken);
    const token = createAdminSession(admin);
    setAdminSessionCookie(req, res, token);
    return res.json({ ok: true, data: admin });
  });

  app.post('/api/logout', requireAdminToken, (req, res) => {
    invalidateAdminSessionAndDisconnect(req.adminToken);
    clearAdminSessionCookie(req, res);
    return res.json({ ok: true });
  });
}

module.exports = { createLoginLimiter, registerAdminAuthRoutes };
