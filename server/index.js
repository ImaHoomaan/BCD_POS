'use strict';

const path = require('node:path');
const fs = require('node:fs');
const { createApp } = require('./app');
const { verifyDatabase, openDatabase } = require('./db/connection');
const { initDatabase } = require('./db/init');
const { seedDatabase } = require('./db/seed');
const { hashPassword } = require('./auth/passwords');

const HOST = '127.0.0.1'; // loopback only: the POS is never exposed to the network

function defaultDbPath() {
  return process.env.POS_DB_PATH || path.join(__dirname, '..', 'data', 'pos.db');
}

function defaultClientDir() {
  return path.join(__dirname, '..', 'client-dist');
}

// Verifies the database (Req 1.6) then starts the HTTP server on the loopback interface.
// Throws DatabaseStartupError (with the path and reason) if the database cannot be used.
function startServer({ dbPath = defaultDbPath(), port = 0, clientDir = defaultClientDir(), clock } = {}) {
  verifyDatabase(dbPath);
  const db = openDatabase(dbPath);
  const app = createApp({ db, clientDir, clock });
  return new Promise((resolve, reject) => {
    const server = app.listen(port, HOST, () => {
      resolve({
        server,
        db,
        port: server.address().port,
        url: `http://${HOST}:${server.address().port}`,
        close: () =>
          new Promise((done) => {
            server.close(() => {
              db.close();
              done();
            });
            server.closeAllConnections?.();
          }),
      });
    });
    server.on('error', (e) => {
      db.close();
      reject(e);
    });
  });
}

// First-run bootstrap used by the installed desktop app: if (and only if) the database file
// does not exist, create it and load the demo data. An existing but unreadable file is NOT
// touched; startServer will report it (Req 1.6).
function bootstrapIfMissing(dbPath) {
  if (fs.existsSync(dbPath)) return false;
  initDatabase(dbPath);
  const db = openDatabase(dbPath);
  try {
    seedDatabase(db, { now: new Date(), hashPassword });
  } finally {
    db.close();
  }
  return true;
}

module.exports = { HOST, defaultDbPath, startServer, bootstrapIfMissing };
