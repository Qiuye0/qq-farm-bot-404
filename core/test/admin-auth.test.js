const assert = require('node:assert/strict');
const { once } = require('node:events');
const test = require('node:test');
const express = require('express');
const { Server } = require('socket.io');
const {
  allowAdminSocketRequest,
  createAdminSocketAuth,
  registerAuthGate,
  registerDocumentAuthGate,
  rejectCrossOriginMutation,
} = require('../src/controllers/admin-access-gate');
const { createLoginLimiter, registerAdminAuthRoutes } = require('../src/controllers/admin-auth-routes');
const {
  ADMIN_SESSION_COOKIE,
  ADMIN_SESSION_TTL_MS,
  createAdminSessionManager,
  getAdminRequestToken,
} = require('../src/controllers/admin-session-manager');

async function fixture(t) {
  let time = Date.now();
  let io;
  const app = express();
  app.set('trust proxy', 'loopback');
  const sessions = createAdminSessionManager({ now: () => time, getIo: () => io });
  app.use('/api', rejectCrossOriginMutation);
  app.use(express.json({ limit: '256kb' }));
  registerAuthGate(app, sessions.requireAdminToken);
  registerDocumentAuthGate(app, sessions.hasToken);
  registerAdminAuthRoutes({
    app,
    ...sessions,
    limiter: createLoginLimiter({ now: () => time }),
  });
  app.get('/api/health', (_req, res) => res.json({ ok: true }));
  app.get('/api/public/login-links', (_req, res) => res.json({ ok: true, data: { title: 'Farm' } }));
  app.get('/api/public/capture-certificate/:flow/:token', (req, res) =>
    res.sendStatus(req.params.token === 'temporary-token' ? 200 : 403));
  app.get('/api/auth/validate', (_req, res) => res.json({ ok: true, data: { valid: true } }));
  app.get('/api/accounts', (req, res) => res.json({ ok: true, username: req.currentUser.username }));
  app.post('/api/accounts', (_req, res) => res.json({ ok: true }));
  app.get('/game-config/Plant.json', (_req, res) => res.json([]));
  app.get('/assets/app.js', (_req, res) => res.type('js').send('/* public shell */'));
  app.get('*', (_req, res) => res.send('<html>SPA shell</html>'));
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  io = new Server(server, { allowRequest: allowAdminSocketRequest });
  io.use(createAdminSocketAuth(sessions.getSession));
  const base = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => {
    sessions.invalidateAdminSessions(() => true);
    await new Promise(resolve => io.close(resolve));
    server.closeAllConnections();
  });
  return {
    base,
    io,
    sessions,
    advance(ms) { time += ms; },
    request(path, { headers = {}, body, method = body === undefined ? 'GET' : 'POST', ...options } = {}) {
      return fetch(base + path, {
        ...options,
        method,
        redirect: 'manual',
        headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...headers },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    },
    async login(headers = {}) {
      const response = await this.request('/api/login', { body: { code: 'chenjunjie' }, headers });
      assert.equal(response.status, 200);
      return response.headers.get('set-cookie').split(';')[0];
    },
  };
}

test('anonymous page navigation redirects to verification while shell assets stay available', async (t) => {
  const f = await fixture(t);
  const original = '/settings?tab=system&name=%E5%86%9C%E5%9C%BA';
  const response = await f.request(original, { headers: { Accept: 'text/html' } });
  assert.equal(response.status, 302);
  assert.equal(response.headers.get('location'), `/login?redirect=${encodeURIComponent(original)}`);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal((await f.request('/login', { headers: { Accept: 'text/html' } })).status, 200);
  assert.equal((await f.request('/assets/app.js')).status, 200);
  const cookie = await f.login();
  assert.equal((await f.request(original, { headers: { Accept: 'text/html', Cookie: cookie } })).status, 200);
});

