import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
import fc from 'fast-check';

// Everything is loaded through the same native require cache so that patching a repository
// function in a test is seen by the service under test (failure injection, Property 13).
const require = createRequire(import.meta.url);
const sales = require('../../server/db/repos/sales');
const { submitOrder, SubmissionRejected } = require('../../server/terminal/submission');
const { computeTotals } = require('../../server/terminal/checkout');
const { InsufficientStock, StorageError } = require('../../server/lib/errors');
const { dumpDatabase } = require('../../server/db/connection');
const { makeDb, buildWorld, addUsers, actorFor, makeClock, stockOf } = require('../helpers');
const dishesSvc = require('../../server/menu/dishes');
const recipesSvc = require('../../server/inventory/recipes');
const ingredientsSvc = require('../../server/inventory/ingredients');
const settingsSvc = require('../../server/menu/settings');
const dashboardOverview = require('../../server/dashboard/overview');
const { resolveRange } = require('../../server/dashboard/ranges');

const RUNS = { numRuns: 60 };
const ING = 4;

// ---- scenario generator -------------------------------------------------------------------
const scenarioArb = fc.record({
  dishes: fc.array(
    fc.record({
      items: fc.uniqueArray(fc.tuple(fc.integer({ min: 0, max: ING - 1 }), fc.integer({ min: 1, max: 5000 })), {
        selector: (t) => t[0],
        minLength: 1,
        maxLength: 3,
      }),
      priceCents: fc.integer({ min: 1, max: 100000 }),
    }),
    { minLength: 1, maxLength: 3 }
  ),
  order: fc.array(fc.tuple(fc.nat(2), fc.integer({ min: 1, max: 5 })), { minLength: 1, maxLength: 3 }),
  extra: fc.array(fc.integer({ min: 0, max: 2000 }), { minLength: ING, maxLength: ING }),
  taxBp: fc.integer({ min: 0, max: 2500 }),
});

// Dedupe order lines by dish and work out the exact per-ingredient requirement.
function normalize(sc) {
  const seen = new Set();
  const lines = [];
  for (const [d, q] of sc.order) {
    const di = d % sc.dishes.length;
    if (seen.has(di)) continue;
    seen.add(di);
    lines.push({ di, quantity: q });
  }
  const required = Array(ING).fill(0);
  for (const l of lines) for (const [ing, qty] of sc.dishes[l.di].items) required[ing] += qty * l.quantity;
  return { lines, required };
}

function setup(sc, stocks) {
  const db = makeDb();
  addUsers(db);
  const world = buildWorld(db, {
    ingredients: stocks.map((s, i) => ({ name: `Ing${i}`, stockMilli: s, unitCostCents: i + 1 })),
    dishes: sc.dishes.map((d, i) => ({ name: `Dish${i}`, priceCents: d.priceCents, recipe: d.items })),
  });
  return { db, world, cashier: actorFor(db, 'Cashier 1'), clock: makeClock() };
}

const payload = (sc, n, world, submissionId, cashOverride) => {
  const lines = n.lines.map((l) => ({ dishId: world.dishIds[l.di], quantity: l.quantity }));
  const totals = computeTotals(
    n.lines.map((l) => ({ unitPriceCents: sc.dishes[l.di].priceCents, quantity: l.quantity })),
    sc.taxBp
  );
  return {
    submission: {
      submissionId,
      lines,
      cashTenderedCents: cashOverride ?? totals.totalCents + 37,
      taxRateBp: sc.taxBp,
    },
    totals,
  };
};

const sufficientStocks = (sc, n) => n.required.map((r, i) => r + sc.extra[i]);

