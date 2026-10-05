const path = require('node:path');
const { getAdminRequestToken } = require('./admin-session-manager');

const PUBLIC_GET_PATHS = new Set(['/health', '/public/login-links']);

function registerAuthGate(app, requireAdminToken) {
  app.use('/api', (req, res, next) => {
    if ((req.method === 'POST' && req.path === '/login')
      || (['GET', 'HEAD'].includes(req.method) && (PUBLIC_GET_PATHS.has(req.path)
        || /^\/public\/capture-certificate\/[^/]+\/[^/]+$/.test(req.path))))
      return next();
    return requireAdminToken(req, res, next);
  });
  app.use('/game-config', requireAdminToken);
}

function rejectCrossOriginMutation(req, res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method))
    return next();
  if (req.headers['sec-fetch-site'] === 'cross-site')
    return res.status(403).json({ ok: false, error: 'Cross-origin request denied' });
  const origin = req.headers.origin;
  if (origin) {
    try {
      const url = new URL(origin);
      if (url.origin !== `${req.protocol}://${req.get('host')}`)
        return res.status(403).json({ ok: false, error: 'Cross-origin request denied' });
    }
    catch {
      return res.status(403).json({ ok: false, error: 'Cross-origin request denied' });
    }
  }
  return next();
}

function registerDocumentAuthGate(app, hasToken) {
  app.use((req, res, next) => {
    if (req.method !== 'GET' || req.path === '/login'
      || req.path.startsWith('/api/') || req.path.startsWith('/game-config/')
      || path.extname(req.path) || !String(req.headers.accept || '').includes('text/html'))
      return next();
    if (hasToken(getAdminRequestToken(req)))
      return next();
    res.setHeader('Cache-Control', 'no-store');
    return res.redirect(302, `/login?redirect=${encodeURIComponent(req.originalUrl)}`);
  });
}

function allowAdminSocketRequest(req, callback) {
  const origin = req.headers.origin;
  if (!origin)
    return callback(null, true);
  try {
    const url = new URL(origin);
    return callback(null, ['http:', 'https:'].includes(url.protocol) && url.host === req.headers.host);
  }
  catch {
    return callback(null, false);
  }
}

function createAdminSocketAuth(getSession) {
  return (socket, next) => {
    const token = socket.handshake.auth?.token || getAdminRequestToken(socket.handshake);
    const user = typeof token === 'string' ? getSession(token) : null;
    if (!user)
      return next(new Error('Unauthorized'));
    socket.data.adminToken = token;
    socket.data.user = user;
    return next();
  };
}

module.exports = {
  allowAdminSocketRequest,
  createAdminSocketAuth,
  registerAuthGate,
  registerDocumentAuthGate,
  rejectCrossOriginMutation,
};
