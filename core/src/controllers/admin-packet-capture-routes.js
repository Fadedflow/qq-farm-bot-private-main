function registerAdminPacketCaptureRoutes({ app, requireAdminToken }) {
  let _enabled = false;

  app.get('/api/admin/packet-capture/status', requireAdminToken, (_req, res) => {
    try {
      const { getMasterPacketCaptureEntries } = require('../runtime/worker-manager');
      const entries = getMasterPacketCaptureEntries();
      const MAX_ENTRIES = 2000;
      res.json({
        ok: true,
        enabled: _enabled,
        entryCount: entries.length,
        maxEntries: MAX_ENTRIES,
      });
    } catch (e) {
      res.json({
        ok: true,
        enabled: false,
        entryCount: 0,
        maxEntries: 2000,
      });
    }
  });

  app.post('/api/admin/packet-capture/enable', requireAdminToken, (_req, res) => {
    _enabled = true;
    res.json({ ok: true, enabled: true });
  });

  app.post('/api/admin/packet-capture/disable', requireAdminToken, (_req, res) => {
    _enabled = false;
    res.json({ ok: true, enabled: false });
  });

  app.get('/api/admin/packet-capture/entries', requireAdminToken, (req, res) => {
    try {
      const { getMasterPacketCaptureEntries } = require('../runtime/worker-manager');
      const entries = getMasterPacketCaptureEntries();
      const limit = Math.min(Number(req.query.limit) || 100, 500);
      const offset = Math.max(Number(req.query.offset) || 0, 0);
      const sliced = entries.slice(offset, offset + limit);
      res.json({
        ok: true,
        enabled: _enabled,
        entries: sliced,
        total: entries.length,
        offset,
        limit,
      });
    } catch (e) {
      res.json({ ok: false, error: e.message });
    }
  });

  app.post('/api/admin/packet-capture/clear', requireAdminToken, (_req, res) => {
    try {
      const { clearMasterPacketCaptureEntries } = require('../runtime/worker-manager');
      clearMasterPacketCaptureEntries();
      res.json({ ok: true });
    } catch (e) {
      res.json({ ok: false, error: e.message });
    }
  });
}

module.exports = { registerAdminPacketCaptureRoutes };
