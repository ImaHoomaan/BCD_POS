'use strict';

const fs = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3');
const { SCHEMA_VERSION, SCHEMA_PATH } = require('./connection');

function removeFiles(file) {
  for (const suffix of ['', '-wal', '-shm', '-journal']) {
    try {
      fs.rmSync(file + suffix, { force: true });
    } catch {
      /* best effort */
    }
  }
}

// Creates all tables and constraints inside one transaction (SQLite DDL is transactional).
// - Re-running against an initialized database changes no rows (Req 1.5).
// - On any failure the transaction rolls back, and if this run created the file it is
//   deleted, so none of the run's objects remain (Req 1.7).
// hooks.beforeCommit is a test seam for failure injection.
function initDatabase(file, hooks = {}) {
  const existed = fs.existsSync(file);
  fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
  let db;
  try {
    db = new Database(file);
    db.pragma('foreign_keys = ON');
    db.pragma('busy_timeout = 5000');
    db.pragma('journal_mode = WAL');
    db.exec('BEGIN IMMEDIATE');
    try {
      db.exec(require('node:fs').readFileSync(SCHEMA_PATH, 'utf8'));
      const row = db.prepare('SELECT version FROM schema_meta LIMIT 1').get();
      if (!row) {
        db.prepare('INSERT INTO schema_meta (version) VALUES (?)').run(SCHEMA_VERSION);
      } else if (row.version !== SCHEMA_VERSION) {
        throw new Error(`existing schema version ${row.version} is not supported (expected ${SCHEMA_VERSION})`);
      }
      if (hooks.beforeCommit) hooks.beforeCommit(db);
      db.exec('COMMIT');
    } catch (e) {
      if (db.inTransaction) db.exec('ROLLBACK');
      throw e;
    }
    db.close();
    return { created: !existed, path: file };
  } catch (e) {
    try {
      if (db && db.open) db.close();
    } catch {
      /* ignore */
    }
    if (!existed) removeFiles(file);
    throw e;
  }
}

module.exports = { initDatabase };
