'use strict';

const fs = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3');
const { PosError, StorageError, DatabaseStartupError } = require('../lib/errors');

const SCHEMA_VERSION = 1;
const SCHEMA_PATH = path.join(__dirname, 'schema.sql');

function applyPragmas(db, { wal = true } = {}) {
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  if (wal) db.pragma('journal_mode = WAL');
}

// Opens an existing database file (never creates one; see initDatabase for that).
function openDatabase(file, { readonly = false } = {}) {
  const db = new Database(file, { readonly, fileMustExist: true });
  applyPragmas(db, { wal: !readonly });
  return db;
}

// In-memory database with the schema applied, for tests and tooling.
function openMemoryDatabase() {
  const db = new Database(':memory:');
  applyPragmas(db, { wal: false });
  db.exec(fs.readFileSync(SCHEMA_PATH, 'utf8'));
  db.prepare('INSERT INTO schema_meta (version) VALUES (?)').run(SCHEMA_VERSION);
  return db;
}

// Startup check (Req 1.6). Opens the file read-only, so it can never modify it, and
// confirms it is a valid, initialized database. Throws DatabaseStartupError(path, reason).
function verifyDatabase(file) {
  let db;
  try {
    if (!fs.existsSync(file)) throw new Error('the database file does not exist (run init-db first)');
    db = new Database(file, { readonly: true, fileMustExist: true });
    const check = db.pragma('quick_check', { simple: true });
    if (check !== 'ok') throw new Error(`integrity check failed: ${check}`);
    const row = db.prepare('SELECT version FROM schema_meta LIMIT 1').get();
    if (!row) throw new Error('the database has not been initialized (schema_meta is empty)');
    if (row.version !== SCHEMA_VERSION) {
      throw new Error(`unsupported schema version ${row.version} (expected ${SCHEMA_VERSION})`);
    }
  } catch (e) {
    throw new DatabaseStartupError(file, e.message);
  } finally {
    if (db) db.close();
  }
}

// Runs fn inside BEGIN IMMEDIATE ... COMMIT. SQLite has exactly one writer at a time, so
// overlapping writers are serialized and each sees the previous one's committed state
// (Req 7.9). Any exception rolls everything back; driver errors become StorageError so
// the UI never sees raw SQLite messages (Req 7.6).
function write(db, fn) {
  try {
    return db.transaction(fn).immediate();
  } catch (e) {
    if (e instanceof PosError) throw e;
    if (e && typeof e.code === 'string' && e.code.startsWith('SQLITE')) throw new StorageError(undefined, e);
    throw e;
  }
}

function dumpDatabase(db, { exclude = [] } = {}) {
  // Deterministic text dump used by tests to assert "database unchanged".
  const tables = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
    .all();
  const out = {};
  for (const { name } of tables) {
    if (exclude.includes(name)) continue;
    out[name] = db.prepare(`SELECT * FROM "${name}" ORDER BY rowid`).all();
  }
  return JSON.stringify(out);
}

module.exports = {
  SCHEMA_VERSION,
  SCHEMA_PATH,
  openDatabase,
  openMemoryDatabase,
  verifyDatabase,
  write,
  dumpDatabase,
};