test('code verification issues only an HttpOnly cookie and supports authenticated refresh', async (t) => {
  const f = await fixture(t);
  const response = await f.request('/api/login', { body: { code: 'chenjunjie' } });
  assert.equal(response.status, 200);
  const cookieHeader = response.headers.get('set-cookie');
  assert.match(cookieHeader, /HttpOnly/);
  assert.match(cookieHeader, /SameSite=Strict/);
  assert.match(cookieHeader, /Path=\//);
  assert.match(cookieHeader, /Max-Age=604800/);
  assert.doesNotMatch(cookieHeader, /Secure/);
  const body = await response.json();
  assert.equal(body.data.username, 'admin');
  assert.equal(body.data.token, undefined);
  assert.doesNotMatch(JSON.stringify(body), /chenjunjie/);
  const cookie = cookieHeader.split(';')[0];
  const authenticated = await f.request('/api/accounts', { headers: { Cookie: cookie } });
  assert.equal(authenticated.status, 200);
  assert.equal((await authenticated.json()).username, 'admin');
  assert.equal((await f.request('/api/auth/validate', { headers: { Cookie: cookie } })).status, 200);
});

test('missing, malformed and old credentials never grant access', async (t) => {
  const f = await fixture(t);
  for (const body of [{}, { code: ['chenjunjie'] }, { username: 'admin', password: 'admin' }, { code: 'CHENJUNJIE' }]) {
    const response = await f.request('/api/login', { body });
    assert.equal(response.status, 401);
    assert.equal(response.headers.get('set-cookie'), null);
  }
  for (const path of ['/api/auto-login', '/api/qr/create', '/api/qr/check', '/api/game-version',
    '/api/changelog', '/api/auth/validate', '/api/accounts', '/game-config/Plant.json']) {
    const response = await f.request(path, {
      method: path.endsWith('auto-login') ? 'POST' : 'GET',
      headers: { 'x-admin-token': 'invented-token', Cookie: `${ADMIN_SESSION_COOKIE}=forged` },
    });
    assert.equal(response.status, 401, path);
  }
});

test('only intended read-only public endpoints are exempt, including HEAD health checks', async (t) => {
  const f = await fixture(t);
  assert.equal((await f.request('/api/health', { method: 'HEAD' })).status, 200);
  assert.equal((await f.request('/api/health', { headers: { Accept: 'text/html' } })).status, 200);
  assert.equal((await f.request('/api/public/login-links')).status, 200);
  assert.equal((await f.request('/api/public/capture-certificate/flow/temporary-token')).status, 200);
  assert.equal((await f.request('/api/public/capture-certificate/flow/wrong')).status, 403);
  assert.equal((await f.request('/api/public/capture-certificate/anything')).status, 401);
  assert.equal((await f.request('/api/public/login-links', { body: {} })).status, 401);
});

test('login throttles failures and ignores forged forwarding headers', async (t) => {
  const f = await fixture(t);
  for (let i = 0; i < 5; i++) {
    const response = await f.request('/api/login', {
      body: { code: 'wrong' },
      headers: { 'X-Forwarded-For': `192.0.2.${i}` },
    });
    assert.equal(response.status, 401);
  }
  const blocked = await f.request('/api/login', {
    body: { code: 'chenjunjie' },
    headers: { 'X-Forwarded-For': '198.51.100.1' },
  });
  assert.equal(blocked.status, 429);
  assert.equal(blocked.headers.get('retry-after'), '900');
  f.advance(15 * 60 * 1000 - 1);
  assert.equal((await f.request('/api/login', { body: { code: 'chenjunjie' } })).status, 429);
  f.advance(1);
  assert.ok(await f.login());
});

test('successful login clears failure counts and rotates the previous session', async (t) => {
  const f = await fixture(t);
  for (let i = 0; i < 4; i++)
    await f.request('/api/login', { body: { code: 'wrong' } });
  const first = await f.login();
  const second = await f.login({ Cookie: first });
  assert.notEqual(first, second);
  assert.equal((await f.request('/api/accounts', { headers: { Cookie: first } })).status, 401);
  assert.equal((await f.request('/api/accounts', { headers: { Cookie: second } })).status, 200);
  for (let i = 0; i < 5; i++)
    assert.equal((await f.request('/api/login', { body: { code: 'wrong' } })).status, 401);
});

test('session expires at the exact boundary and a restarted manager rejects old cookies', async (t) => {
  const f = await fixture(t);
  const cookie = await f.login();
  const token = getAdminRequestToken({ headers: { cookie } });
  const restarted = createAdminSessionManager();
  assert.equal(restarted.hasToken(token), false);
  f.advance(ADMIN_SESSION_TTL_MS - 1);
  assert.equal((await f.request('/api/accounts', { headers: { Cookie: cookie } })).status, 200);
  f.advance(1);
  const response = await f.request('/api/accounts', { headers: { Cookie: cookie } });
  assert.equal(response.status, 401);
  assert.match(response.headers.get('set-cookie'), /Expires=Thu, 01 Jan 1970/);
  assert.equal(f.sessions.hasToken(token), false);
});

test('logout revokes server access, clears the cookie and rejects reuse', async (t) => {
  const f = await fixture(t);
  const cookie = await f.login();
  const response = await f.request('/api/logout', { body: {}, headers: { Cookie: cookie } });
  assert.equal(response.status, 200);
  assert.match(response.headers.get('set-cookie'), /Expires=Thu, 01 Jan 1970/);
  assert.equal((await f.request('/api/accounts', { headers: { Cookie: cookie } })).status, 401);
  assert.equal((await f.request('/api/logout', { body: {}, headers: { Cookie: cookie } })).status, 401);
});

test('HTTPS proxy login uses a Secure cookie and forbids foreign-origin mutations', async (t) => {
  const f = await fixture(t);
  const httpsOrigin = f.base.replace('http:', 'https:');
  const secure = await f.request('/api/login', {
    body: { code: 'chenjunjie' },
    headers: { Origin: httpsOrigin, 'X-Forwarded-Proto': 'https' },
  });
  assert.equal(secure.status, 200);
  assert.match(secure.headers.get('set-cookie'), /Secure/);
  const cookie = secure.headers.get('set-cookie').split(';')[0];
  for (const headers of [
    { Origin: 'https://evil.example' },
    { Origin: 'null' },
    { 'Sec-Fetch-Site': 'cross-site' },
    { Origin: f.base.replace('127.0.0.1', 'localhost') },
  ]) {
    assert.equal((await f.request('/api/accounts', { body: {}, headers: { Cookie: cookie, ...headers } })).status, 403);
    assert.equal((await f.request('/api/login', { body: { code: 'chenjunjie' }, headers })).status, 403);
  }
  assert.equal((await f.request('/api/accounts', { body: {}, headers: { Cookie: cookie, Origin: f.base } })).status, 200);
});

test('malformed cookie data is rejected without throwing', () => {
  assert.equal(getAdminRequestToken({ headers: { cookie: `${ADMIN_SESSION_COOKIE}=%ZZ` } }), '');
  assert.equal(getAdminRequestToken({ headers: { cookie: 'other=value' } }), '');
  assert.equal(getAdminRequestToken({ headers: { cookie: `other=1; ${ADMIN_SESSION_COOKIE}=valid` } }), 'valid');
});

test('Socket.IO uses the same session, rejects forged tokens and disconnects revoked clients', async (t) => {
  const f = await fixture(t);
  const cookie = await f.login();
  const token = getAdminRequestToken({ headers: { cookie } });
  const middleware = createAdminSocketAuth(f.sessions.getSession);
  const socket = { data: {}, handshake: { headers: { cookie }, auth: {} } };
  let nextError;
  middleware(socket, error => nextError = error);
  assert.equal(nextError, undefined);
  assert.equal(socket.data.adminToken, token);
  assert.equal(socket.data.user.username, 'admin');
  middleware({ data: {}, handshake: { headers: {}, auth: { token: 'fake' } } }, error => nextError = error);
  assert.equal(nextError.message, 'Unauthorized');
  const disconnects = [];
  f.io.sockets.sockets.set('fixture-socket', { data: { adminToken: token }, disconnect: force => disconnects.push(force) });
  f.advance(ADMIN_SESSION_TTL_MS);
  f.sessions.cleanupInvalidAdminSessions();
  assert.deepEqual(disconnects, [true]);
  f.io.sockets.sockets.delete('fixture-socket');
  middleware(socket, error => nextError = error);
  assert.equal(nextError.message, 'Unauthorized');
});

test('websocket handshake origin cannot use an authenticated cookie from another site', () => {
  for (const [origin, expected] of [
    ['http://farm.example:3007', true],
    ['https://farm.example:3007', true],
    ['https://evil.example', false],
    ['http://farm.example:4000', false],
    ['null', false],
  ]) {
    let allowed;
    allowAdminSocketRequest({ headers: { host: 'farm.example:3007', origin } }, (_error, value) => allowed = value);
    assert.equal(allowed, expected);
  }
});
