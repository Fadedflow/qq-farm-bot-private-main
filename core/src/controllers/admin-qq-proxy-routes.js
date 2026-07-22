function registerAdminQQProxyRoutes({ app, requireAdminToken }) {
  const qqProxy = require('../services/qq-proxy-capture');

  app.get('/api/admin/qq-proxy/status', requireAdminToken, (_req, res) => {
    try {
      res.json({ ok: true, data: qqProxy.getStatus() });
    } catch (e) {
      res.json({ ok: false, error: e.message });
    }
  });

  app.post('/api/admin/qq-proxy/start', requireAdminToken, (_req, res) => {
    qqProxy.startProxy((err, port) => {
      if (err) {
        return res.json({ ok: false, error: err.message });
      }
      res.json({ ok: true, data: qqProxy.getStatus() });
    });
  });

  app.post('/api/admin/qq-proxy/stop', requireAdminToken, (_req, res) => {
    qqProxy.stopProxy();
    res.json({ ok: true, data: qqProxy.getStatus() });
  });

  app.get('/api/admin/qq-proxy/codes', requireAdminToken, (_req, res) => {
    try {
      const codes = qqProxy.getCapturedCodes();
      res.json({ ok: true, data: { codes, count: codes.length } });
    } catch (e) {
      res.json({ ok: false, error: e.message });
    }
  });

  app.post('/api/admin/qq-proxy/codes/clear', requireAdminToken, (_req, res) => {
    qqProxy.clearCodes();
    res.json({ ok: true });
  });

  app.get('/api/admin/qq-proxy/cert', (_req, res) => {
    try {
      const cert = qqProxy.getCACert();
      res.setHeader('Content-Type', 'application/x-x509-ca-cert');
      res.setHeader('Content-Length', Buffer.byteLength(cert, 'utf8'));
      res.send(cert);
    } catch (e) {
      res.json({ ok: false, error: e.message });
    }
  });
}

module.exports = { registerAdminQQProxyRoutes };
