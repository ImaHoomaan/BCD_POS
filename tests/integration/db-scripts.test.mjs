import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import fc from 'fast-check';
import Database from 'better-sqlite3';

const require = createRequire(import.meta.url);
const { initDatabase } = require('../../server/db/init');
const { seedDatabase } = require('../../server/db/seed');
const { openDatabase, openMemoryDatabase, verifyDatabase, dumpDatabase } = require('../../server/db/connection');
const { availabilityMap } = require('../../server/inventory/availability');
const { formatLocal } = require('../../server/lib/clock');
const { DatabaseStartupError } = require('../../server/lib/errors');
const { fastHash } = require('../helpers');

const ROOT = path.resolve(import.meta.dirname, '..', '..');
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'pos-db-'));
const cleanup = (dir) => fs.rmSync(dir, { recursive: true, force: true });

const TABLES = ['users', 'categories', 'dishes', 'ingredients', 'recipe_items', 'transactions', 'order_lines', 'settings'];
const counts = (db) => Object.fromEntries(TABLES.map((t) => [t, db.prepare(`SELECT COUNT(*) c FROM ${t}`).get().c]));

describe('init-db', () => {
  // Feature: restaurant-pos-system, Property 27: Initialization is idempotent
  it('leaves every existing row untouched when run again', () => {
    fc.assert(
      fc.property(fc.uniqueArray(fc.string({ minLength: 1, maxLength: 20 }).filter((s) => s.trim().length > 0), { maxLength: 8, selector: (s) => s.toLowerCase() }), (names) => {
        const dir = tmp();
        try {
          const file = path.join(dir, 'pos.db');
          initDatabase(file);
          const db = openDatabase(file);
          for (const n of names) db.prepare('INSERT INTO categories (name) VALUES (?)').run(n.slice(0, 50));
          const before = dumpDatabase(db);
          db.close();

          const again = initDatabase(file); // reports success, changes nothing
          expect(again.created).toBe(false);
          const db2 = openDatabase(file);
          expect(dumpDatabase(db2)).toBe(before);
          db2.close();
        } finally {
          cleanup(dir);
        }
      }),
      { numRuns: 15 }
    );
  });

  // Feature: restaurant-pos-system, Property 29 (init half): failures leave no partial state
  it('rolls back and removes the file it created when it fails', () => {
    const dir = tmp();
    try {
      const file = path.join(dir, 'pos.db');
      expect(() => initDatabase(file, { beforeCommit: () => { throw new Error('disk exploded'); } })).toThrow('disk exploded');
      expect(fs.existsSync(file)).toBe(false);
    } finally {
      cleanup(dir);
    }
  });

  it('keeps an existing database unchanged when a re-run fails', () => {
    const dir = tmp();
    try {
      const file = path.join(dir, 'pos.db');
      initDatabase(file);
      const db = openDatabase(file);
      db.prepare("INSERT INTO categories (name) VALUES ('Keep me')").run();
      const before = dumpDatabase(db);
      db.close();
      expect(() => initDatabase(file, { beforeCommit: () => { throw new Error('boom'); } })).toThrow('boom');
      const db2 = openDatabase(file);
      expect(dumpDatabase(db2)).toBe(before);
      db2.close();
    } finally {
      cleanup(dir);
    }
  });
});

