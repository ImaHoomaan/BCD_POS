'use strict';

// SQL for users, sessions and login throttling. All statements use bound parameters.

function findUserByUsername(db, username) {
  return db.prepare('SELECT id, username, role, password_hash AS passwordHash FROM users WHERE username = ?').get(username);
}

function findUserById(db, id) {
  return db.prepare('SELECT id, username, role FROM users WHERE id = ?').get(id);
}

function listCashiers(db) {
  return db.prepare("SELECT id, username FROM users WHERE role = 'cashier' ORDER BY username COLLATE NOCASE").all();
}

function insertSession(db, { token, userId, now, csrfToken, draftJson }) {
  db.prepare(
    'INSERT INTO sessions (token, user_id, created_at, last_activity, csrf_token, draft_json) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(token, userId, now, now, csrfToken, draftJson);
}

// Role and username come from the users table on every request, never from the cookie.
function getSession(db, token) {
  return db
    .prepare(
      `SELECT s.token, s.user_id AS userId, s.last_activity AS lastActivity, s.csrf_token AS csrfToken,
              s.draft_json AS draftJson, u.username, u.role
         FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ?`
    )
    .get(token);
}

function touchSession(db, token, now) {
  db.prepare('UPDATE sessions SET last_activity = ? WHERE token = ?').run(now, token);
}

function saveDraft(db, token, draftJson) {
  db.prepare('UPDATE sessions SET draft_json = ? WHERE token = ?').run(draftJson, token);
}

function deleteSession(db, token) {
  db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
}

function getAttempt(db, key) {
  return db.prepare('SELECT username_key AS usernameKey, failed_count AS failedCount, locked_until AS lockedUntil FROM login_attempts WHERE username_key = ?').get(key);
}

function saveAttempt(db, key, failedCount, lockedUntil) {
  db.prepare(
    `INSERT INTO login_attempts (username_key, failed_count, locked_until) VALUES (?, ?, ?)
     ON CONFLICT(username_key) DO UPDATE SET failed_count = excluded.failed_count, locked_until = excluded.locked_until`
  ).run(key, failedCount, lockedUntil);
}

function clearAttempt(db, key) {
  db.prepare('DELETE FROM login_attempts WHERE username_key = ?').run(key);
}

module.exports = {
  findUserByUsername,
  findUserById,
  listCashiers,
  insertSession,
  getSession,
  touchSession,
  saveDraft,
  deleteSession,
  getAttempt,
  saveAttempt,
  clearAttempt,
};
