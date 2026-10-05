#!/usr/bin/env node
'use strict';

// Commands (Req 19.2):
//   node server/cli.js init-db   create the schema          (npm run init-db)
//   node server/cli.js seed-db   load demo data              (npm run seed-db)
//   node server/cli.js run       start the server            (npm run start:server)
// Options: --db <file>  --port <n>
// Exit codes: 0 success, 1 command failed, 2 database could not be opened at startup.

const { initDatabase } = require('./db/init');
const { seedDatabase } = require('./db/seed');
const { openDatabase } = require('./db/connection');
const { hashPassword } = require('./auth/passwords');
const { startServer, defaultDbPath } = require('./index');

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

async function main() {
  const command = process.argv[2];
  const dbPath = arg('db', defaultDbPath());

  if (command === 'init-db') {
    try {
      const r = initDatabase(dbPath);
      console.log(`init-db: OK. ${r.created ? 'Created' : 'Verified existing'} database at ${dbPath}`);
    } catch (e) {
      console.error(`init-db FAILED: ${e.message}`);
      process.exit(1);
    }
    return;
  }

  if (command === 'seed-db') {
    let db;
    try {
      db = openDatabase(dbPath);
      seedDatabase(db, { now: new Date(), hashPassword });
      console.log(`seed-db: OK. Demo data loaded into ${dbPath}`);
      console.log('Accounts: see docs/README.md for the seeded usernames and passwords.');
    } catch (e) {
      console.error(`seed-db FAILED: ${e.message}`);
      process.exit(1);
    } finally {
      if (db) db.close();
    }
    return;
  }

  if (command === 'run') {
    try {
      const port = Number(arg('port', process.env.PORT || 5000));
      const s = await startServer({ dbPath, port });
      console.log(`Restaurant POS running at ${s.url}  (database: ${dbPath})`);
      const stop = () => s.close().then(() => process.exit(0));
      process.on('SIGINT', stop);
      process.on('SIGTERM', stop);
    } catch (e) {
      if (e.name === 'DatabaseStartupError') {
        console.error(`Cannot start: ${e.message}`);
        process.exit(2);
      }
      console.error(`Cannot start: ${e.message}`);
      process.exit(1);
    }
    return;
  }

  console.error('Usage: node server/cli.js <init-db | seed-db | run> [--db file] [--port n]');
  process.exit(1);
}

main();
