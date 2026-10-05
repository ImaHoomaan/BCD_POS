'use strict';

// Shared test helpers. Property tests build a FRESH in-memory database inside each example
// (never a shared fixture), so generated examples cannot leak state into each other.

const { openMemoryDatabase } = require('../server/db/connection');
const { seedDatabase } = require('../server/db/seed');
const { hashPassword, TEST_PARAMS } = require('../server/auth/passwords');
const users = require('../server/db/repos/users');

const fastHash = (pw) => hashPassword(pw, { params: TEST_PARAMS });

// Controllable clock: call it for "now", use .set(date) / .advance(ms) to move time.
function makeClock(start = new Date(2026, 9, 5, 12, 0, 0)) {
  let current = new Date(start.getTime());
  const clock = () => new Date(current.getTime());
  clock.set = (d) => {
    current = new Date(d.getTime());
  };
  clock.advance = (ms) => {
    current = new Date(current.getTime() + ms);
  };
  return clock;
}

function makeDb({ seed = false, now = new Date(2026, 9, 5, 12, 0, 0) } = {}) {
  const db = openMemoryDatabase();
  if (seed) seedDatabase(db, { now, hashPassword: fastHash });
  return db;
}

// Principal built the same way the session middleware builds it.
function actorFor(db, username) {
  const u = users.findUserByUsername(db, username);
  if (!u) throw new Error(`No such user ${username}`);
  return { userId: u.id, username: u.username, role: u.role };
}

// Minimal users for tests that do not need the full demo seed.
function addUsers(db) {
  const ins = db.prepare('INSERT INTO users (username, role, password_hash) VALUES (?, ?, ?)');
  const h = fastHash('x');
  ins.run('Owner', 'owner', h);
  ins.run('Cashier 1', 'cashier', h);
  ins.run('Cashier 2', 'cashier', h);
  ins.run('Cashier 3', 'cashier', h);
}

// Builds a world from a compact spec:
//   { ingredients: [{name, unit, unitCostCents, stockMilli}], dishes: [{name, priceCents, visible, recipe:[[ingIdx, qtyMilli]]}] }
function buildWorld(db, spec) {
  db.prepare("INSERT OR IGNORE INTO categories (name) VALUES ('Main')").run();
  const catId = db.prepare("SELECT id FROM categories WHERE name = 'Main'").get().id;
  const ingIds = spec.ingredients.map((i) =>
    Number(
      db
        .prepare('INSERT INTO ingredients (name, unit, unit_cost_cents, stock_milli) VALUES (?, ?, ?, ?)')
        .run(i.name, i.unit || 'grams', i.unitCostCents ?? 1, i.stockMilli).lastInsertRowid
    )
  );
  const dishIds = spec.dishes.map((d) => {
    const id = Number(
      db
        .prepare('INSERT INTO dishes (name, category_id, selling_price_cents, target_cost_cents, visible) VALUES (?, ?, ?, 0, ?)')
        .run(d.name, catId, d.priceCents, d.visible === false ? 0 : 1).lastInsertRowid
    );
    for (const [idx, qty] of d.recipe) {
      db.prepare('INSERT INTO recipe_items (dish_id, ingredient_id, qty_milli) VALUES (?, ?, ?)').run(id, ingIds[idx], qty);
    }
    return id;
  });
  return { catId, ingIds, dishIds };
}

const stockOf = (db) =>
  Object.fromEntries(db.prepare('SELECT id, stock_milli AS s FROM ingredients ORDER BY id').all().map((r) => [r.id, r.s]));

module.exports = { fastHash, makeClock, makeDb, actorFor, addUsers, buildWorld, stockOf };
