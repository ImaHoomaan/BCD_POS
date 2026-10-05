'use strict';

const { write } = require('./connection');
const { parseMoney, parseMilli, servingCostCents, taxCents, MAX_STOCK_MILLI, MAX_RECIPE_MILLI } = require('../lib/money');
const { formatLocal, startOfDay, addDays } = require('../lib/clock');
const data = require('./seed_data');

// Small deterministic PRNG (mulberry32) so seeded transactions are reproducible.
function makeRng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const pad8 = (n) => String(n).padStart(8, '0');

function isInitialized(db) {
  try {
    return !!db.prepare('SELECT version FROM schema_meta LIMIT 1').get();
  } catch {
    return false;
  }
}

// Loads demo data in ONE transaction. Any failure rolls back the entire run (Req 1.8, 2.7).
//   hashPassword(plain) -> stored hash (injected by the caller; auth owns hashing)
//   hooks.afterStep(name) is a test seam for failure injection.
function seedDatabase(db, { now = new Date(), hashPassword, hooks = {} } = {}) {
  if (!isInitialized(db)) {
    throw new Error('The database has not been initialized. Run init-db first.');
  }
  if (typeof hashPassword !== 'function') throw new Error('seedDatabase requires a hashPassword function.');
  const step = (name) => hooks.afterStep && hooks.afterStep(name);

  return write(db, () => {
    // Users -------------------------------------------------------------------------
    const findUser = db.prepare('SELECT id FROM users WHERE username = ?');
    const insUser = db.prepare('INSERT INTO users (username, role, password_hash) VALUES (?, ?, ?)');
    for (const u of data.USERS) {
      if (!findUser.get(u.username)) insUser.run(u.username, u.role, hashPassword(u.password));
    }
    step('users');

    // Categories --------------------------------------------------------------------
    const insCat = db.prepare('INSERT OR IGNORE INTO categories (name) VALUES (?)');
    for (const name of data.CATEGORIES) insCat.run(name);
    step('categories');

    // Ingredients -------------------------------------------------------------------
    const insIng = db.prepare(
      'INSERT OR IGNORE INTO ingredients (name, unit, unit_cost_cents, stock_milli) VALUES (?, ?, ?, ?)'
    );
    for (const i of data.INGREDIENTS) {
      insIng.run(
        i.name,
        i.unit,
        parseMoney(i.unitCost, { field: 'unitCost' }),
        parseMilli(i.stock, { decimals: 2, maxMilli: MAX_STOCK_MILLI, wholeOnly: i.unit === 'pcs' })
      );
    }
    step('ingredients');

    // Dishes and recipes --------------------------------------------------------------
    const catId = (name) => db.prepare('SELECT id FROM categories WHERE name = ?').get(name).id;
    const ingByName = (name) => db.prepare('SELECT id, unit_cost_cents AS unitCostCents FROM ingredients WHERE name = ?').get(name);
    const findDish = db.prepare('SELECT id FROM dishes WHERE name = ? AND category_id = ?');
    const insDish = db.prepare(
      'INSERT INTO dishes (name, category_id, selling_price_cents, target_cost_cents, visible) VALUES (?, ?, ?, ?, ?)'
    );
    const insItem = db.prepare('INSERT OR IGNORE INTO recipe_items (dish_id, ingredient_id, qty_milli) VALUES (?, ?, ?)');
    const seededDishes = []; // { id, name, priceCents, servingCostCents, visible }
    for (const d of data.DISHES) {
      const cid = catId(d.category);
      let row = findDish.get(d.name, cid);
      let id;
      if (row) {
        id = row.id;
      } else {
        id = insDish.run(d.name, cid, parseMoney(d.price), parseMoney(d.target, { minCents: 0 }), d.visible ? 1 : 0)
          .lastInsertRowid;
      }
      const items = [];
      for (const [ingName, qty] of d.recipe) {
        const ing = ingByName(ingName);
        const unit = data.INGREDIENTS.find((x) => x.name === ingName).unit;
        const qtyMilli = parseMilli(qty, { decimals: 3, minMilli: 1, maxMilli: MAX_RECIPE_MILLI, wholeOnly: unit === 'pcs' });
        insItem.run(id, ing.id, qtyMilli);
        items.push({ qtyMilli, unitCostCents: ing.unitCostCents });
      }
      seededDishes.push({
        id: Number(id),
        name: d.name,
        priceCents: parseMoney(d.price),
        servingCostCents: servingCostCents(items),
        visible: d.visible,
      });
    }
    step('dishes');

    // Settings ----------------------------------------------------------------------
    db.prepare("INSERT OR IGNORE INTO settings (key, value) VALUES ('tax_rate_bp', '0')").run();

    // Historical sample transactions ---------------------------------------------------
    // They are history only: ingredient stock above is already the "after" state, so
    // seeding does not deduct stock.
    const cashiers = db.prepare("SELECT id FROM users WHERE role = 'cashier' ORDER BY username").all();
    const sellable = seededDishes.filter((d) => d.visible);
    const rng = makeRng(data.SEED_RNG_SEED);
    const pick = (n) => Math.floor(rng() * n);
    const today0 = startOfDay(now);
    const minutesToday = Math.floor((now.getTime() - today0.getTime()) / 60000);

    const planned = [];
    for (let i = 1; i <= data.SEED_TRANSACTION_COUNT; i++) {
      const daysAgo = i % 6 === 0 ? 0 : 1 + pick(29); // a few today, the rest within 29 earlier days
      let when;
      if (daysAgo === 0) {
        when = new Date(now.getTime() - pick(Math.max(1, Math.min(minutesToday, 600))) * 60000);
      } else {
        const day = addDays(today0, -daysAgo);
        when = new Date(day.getFullYear(), day.getMonth(), day.getDate(), 9 + pick(13), pick(60), pick(60));
      }
      const lineCount = 1 + pick(4);
      const chosen = new Set();
      while (chosen.size < Math.min(lineCount, sellable.length)) chosen.add(pick(sellable.length));
      const lines = [...chosen].map((idx) => ({ dish: sellable[idx], quantity: 1 + pick(3) }));
      planned.push({ n: i, when, lines, cashierId: cashiers[(i - 1) % cashiers.length].id });
    }
    planned.sort((a, b) => a.when - b.when);

    const findTx = db.prepare('SELECT id FROM transactions WHERE submission_id = ?');
    const nextId = db.prepare('SELECT COALESCE(MAX(id), 0) + 1 AS n FROM transactions');
    const insTx = db.prepare(
      `INSERT INTO transactions (id, receipt_number, submission_id, created_at, cashier_id, subtotal_cents,
         tax_rate_bp, tax_cents, total_cents, cash_tendered_cents, change_due_cents)
       VALUES (?, ?, ?, ?, ?, ?, 0, 0, ?, ?, ?)`
    );
    const insLine = db.prepare(
      `INSERT INTO order_lines (transaction_id, dish_ref, dish_name, unit_price_cents, serving_cost_cents, quantity, line_total_cents)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    );
    for (const p of planned) {
      const submissionId = `seed-${String(p.n).padStart(4, '0')}`;
      if (findTx.get(submissionId)) continue;
      const subtotal = p.lines.reduce((s, l) => s + l.dish.priceCents * l.quantity, 0);
      const tax = taxCents(subtotal, 0);
      const total = subtotal + tax;
      const cash = Math.ceil(total / 500) * 500; // customer pays with the next multiple of 5.00
      const id = nextId.get().n;
      insTx.run(id, `R${pad8(id)}`, submissionId, formatLocal(p.when), p.cashierId, subtotal, total, cash, cash - total);
      for (const l of p.lines) {
        insLine.run(id, l.dish.id, l.dish.name, l.dish.priceCents, l.dish.servingCostCents, l.quantity, l.dish.priceCents * l.quantity);
      }
    }
    step('transactions');

    return { ok: true };
  });
}

module.exports = { seedDatabase, isInitialized };