describe('seed-db', () => {
  const seedOpts = (now) => ({ now, hashPassword: fastHash });

  // Feature: restaurant-pos-system, Property 28: Seeding is idempotent and satisfies the seed invariants
  it('is idempotent and produces valid demo data for any date', () => {
    fc.assert(
      fc.property(fc.date({ min: new Date(2021, 0, 5), max: new Date(2033, 11, 25) }), fc.integer({ min: 1, max: 3 }), (now, runs) => {
        const db = openMemoryDatabase();
        seedDatabase(db, seedOpts(now));
        const first = counts(db);
        for (let i = 1; i < runs; i++) seedDatabase(db, seedOpts(now));
        expect(counts(db)).toEqual(first);

        // accounts
        const u = db.prepare('SELECT username, role, password_hash h FROM users ORDER BY username').all();
        expect(u.filter((x) => x.role === 'owner')).toHaveLength(1);
        expect(u.filter((x) => x.role === 'cashier').map((x) => x.username)).toEqual(['Cashier 1', 'Cashier 2', 'Cashier 3']);
        for (const x of u) expect(x.h.startsWith('scrypt$')).toBe(true);

        // menu
        expect(first.categories).toBeGreaterThanOrEqual(3);
        expect(first.dishes).toBeGreaterThanOrEqual(10);
        expect(first.ingredients).toBeGreaterThanOrEqual(15);
        const noRecipe = db.prepare('SELECT COUNT(*) c FROM dishes d WHERE NOT EXISTS (SELECT 1 FROM recipe_items r WHERE r.dish_id = d.id AND r.qty_milli > 0)').get().c;
        expect(noRecipe).toBe(0);

        // history
        expect(first.transactions).toBeGreaterThanOrEqual(20);
        expect(first.transactions).toBeLessThanOrEqual(200);
        const earliest = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 30, now.getHours(), now.getMinutes(), now.getSeconds());
        for (const t of db.prepare('SELECT created_at c FROM transactions').all()) {
          expect(t.c >= formatLocal(earliest)).toBe(true);
          expect(t.c <= formatLocal(now)).toBe(true);
        }
        const perCashier = db.prepare('SELECT cashier_id, COUNT(*) c FROM transactions GROUP BY cashier_id').all();
        expect(perCashier).toHaveLength(3);

        // availability
        const { map } = availabilityMap(db);
        const states = db.prepare('SELECT id FROM dishes').all().map((d) => (map.get(d.id) || { available: false }).available);
        expect(states).toContain(true);
        expect(states).toContain(false);
        db.close();
      }),
      { numRuns: 25 }
    );
  });

  // Feature: restaurant-pos-system, Property 29 (seed half): failures leave no partial state
  it('rolls back everything when any step fails', () => {
    for (const step of ['users', 'categories', 'ingredients', 'dishes', 'transactions']) {
      const db = openMemoryDatabase();
      const before = dumpDatabase(db);
      expect(() => seedDatabase(db, { ...seedOpts(new Date()), hooks: { afterStep: (s) => { if (s === step) throw new Error(`fail at ${s}`); } } })).toThrow(`fail at ${step}`);
      expect(dumpDatabase(db), step).toBe(before);
      db.close();
    }
  });

  it('refuses to run against a database that was never initialized', () => {
    const db = new Database(':memory:');
    expect(() => seedDatabase(db, seedOpts(new Date()))).toThrow(/not been initialized/);
    db.close();
  });
});

describe('startup check', () => {
  it('reports the path and reason for a missing file, a garbage file, and an uninitialized file', () => {
    const dir = tmp();
    try {
      const missing = path.join(dir, 'nope.db');
      expect(() => verifyDatabase(missing)).toThrow(DatabaseStartupError);
      try { verifyDatabase(missing); } catch (e) { expect(e.message).toContain(missing); expect(e.reason).toMatch(/does not exist/); }
      expect(fs.existsSync(missing)).toBe(false); // never silently created

      const garbage = path.join(dir, 'garbage.db');
      fs.writeFileSync(garbage, 'this is not a database '.repeat(100));
      const before = fs.readFileSync(garbage);
      try { verifyDatabase(garbage); throw new Error('should have failed'); } catch (e) { expect(e).toBeInstanceOf(DatabaseStartupError); expect(e.message).toContain(garbage); }
      expect(fs.readFileSync(garbage).equals(before)).toBe(true); // file left unmodified

      const empty = path.join(dir, 'empty.db');
      new Database(empty).close();
      expect(() => verifyDatabase(empty)).toThrow(DatabaseStartupError);
    } finally {
      cleanup(dir);
    }
  });
});

describe('command line (exit codes)', () => {
  const run = (args, env) =>
    spawnSync(process.execPath, [path.join(ROOT, 'server', 'cli.js'), ...args], { env: { ...process.env, ...env }, encoding: 'utf8', timeout: 60000 });

  it('init-db then seed-db succeed, repeat safely, and seed-db before init-db fails', () => {
    const dir = tmp();
    try {
      const file = path.join(dir, 'pos.db');
      const env = { POS_DB_PATH: file };

      const early = run(['seed-db'], env); // database file does not exist yet
      expect(early.status).toBe(1);
      expect(early.stderr).toContain('seed-db FAILED');

      new Database(file).close(); // exists but has no schema
      const uninit = run(['seed-db'], env);
      expect(uninit.status).toBe(1);
      expect(uninit.stderr).toMatch(/not been initialized/);
      fs.rmSync(file);

      const t0 = Date.now();
      expect(run(['init-db'], env).status).toBe(0);
      expect(run(['seed-db'], env).status).toBe(0);
      expect(Date.now() - t0).toBeLessThan(30000);
      const db = openDatabase(file);
      const first = counts(db);
      db.close();
      expect(run(['init-db'], env).status).toBe(0);
      expect(run(['seed-db'], env).status).toBe(0);
      const db2 = openDatabase(file);
      expect(counts(db2)).toEqual(first);
      db2.close();
    } finally {
      cleanup(dir);
    }
  });

  it('run exits with status 2 and prints the path when the database cannot be opened', () => {
    const dir = tmp();
    try {
      const file = path.join(dir, 'broken.db');
      fs.writeFileSync(file, 'garbage'.repeat(300));
      const r = run(['run', '--port', '0'], { POS_DB_PATH: file });
      expect(r.status).toBe(2);
      expect(r.stderr).toContain(file);
    } finally {
      cleanup(dir);
    }
  });
});
