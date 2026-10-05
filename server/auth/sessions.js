'use strict';

const crypto = require('node:crypto');
const users = require('../db/repos/users');
const { write } = require('../db/connection');
const { formatLocal, parseLocal } = require('../lib/clock');

const IDLE_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes without user activity (Req 3.9)

function createSession(db, userId, now, draftJson) {
  const token = crypto.randomBytes(32).toString('hex');
  const csrfToken = crypto.randomBytes(24).toString('hex');
  write(db, () => users.insertSession(db, { token, userId, now: formatLocal(now), csrfToken, draftJson }));
  return { token, csrfToken };
}

// Resolves a cookie token to a principal. The role is read from the users table on every
// call, never trusted from the client. Returns:
//   { principal, csrfToken, draftJson }   valid session
//   { expired: true }                     idle for 30 minutes or more (session is deleted)
//   null                                  unknown / missing token
// touch=false is used for background polling, which must not keep an abandoned session alive.
function resolveSession(db, token, now, { touch = true } = {}) {
  if (!token || typeof token !== 'string') return null;
  const row = users.getSession(db, token);
  if (!row) return null;
  const last = parseLocal(row.lastActivity);
  if (!last || now.getTime() - last.getTime() >= IDLE_TIMEOUT_MS) {
    write(db, () => users.deleteSession(db, token));
    return { expired: true };
  }
  if (touch) write(db, () => users.touchSession(db, token, formatLocal(now)));
  return {
    principal: { userId: row.userId, username: row.username, role: row.role },
    csrfToken: row.csrfToken,
    draftJson: row.draftJson,
    token,
  };
}

function endSession(db, token) {
  if (token) write(db, () => users.deleteSession(db, token));
}

module.exports = { IDLE_TIMEOUT_MS, createSession, resolveSession, endSession };
