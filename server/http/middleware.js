'use strict';

const crypto = require('node:crypto');
const { authorize } = require('../auth/rbac');
const { resolveSession } = require('../auth/sessions');
const { PosError, Unauthenticated, PermissionDenied, NotFound } = require('../lib/errors');

const COOKIE_NAME = 'pos_session';

function parseCookies(header) {
  const out = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

const cookieOptions = { httpOnly: true, sameSite: 'strict', path: '/' };

function createHttp({ db, clock }) {
  // Resolves the cookie to a principal. The role always comes from the database.
  // Requests flagged X-Background: 1 (polling) must NOT extend the idle timer (Req 3.9).
  function attachSession(req, res, next) {
    const token = parseCookies(req.headers.cookie)[COOKIE_NAME];
    const background = req.get('x-background') === '1';
    const resolved = resolveSession(db, token, clock(), { touch: !background });
    if (resolved && resolved.expired) {
      res.clearCookie(COOKIE_NAME, cookieOptions);
      req.sessionExpired = true;
    } else if (resolved) {
      req.principal = resolved.principal;
      req.session = resolved;
    }
    next();
  }

  // Server-side permission check for a route, independent of what the UI displays.
  const requires = (permission) => (req, res, next) => {
    if (!req.principal) {
      throw req.sessionExpired
        ? new Unauthenticated('Your session expired. Please sign in again.', 'session_expired')
        : new Unauthenticated();
    }
    authorize(req.principal, permission);
    next();
  };

  const requireSession = (req, res, next) => {
    if (!req.principal) {
      throw req.sessionExpired
        ? new Unauthenticated('Your session expired. Please sign in again.', 'session_expired')
        : new Unauthenticated();
    }
    next();
  };

  const UNSAFE = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

  // Reject cross-origin state changes.
  function originGuard(req, res, next) {
    const origin = req.get('origin');
    if (UNSAFE.has(req.method) && origin) {
      let host = '';
      try {
        host = new URL(origin).host;
      } catch {
        /* falls through to rejection */
      }
      if (host !== req.get('host')) throw new PermissionDenied('Cross-origin request rejected.');
    }
    next();
  }

  // CSRF token for every state-changing request made inside a session. Login has no
  // session yet, so it is exempt.
  function csrfGuard(req, res, next) {
    if (UNSAFE.has(req.method) && req.session && req.path !== '/api/auth/login') {
      const sent = Buffer.from(String(req.get('x-csrf-token') || ''));
      const want = Buffer.from(req.session.csrfToken);
      if (sent.length !== want.length || !crypto.timingSafeEqual(sent, want)) {
        throw new PermissionDenied('Invalid or missing CSRF token.');
      }
    }
    next();
  }

  function errorHandler(err, req, res, next) {
    if (res.headersSent) return next(err);
    if (err instanceof PosError) return res.status(err.status).json(err.toJSON());
    if (err && err.type === 'entity.parse.failed') {
      return res.status(400).json({ error: { code: 'bad_json', message: 'The request body is not valid JSON.' } });
    }
    if (err && typeof err.code === 'string' && err.code.startsWith('SQLITE')) {
      console.error('[db]', err.message);
      return res.status(500).json({ error: { code: 'storage', message: 'The operation failed and no data was changed.' } });
    }
    console.error('[server]', err);
    return res.status(500).json({ error: { code: 'internal', message: 'Something went wrong.' } });
  }

  return { attachSession, requires, requireSession, originGuard, csrfGuard, errorHandler };
}

// Route helper: parse a positive integer id from a URL parameter.
function toId(value) {
  if (!/^\d{1,12}$/.test(String(value))) throw new NotFound();
  return Number(value);
}

module.exports = { COOKIE_NAME, cookieOptions, parseCookies, createHttp, toId };
