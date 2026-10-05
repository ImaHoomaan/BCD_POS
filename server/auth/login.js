'use strict';

const users = require('../db/repos/users');
const { write } = require('../db/connection');
const { formatLocal, parseLocal } = require('../lib/clock');
const { ValidationError, AuthFailed, LoginLocked, LoginUnavailable } = require('../lib/errors');
const { verifyPassword, dummyVerify } = require('./passwords');
const { createSession, endSession } = require('./sessions');

const MAX_FAILURES = 5;
const LOCK_MS = 5 * 60 * 1000;

// Throttling is keyed by the normalized username so unknown usernames are throttled exactly
// like real ones (Req 3.6).
const keyOf = (username) => username.trim().toLowerCase();

// Returns { token, csrfToken, user }. Throws:
//   ValidationError   empty field (not counted as a failed attempt, Req 3.11)
//   LoginLocked       5 consecutive failures within the lock window
//   AuthFailed        one generic message for wrong username or password (Req 3.5)
//   LoginUnavailable  internal failure while verifying (not counted, Req 3.12)
function login(db, { username, password, draftJson }, now) {
  const uname = typeof username === 'string' ? username.trim() : '';
  const pw = typeof password === 'string' ? password : '';
  const missing = {};
  if (!uname) missing.username = 'Username is required.';
  if (!pw) missing.password = 'Password is required.';
  if (Object.keys(missing).length) throw new ValidationError(missing);

  const key = keyOf(uname);
  let failedCount = 0;
  try {
    const attempt = users.getAttempt(db, key);
    if (attempt) {
      const until = attempt.lockedUntil ? parseLocal(attempt.lockedUntil) : null;
      if (until && now < until) throw new LoginLocked(attempt.lockedUntil); // rejects even a correct password
      // A lock that has expired resets the count to 0.
      failedCount = until ? 0 : attempt.failedCount;
    }

    const user = users.findUserByUsername(db, uname);
    const ok = user ? verifyPassword(pw, user.passwordHash) : dummyVerify(pw);

    if (ok) {
      write(db, () => users.clearAttempt(db, key));
      const { token, csrfToken } = createSession(db, user.id, now, draftJson);
      return { token, csrfToken, user: { id: user.id, username: user.username, role: user.role } };
    }

    failedCount += 1;
    const lockedUntil = failedCount >= MAX_FAILURES ? formatLocal(new Date(now.getTime() + LOCK_MS)) : null;
    write(db, () => users.saveAttempt(db, key, failedCount, lockedUntil));
  } catch (e) {
    if (e instanceof LoginLocked) throw e;
    throw new LoginUnavailable(); // any internal failure: no session, not counted
  }
  throw new AuthFailed();
}

function logout(db, token) {
  endSession(db, token);
}

module.exports = { MAX_FAILURES, LOCK_MS, login, logout };