describe('order submission', () => {
  // Feature: restaurant-pos-system, Property 9: Inventory deduction on successful submission
  it('deducts exactly the summed recipe requirement and creates one transaction', () => {
    fc.assert(
      fc.property(scenarioArb, (sc) => {
        const n = normalize(sc);
        const { db, world, cashier, clock } = setup(sc, sufficientStocks(sc, n));
        const before = stockOf(db);
        const { submission, totals } = payload(sc, n, world, 'sub-1');
        const res = submitOrder(db, cashier, submission, clock);

        const after = stockOf(db);
        world.ingIds.forEach((id, i) => expect(after[id]).toBe(before[id] - n.required[i]));
        expect(db.prepare('SELECT COUNT(*) c FROM transactions').get().c).toBe(1);
        expect(res.replayed).toBe(false);
        expect(res.receipt.totalCents).toBe(totals.totalCents);
        expect(res.receipt.lines.map((l) => [l.dishName, l.quantity])).toEqual(n.lines.map((l) => [`Dish${l.di}`, l.quantity]));
        db.close();
      }),
      RUNS
    );
  });

  // Feature: restaurant-pos-system, Property 10: Submission validity rules
  it('rejects each violated rule by name and changes nothing', () => {
    const rule = fc.constantFrom('no_lines', 'quantity_range', 'line_count', 'cash_below_total');
    fc.assert(
      fc.property(scenarioArb, rule, fc.constantFrom(0, 100, 1.5, -3), (sc, which, badQty) => {
        const n = normalize(sc);
        const { db, world, cashier, clock } = setup(sc, sufficientStocks(sc, n));
        const { submission, totals } = payload(sc, n, world, 'sub-bad');
        if (which === 'no_lines') submission.lines = [];
        if (which === 'quantity_range') submission.lines[0].quantity = badQty;
        if (which === 'line_count') submission.lines = Array.from({ length: 101 }, () => ({ dishId: world.dishIds[0], quantity: 1 }));
        if (which === 'cash_below_total') submission.cashTenderedCents = Math.max(0, totals.totalCents - 1);
        const before = dumpDatabase(db);
        let err;
        try {
          submitOrder(db, cashier, submission, clock);
        } catch (e) {
          err = e;
        }
        expect(err).toBeInstanceOf(SubmissionRejected);
        expect(err.rule).toBe(which);
        expect(dumpDatabase(db)).toBe(before);
        db.close();
      }),
      RUNS
    );
  });

  // Feature: restaurant-pos-system, Property 11: Insufficient stock is rejected and reported completely
  it('lists exactly the dishes that use a short ingredient and leaves the database untouched', () => {
    fc.assert(
      fc.property(scenarioArb, fc.integer({ min: 0, max: ING - 1 }), (sc, pick) => {
        const n = normalize(sc);
        const used = n.required.map((r, i) => (r > 0 ? i : -1)).filter((i) => i >= 0);
        const shortIdx = used[pick % used.length];
        const stocks = sufficientStocks(sc, n);
        stocks[shortIdx] = n.required[shortIdx] - 1; // one milli-unit short
        const { db, world, cashier, clock } = setup(sc, stocks);
        const { submission } = payload(sc, n, world, 'sub-short');
        const before = dumpDatabase(db);
        let err;
        try {
          submitOrder(db, cashier, submission, clock);
        } catch (e) {
          err = e;
        }
        expect(err).toBeInstanceOf(InsufficientStock);
        const expected = n.lines.filter((l) => sc.dishes[l.di].items.some(([ing]) => ing === shortIdx)).map((l) => `Dish${l.di}`);
        expect(err.dishNames).toEqual(expected);
        expect(dumpDatabase(db)).toBe(before);
        db.close();
      }),
      RUNS
    );
  });

  // Feature: restaurant-pos-system, Property 12: Sequential submissions never drive stock negative
  it('matches a reference model across a sequence of submissions', () => {
    fc.assert(
      fc.property(scenarioArb, fc.array(fc.array(fc.tuple(fc.nat(2), fc.integer({ min: 1, max: 5 })), { minLength: 1, maxLength: 3 }), { minLength: 1, maxLength: 6 }), (sc, orders) => {
        const start = sc.extra.map((e, i) => e * 3 + i * 10); // modest stock so some orders fail
        const { db, world, cashier, clock } = setup(sc, start);
        const remaining = [...start];
        let consumed = Array(ING).fill(0);
        orders.forEach((o, k) => {
          const n = normalize({ ...sc, order: o });
          const ok = n.required.every((r, i) => r <= remaining[i]);
          const { submission } = payload({ ...sc, order: o }, n, world, `seq-${k}`);
          let accepted = true;
          try {
            submitOrder(db, cashier, submission, clock);
          } catch (e) {
            expect(e).toBeInstanceOf(InsufficientStock);
            accepted = false;
          }
          expect(accepted).toBe(ok);
          if (ok) n.required.forEach((r, i) => { remaining[i] -= r; consumed[i] += r; });
          const stock = stockOf(db);
          world.ingIds.forEach((id, i) => {
            expect(stock[id]).toBeGreaterThanOrEqual(0);
            expect(stock[id]).toBe(remaining[i]);
          });
        });
        db.close();
      }),
      RUNS
    );
  });

  // Feature: restaurant-pos-system, Property 13: Submission atomicity under failure
  it('leaves the database exactly as before when any write step fails', () => {
    const steps = ['insertTransaction', 'insertOrderLine', 'decrementStock'];
    fc.assert(
      fc.property(scenarioArb, fc.integer({ min: 0, max: 12 }), (sc, failAt) => {
        const n = normalize(sc);
        const { db, world, cashier, clock } = setup(sc, sufficientStocks(sc, n));
        const { submission } = payload(sc, n, world, 'sub-fail');
        const before = dumpDatabase(db);

        const originals = Object.fromEntries(steps.map((s) => [s, sales[s]]));
        let calls = 0;
        let injected = false;
        for (const s of steps) {
          sales[s] = (...args) => {
            if (calls++ === failAt) {
              injected = true;
              throw new Error(`injected failure in ${s}`);
            }
            return originals[s](...args);
          };
        }
        let err;
        let result;
        try {
          result = submitOrder(db, cashier, submission, clock);
        } catch (e) {
          err = e;
        } finally {
          for (const s of steps) sales[s] = originals[s];
        }
        if (injected) {
          expect(err).toBeInstanceOf(StorageError); // no receipt, a storage error
          expect(result).toBeUndefined();
          expect(dumpDatabase(db)).toBe(before);
        } else {
          expect(err).toBeUndefined(); // failure point was beyond the last write step
        }
        db.close();
      }),
      RUNS
    );
  });

  // Feature: restaurant-pos-system, Property 14: Idempotent submission
  it('creates one transaction however many times the same identifier is submitted', () => {
    fc.assert(
      fc.property(scenarioArb, fc.integer({ min: 2, max: 4 }), (sc, times) => {
        const n = normalize(sc);
        const { db, world, cashier, clock } = setup(sc, sufficientStocks(sc, n));
        const { submission } = payload(sc, n, world, 'same-id');
        const first = submitOrder(db, cashier, submission, clock);
        const stockAfterFirst = stockOf(db);
        for (let i = 1; i < times; i++) {
          // the repeated payload may even differ: the identifier alone decides
          const repeat = { ...submission, lines: [{ dishId: world.dishIds[0], quantity: 1 }], cashTenderedCents: 1 };
          const again = submitOrder(db, cashier, i % 2 ? repeat : submission, clock);
          expect(again.replayed).toBe(true);
          expect(again.receipt).toEqual(first.receipt);
        }
        expect(db.prepare('SELECT COUNT(*) c FROM transactions').get().c).toBe(1);
        expect(stockOf(db)).toEqual(stockAfterFirst);
        db.close();
      }),
      RUNS
    );
  });

  // Feature: restaurant-pos-system, Property 16: Receipt numbers are unique and receipts are complete
  it('issues distinct receipt numbers and complete receipts', () => {
    fc.assert(
      fc.property(scenarioArb, fc.integer({ min: 2, max: 5 }), (sc, count) => {
        const n = normalize(sc);
        const generous = n.required.map((r, i) => r * count + sc.extra[i]);
        const { db, world, clock } = setup(sc, generous);
        const cashiers = ['Cashier 1', 'Cashier 2', 'Cashier 3'].map((u) => actorFor(db, u));
        const receipts = [];
        for (let k = 0; k < count; k++) {
          const { submission } = payload(sc, n, world, `rc-${k}`);
          receipts.push(submitOrder(db, cashiers[k % 3], submission, clock).receipt);
        }
        expect(new Set(receipts.map((r) => r.receiptNumber)).size).toBe(count);
        for (const [k, r] of receipts.entries()) {
          const tx = sales.getTransaction(db, r.id);
          expect(r.cashierName).toBe(cashiers[k % 3].username);
          expect(r.createdAt).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
          expect([r.subtotalCents, r.taxCents, r.totalCents, r.cashTenderedCents, r.changeDueCents]).toEqual([
            tx.subtotalCents, tx.taxCents, tx.totalCents, tx.cashTenderedCents, tx.changeDueCents,
          ]);
          for (const key of ['subtotal', 'tax', 'total', 'cashTendered', 'changeDue']) expect(r[key]).toMatch(/^\d+\.\d{2}$/);
          expect(r.lines.length).toBe(n.lines.length);
        }
        db.close();
      }),
      RUNS
    );
  });
});

