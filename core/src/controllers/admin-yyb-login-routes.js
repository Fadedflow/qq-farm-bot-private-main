const fetch = require('node-fetch');

const YYB_GO_BASE = process.env.YYB_GO_URL || 'http://127.0.0.1:8000';

function registerAdminYybLoginRoutes({ app, logger }) {
  const log = (msg, meta) => {
    if (logger && typeof logger.info === 'function') logger.info(msg, meta);
  };

  app.post('/api/yyb-qr/create', async (_req, res) => {
    try {
      const resp = await fetch(`${YYB_GO_BASE}/qr?as_base64=true`, { method: 'POST' });
      const data = await resp.json();
      res.json(data);
    } catch (err) {
      log('yyb-qr-create failed', { error: err.message });
      res.status(502).json({ ok: false, error: 'yyb_go 服务不可用: ' + err.message });
    }
  });

  app.post('/api/yyb-qr/poll', async (req, res) => {
    const { session_id } = (req.body || {});
    if (!session_id) return res.status(400).json({ ok: false, error: '缺少 session_id' });

    try {
      const resp = await fetch(`${YYB_GO_BASE}/qr/${encodeURIComponent(session_id)}/poll`);
      const data = await resp.json();
      res.json(data);
    } catch (err) {
      res.status(502).json({ ok: false, error: 'yyb_go 服务不可用: ' + err.message });
    }
  });

  app.post('/api/yyb-qr/confirm', async (req, res) => {
    const { session_id } = (req.body || {});
    if (!session_id) return res.status(400).json({ ok: false, error: '缺少 session_id' });

    try {
      const resp = await fetch(`${YYB_GO_BASE}/qr/${encodeURIComponent(session_id)}/confirm`, { method: 'POST' });
      const data = await resp.json();
      res.json(data);
    } catch (err) {
      res.status(502).json({ ok: false, error: 'yyb_go 服务不可用: ' + err.message });
    }
  });

  app.post('/api/yyb-qr/get-code', async (req, res) => {
    const { ref, app_id } = (req.body || {});
    if (!ref) return res.status(400).json({ ok: false, error: '缺少 ref' });
    if (!app_id) return res.status(400).json({ ok: false, error: '缺少 app_id' });

    try {
      const resp = await fetch(`${YYB_GO_BASE}/wxapp/getCode`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ref, app_id }),
      });
      const data = await resp.json();
      res.json(data);
    } catch (err) {
      res.status(502).json({ ok: false, error: 'yyb_go 服务不可用: ' + err.message });
    }
  });
}

module.exports = { registerAdminYybLoginRoutes };
