'use strict';

const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const { systemClock } = require('./lib/clock');
const { createHttp } = require('./http/middleware');
const { NAV_ITEMS, can, homePathFor } = require('./auth/rbac');
const { NotFound } = require('./lib/errors');
const { newDraft, serializeDraft } = require('./terminal/order');

const authRoutes = require('./auth/routes');
const terminalRoutes = require('./terminal/routes');
const menuRoutes = require('./menu/routes');
const inventoryRoutes = require('./inventory/routes');
const dashboardRoutes = require('./dashboard/routes');

const CONFIG = Object.freeze({ currency: '$' });

const ACCESS_DENIED_HTML = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<title>Access denied</title><meta name="viewport" content="width=device-width, initial-scale=1">
<style>body{font-family:system-ui,sans-serif;background:#f8fafc;color:#0f172a;display:grid;place-items:center;min-height:100vh;margin:0}
main{max-width:28rem;padding:2rem;background:#fff;border:1px solid #e2e8f0;border-radius:.75rem;text-align:center}
a{color:#1d4ed8}</style></head><body><main role="alert"><h1>Access denied</h1>
<p>Your account does not have permission to open this screen.</p><p><a href="/">Back to your home screen</a></p></main></body></html>`;

// Builds the Express app. Nothing here touches the network beyond the loopback listener.
//   db        an open better-sqlite3 connection
//   clock     injectable time source
//   clientDir folder containing the built React app (index.html + assets)
function createApp({ db, clock = systemClock, clientDir } = {}) {
  const app = express();
  app.disable('x-powered-by');

  const http = createHttp({ db, clock });
  const ctx = { db, clock, http };

  app.use((req, res, next) => {
    res.set({
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'Referrer-Policy': 'no-referrer',
      // Everything is served from this origin: no CDN, no remote fonts, no remote scripts.
      'Content-Security-Policy':
        "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; frame-ancestors 'none'",
      'Cache-Control': req.path.startsWith('/api/') ? 'no-store' : 'no-cache',
    });
    next();
  });

  app.use(express.json({ limit: '100kb' }));
  app.use(http.originGuard);
  app.use(http.attachSession);
  app.use(http.csrfGuard);

  app.get('/api/health', (req, res) => res.json({ ok: true }));
  app.use('/api/auth', authRoutes({ ...ctx, newDraftJson: () => serializeDraft(newDraft()), config: CONFIG }));
  app.use('/api/terminal', terminalRoutes(ctx));
  app.use('/api/menu', menuRoutes(ctx));
  app.use('/api', inventoryRoutes(ctx));
  app.use('/api/dashboard', dashboardRoutes(ctx));
  app.use('/api', () => {
    throw new NotFound('Unknown API endpoint.');
  });

  // ---- static client + screen protection ----------------------------------------------
  const indexFile = clientDir ? path.join(clientDir, 'index.html') : null;
  const hasClient = !!indexFile && fs.existsSync(indexFile);
  if (hasClient) app.use(express.static(clientDir, { index: false }));

  const screens = new Map(NAV_ITEMS.map((n) => [n.path, n]));

  // Direct URL requests for a screen are checked on the SERVER before any app content is
  // sent (Req 4.3, 4.6, 4.7): no session -> login; wrong role -> an access-denied page.
  app.use((req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next();
    const screen = screens.get(req.path.replace(/\/+$/, '') || '/');
    if (req.path === '/') {
      return res.redirect(req.principal ? homePathFor(req.principal.role) : '/login');
    }
    if (screen) {
      if (!req.principal) return res.redirect('/login');
      if (!can(req.principal, screen.permission)) return res.status(403).type('html').send(ACCESS_DENIED_HTML);
    }
    if (!hasClient) {
      return res.status(503).type('text').send('The user interface has not been built. Run "npm run build" first.');
    }
    return res.sendFile(indexFile);
  });

  app.use(http.errorHandler);
  return app;
}

module.exports = { createApp, CONFIG };