describe('historical records', () => {
  // Feature: restaurant-pos-system, Property 15: Historical records are immutable snapshots
  it('never change when the menu, costs, tax or dishes change later', () => {
    fc.assert(
      fc.property(scenarioArb, fc.integer({ min: 1, max: 99999 }), fc.integer({ min: 0, max: 10000 }), (sc, newPrice, newTax) => {
        const n = normalize(sc);
        const { db, world, clock } = setup(sc, sufficientStocks(sc, n).map((s) => s + 100000));
        const owner = actorFor(db, 'Owner');
        const cashier = actorFor(db, 'Cashier 1');
        const { submission } = payload(sc, n, world, 'hist-1');
        const receipt = submitOrder(db, cashier, submission, clock).receipt;

        const range = resolveRange('today', clock());
        const snapshot = () =>
          JSON.stringify({
            tx: sales.getTransaction(db, receipt.id),
            lines: sales.getLines(db, receipt.id),
            overview: dashboardOverview.overview(db, owner, range),
          });
        const before = snapshot();

        const dishId = world.dishIds[0];
        const cat = db.prepare('SELECT id FROM categories LIMIT 1').get().id;
        dishesSvc.saveDish(db, owner, dishId, { name: 'Renamed', categoryId: cat, sellingPrice: (newPrice / 100).toFixed(2) });
        dishesSvc.setVisibility(db, owner, dishId, false);
        const ing = ingredientsSvc.listIngredients(db, owner)[0];
        ingredientsSvc.updateIngredient(db, owner, ing.id, { name: ing.name, unit: ing.unit, unitCost: '77.77', stock: ing.stock });
        settingsSvc.setTaxRate(db, owner, { taxRate: (newTax / 100).toFixed(2) });
        expect(snapshot()).toBe(before);

        dishesSvc.deleteDish(db, owner, dishId, true); // deletion keeps the sold lines
        for (const other of world.dishIds.slice(1)) dishesSvc.deleteDish(db, owner, other, true);
        expect(snapshot()).toBe(before);
        db.close();
      }),
      { numRuns: 40 }
    );
  });
});

describe('concurrent-looking submissions', () => {
  it('two cashiers racing for the last portion: exactly one wins', () => {
    const db = makeDb();
    addUsers(db);
    const w = buildWorld(db, {
      ingredients: [{ name: 'Beef', stockMilli: 1000 }],
      dishes: [{ name: 'Burger', priceCents: 500, recipe: [[0, 1000]] }],
    });
    const clock = makeClock();
    const a = actorFor(db, 'Cashier 1');
    const b = actorFor(db, 'Cashier 2');
    const mk = (id) => ({ submissionId: id, lines: [{ dishId: w.dishIds[0], quantity: 1 }], cashTenderedCents: 500, taxRateBp: 0 });
    const results = [a, b].map((who, i) => {
      try {
        return submitOrder(db, who, mk(`race-${i}`), clock);
      } catch (e) {
        return e;
      }
    });
    expect(results.filter((r) => r.receipt).length).toBe(1);
    expect(results.filter((r) => r instanceof InsufficientStock).length).toBe(1);
    expect(Object.values(stockOf(db))[0]).toBe(0);
    db.close();
  });
});
