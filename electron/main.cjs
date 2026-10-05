'use strict';

// Electron shell. It starts the embedded Express server on 127.0.0.1 (random free port) and
// shows the React app in a window. Nothing is reachable from outside this machine.

const path = require('node:path');
const { app, BrowserWindow, dialog, shell } = require('electron');

const { startServer, bootstrapIfMissing } = require('../server/index');

let mainWindow = null;
let running = null;

// One copy of the POS at a time (two copies would fight over the same database file).
if (!app.requestSingleInstanceLock()) {
  app.quit();
}
app.on('second-instance', () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  }
});

async function boot() {
  const dbPath = path.join(app.getPath('userData'), 'pos.db');
  try {
    // First launch only: create the database and load the demo data. An existing database
    // that cannot be opened is reported, never silently replaced (Req 1.6).
    const created = bootstrapIfMissing(dbPath);
    running = await startServer({ dbPath, port: 0, clientDir: path.join(__dirname, '..', 'client-dist') });
    if (created) console.log(`Created and seeded a new database at ${dbPath}`);
  } catch (e) {
    const detail = e.path ? `Database: ${e.path}\nReason: ${e.reason}` : e.message;
    dialog.showErrorBox('Restaurant POS cannot start', detail);
    app.quit();
    return;
  }

  mainWindow = new BrowserWindow({
    width: 1366,
    height: 850,
    minWidth: 1024,
    minHeight: 700,
    title: 'BCD Restaurant POS',
    autoHideMenuBar: true,
    backgroundColor: '#f8fafc',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
    },
  });

  // The app only ever talks to its own loopback server.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url) && !url.startsWith(running.url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith(running.url)) event.preventDefault();
  });

  await mainWindow.loadURL(running.url);
  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(boot);

app.on('window-all-closed', () => {
  app.quit();
});

app.on('before-quit', () => {
  if (running) {
    const r = running;
    running = null;
    r.close().catch(() => {});
  }
});
