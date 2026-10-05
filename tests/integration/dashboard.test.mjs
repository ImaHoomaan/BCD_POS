import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
import fc from 'fast-check';

const require = createRequire(import.meta.url);
const { makeDb, addUsers, actorFor } = require('../helpers');
const sales = require('../../server/db/repos/sales');
const { resolveRange, resolveCustomRange, KINDS } = require('../../server/dashboard/ranges');
const { overview } = require('../../server/dashboard/overview');
const { salesChart } = require('../../server/dashboard/chart');
const { topDishes } = require('../../server/dashboard/topDishes');
const { dashboardSummary } = require('../../server/dashboard/summary');
const { searchTransactions, PAGE_SIZE } = require('../../server/dashboard/txlog');
const { formatLocal } = require('../../server/lib/clock');
const { formatCents } = require('../../server/lib/money');
const { ValidationError } = require('../../server/lib/errors');

const NOW = new Date(2026, 9, 5, 12, 0, 0);

// Wall-clock key, used by the models so they are independent of the implementation's text comparison.
const wall = (d) =>
  d.getFullYear() * 1e10 + (d.getMonth() + 1) * 1e8 + d.getDate() * 1e6 + d.getHours() * 1e4 + d.getMinutes() * 100 + d.getSeconds();
const dayStart = (now, back) => new Date(now.getFullYear(), now.getMonth(), now.getDate() - back);
const DAYS = { today: 1, '7d': 7, '30d': 30 };

function modelRange(kind, now) {
  return { lo: wall(dayStart(now, DAYS[kind] - 1)), hi: wall(dayStart(now, -1)) }; // [lo, hi)
}

describe('date range resolution', () => {
  // Feature: restaurant-pos-system, Property 21: Date range resolution
  it('covers exactly the local days required, including both boundaries', () => {
    const anyNow = fc.date({ min: new Date(2020, 0, 2), max: new Date(2032, 11, 30) });
    const parts = fc.record({ h: fc.integer({ min: 0, max: 23 }), m: fc.integer({ min: 0, max: 59 }), s: fc.integer({ min: 0, max: 59 }), back: fc.integer({ min: -2, max: 40 }) });
    fc.assert(
      fc.property(anyNow, fc.constantFrom(...KINDS), parts, (now, kind, p) => {
        const r = resolveRange(kind, now);
        const { lo, hi } = modelRange(kind, now);
        expect(wall(r.start)).toBe(lo);
        expect(wall(r.endExclusive)).toBe(hi);
        const ts = new Date(now.getFullYear(), now.getMonth(), now.getDate() - p.back, p.h, p.m, p.s);
        const inside = wall(ts) >= lo && wall(ts) < hi;
        const text = formatLocal(ts);
        expect(text >= r.startText && text < r.endText).toBe(inside);
      }),
      { numRuns: 300 }
    );
  });

  it('boundary timestamps', () => {
    const r = resolveRange('7d', NOW);
    expect(r.startText).toBe('2026-09-29 00:00:00');
    expect(r.endText).toBe('2026-10-06 00:00:00');
    expect('2026-09-29 00:00:00' >= r.startText).toBe(true);
    expect('2026-09-28 23:59:59' >= r.startText).toBe(false);
    expect('2026-10-05 23:59:59' < r.endText).toBe(true);
    expect('2026-10-06 00:00:00' < r.endText).toBe(false);
  });

  it('custom ranges include start 00:00:00 through end 23:59:59 and reject end < start', () => {
    const r = resolveCustomRange('2026-09-01', '2026-09-03');
    expect(r.startText).toBe('2026-09-01 00:00:00');
    expect(r.endText).toBe('2026-09-04 00:00:00');
    expect(() => resolveCustomRange('2026-09-03', '2026-09-01')).toThrow(ValidationError);
    expect(() => resolveCustomRange('2026-02-30', '2026-03-01')).toThrow(ValidationError);
    expect(resolveCustomRange('2026-09-01', '2026-09-01').endText).toBe('2026-09-02 00:00:00');
  });
});

// ---- data generator -------------------------------------------------------------------------
const DISHES = [
  { ref: 1, name: 'Alpha' },
  { ref: 2, name: 'bravo' },
  { ref: 3, name: 'Charlie' },
  { ref: 101, name: 'Deleted Delta' }, // dish no longer exists in the menu
];

const txArb = fc.record({
  // whole seconds relative to NOW: from 36 days back to 2 days ahead, clustered on boundaries
  at: fc.oneof(
    fc.integer({ min: -36 * 86400, max: 2 * 86400 }),
    fc.constantFrom(-12 * 3600, -12 * 3600 - 1, 12 * 3600 - 1, 12 * 3600, -6 * 86400 - 12 * 3600, -6 * 86400 - 12 * 3600 - 1, -29 * 86400 - 12 * 3600)
  ),
  cashier: fc.integer({ min: 0, max: 2 }),
  taxBp: fc.constantFrom(0, 0, 825),
  lines: fc.array(
    fc.record({
      dish: fc.integer({ min: 0, max: 3 }),
      qty: fc.integer({ min: 1, max: 3 }),
      price: fc.constantFrom(100, 250, 999, 12345),
      cost: fc.constantFrom(0, 40, 500),
    }),
    { minLength: 1, maxLength: 3 }
  ),
});

function load(txs) {
  const db = makeDb();
  addUsers(db);
  const cashiers = ['Cashier 1', 'Cashier 2', 'Cashier 3'].map((u) => actorFor(db, u).userId);
  const rows = txs.map((t, i) => {
    const d = new Date(NOW.getTime() + t.at * 1000);
    const lines = t.lines.filter((l, idx, arr) => arr.findIndex((x) => x.dish === l.dish) === idx);
    const subtotal = lines.reduce((s, l) => s + l.price * l.qty, 0);
    const id = i + 1;
    sales.insertTransaction(db, {
      id,
      receiptNumber: `R${String(id).padStart(8, '0')}`,
      submissionId: `g-${id}`,
      createdAt: formatLocal(d),
      cashierId: cashiers[t.cashier],
      subtotalCents: subtotal,
      taxRateBp: t.taxBp,
      taxCents: 0,
      totalCents: subtotal,
      cashTenderedCents: subtotal,
      changeDueCents: 0,
    });
    for (const l of lines) {
      sales.insertOrderLine(db, {
        transactionId: id,
        dishRef: DISHES[l.dish].ref,
        dishName: DISHES[l.dish].name,
        unitPriceCents: l.price,
        servingCostCents: l.cost,
        quantity: l.qty,
        lineTotalCents: l.price * l.qty,
      });
    }
    return { id, d, cashier: t.cashier, lines, subtotal, receipt: `R${String(id).padStart(8, '0')}` };
  });
  return { db, rows, owner: actorFor(db, 'Owner') };
}

const inRange = (row, kind) => {
  const { lo, hi } = modelRange(kind, NOW);
  return wall(row.d) >= lo && wall(row.d) < hi;
};

const RUNS = { numRuns: 40 };
const txsArb = fc.array(txArb, { maxLength: 30 });

describe('dashboard aggregates', () => {
  // Feature: restaurant-pos-system, Property 22: Dashboard overview aggregates
  it('gross sales and net revenue match the model for every filter', () => {
    fc.assert(
      fc.property(txsArb, (txs) => {
        const { db, rows, owner } = load(txs);
        for (const kind of KINDS) {
          const sel = rows.filter((r) => inRange(r, kind));
          const gross = sel.reduce((s, r) => s + r.lines.reduce((a, l) => a + l.price * l.qty, 0), 0);
          const cost = sel.reduce((s, r) => s + r.lines.reduce((a, l) => a + l.cost * l.qty, 0), 0);
          const o = overview(db, owner, resolveRange(kind, NOW));
          expect(o.grossCents).toBe(gross);
          expect(o.netCents).toBe(gross - cost);
          if (sel.length === 0) {
            expect(o.gross).toBe('0.00');
            expect(o.net).toBe('0.00');
          }
        }
        db.close();
      }),
      RUNS
    );
  });

  // Feature: restaurant-pos-system, Property 23: Chart sum equals Gross_Sales
  it('chart buckets are complete, zero-filled and sum to the gross sales card', () => {
    fc.assert(
      fc.property(txsArb, fc.constantFrom(...KINDS), (txs, kind) => {
        const { db, rows, owner } = load(txs);
        const range = resolveRange(kind, NOW);
        const chart = salesChart(db, owner, range);
        expect(chart.buckets).toHaveLength(kind === 'today' ? 24 : DAYS[kind]);
        expect(chart.totalCents).toBe(overview(db, owner, range).grossCents);
        const expected = new Map(chart.buckets.map((b) => [b.label, 0]));
        for (const r of rows.filter((x) => inRange(x, kind))) {
          const label = kind === 'today'
            ? `${String(r.d.getHours()).padStart(2, '0')}:00`
            : `${r.d.getFullYear()}-${String(r.d.getMonth() + 1).padStart(2, '0')}-${String(r.d.getDate()).padStart(2, '0')}`;
          expected.set(label, expected.get(label) + r.subtotal);
        }
        for (const b of chart.buckets) {
          expect(b.cents, b.label).toBe(expected.get(b.label));
          expect(b.value).toBe(formatCents(b.cents));
        }
        db.close();
      }),
      RUNS
    );
  });

  // Feature: restaurant-pos-system, Property 24: Top-selling dish ranking
  it('ranks by units, then revenue, then name; only rank 1 is labelled', () => {
    fc.assert(
      fc.property(txsArb, fc.constantFrom(...KINDS), (txs, kind) => {
        const { db, rows, owner } = load(txs);
        const agg = new Map();
        for (const r of rows.filter((x) => inRange(x, kind))) {
          for (const l of r.lines) {
            const d = DISHES[l.dish];
            const a = agg.get(d.ref) || { name: d.name, units: 0, revenue: 0 };
            a.units += l.qty;
            a.revenue += l.price * l.qty;
            agg.set(d.ref, a);
          }
        }
        const expected = [...agg.values()].sort((a, b) => b.units - a.units || b.revenue - a.revenue || a.name.toLowerCase().localeCompare(b.name.toLowerCase())).slice(0, 5);
        const got = topDishes(db, owner, resolveRange(kind, NOW));
        expect(got.map((g) => [g.dishName, g.units, g.revenueCents])).toEqual(expected.map((e) => [e.name, e.units, e.revenue]));
        expect(got.map((g) => g.isTop)).toEqual(got.map((_, i) => i === 0));
        expect(got.map((g) => g.rank)).toEqual(got.map((_, i) => i + 1));
        if (expected.length === 0) expect(got).toEqual([]);
        db.close();
      }),
      RUNS
    );
  });

  it('keeps a failing section from showing zeros, and reports it as an error', () => {
    const { db, owner } = load([]);
    db.exec('DROP TABLE order_lines');
    const s = dashboardSummary(db, owner, 'today', NOW);
    expect(s.overview.ok).toBe(false);
    expect(s.chart.ok).toBe(true); // independent sections
    db.close();
  });
});

describe('transaction log', () => {
  const filterArb = fc.record({
    search: fc.constantFrom('', '', 'R0000', 'r00000', '%', '_', 'zzz', '1', 'R00000012'),
    cashier: fc.constantFrom(null, 0, 1, 2),
    range: fc.constantFrom('all', 'today', '7d', '30d'),
  });

  function allPages(db, owner, q) {
    const first = searchTransactions(db, owner, { ...q, page: 1 });
    const pages = [first];
    for (let p = 2; p <= first.pages; p++) pages.push(searchTransactions(db, owner, { ...q, page: p }));
    return pages;
  }

  // Feature: restaurant-pos-system, Property 25: Transaction log filtering
  it('returns exactly the transactions satisfying every applied filter', () => {
    fc.assert(
      fc.property(txsArb, filterArb, (txs, f) => {
        const { db, rows, owner } = load(txs);
        const cashierIds = ['Cashier 1', 'Cashier 2', 'Cashier 3'].map((u) => actorFor(db, u).userId);
        const q = {
          search: f.search,
          cashierId: f.cashier === null ? null : cashierIds[f.cashier],
          range: f.range === 'all' ? null : resolveRange(f.range, NOW),
        };
        const expected = rows.filter(
          (r) =>
            r.receipt.toLowerCase().includes(f.search.toLowerCase()) && // '%' and '_' are literal
            (f.cashier === null || r.cashier === f.cashier) &&
            (f.range === 'all' || inRange(r, f.range))
        );
        const got = allPages(db, owner, q).flatMap((p) => p.rows);
        expect(new Set(got.map((g) => g.id))).toEqual(new Set(expected.map((e) => e.id)));
        expect(got).toHaveLength(expected.length);
        for (const g of got) {
          expect(g.total).toMatch(/^\d+\.\d{2}$/);
          expect(g.createdAt).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
          expect(g.cashierName).toMatch(/^Cashier [123]$/);
        }
        if (expected.length === 0) {
          const p = searchTransactions(db, owner, { ...q, page: 1 });
          expect(p.rows).toEqual([]);
          expect(p.pages).toBe(0);
        }
        db.close();
      }),
      RUNS
    );
  });

  // Feature: restaurant-pos-system, Property 26: Transaction log ordering and pagination
  it('sorts newest first and paginates in pages of 25', () => {
    fc.assert(
      fc.property(fc.array(txArb, { minLength: 0, maxLength: 70 }), (txs) => {
        const { db, rows, owner } = load(txs);
        const pages = allPages(db, owner, {});
        const n = rows.length;
        expect(pages[0].total).toBe(n);
        expect(pages[0].pages).toBe(Math.ceil(n / PAGE_SIZE));
        pages.forEach((p, i) => {
          if (i < pages.length - 1) expect(p.rows).toHaveLength(PAGE_SIZE);
          else if (n > 0) expect(p.rows.length).toBeGreaterThanOrEqual(1), expect(p.rows.length).toBeLessThanOrEqual(PAGE_SIZE);
        });
        const expectedOrder = [...rows]
          .sort((a, b) => formatLocal(b.d).localeCompare(formatLocal(a.d)) || b.receipt.localeCompare(a.receipt))
          .map((r) => r.id);
        expect(pages.flatMap((p) => p.rows.map((r) => r.id))).toEqual(expectedOrder);
        db.close();
      }),
      { numRuns: 25 }
    );
  });

  it('26 matching transactions give two pages (25 + 1)', () => {
    const tx = { at: -3600, cashier: 0, taxBp: 0, lines: [{ dish: 0, qty: 1, price: 100, cost: 10 }] };
    const { db, owner } = load(Array.from({ length: 26 }, () => tx));
    const p1 = searchTransactions(db, owner, { page: 1 });
    const p2 = searchTransactions(db, owner, { page: 2 });
    expect([p1.rows.length, p2.rows.length, p1.pages]).toEqual([25, 1, 2]);
    db.close();
  });

  it('shows details of a transaction with lines, tax, cash and change', () => {
    const { db, owner } = load([{ at: -3600, cashier: 1, taxBp: 0, lines: [{ dish: 2, qty: 2, price: 250, cost: 40 }] }]);
    const d = require('../../server/dashboard/txlog').getTransactionDetail(db, owner, 1);
    expect(d.lines[0]).toMatchObject({ dishName: 'Charlie', quantity: 2, lineTotal: '5.00' });
    expect(d).toMatchObject({ subtotal: '5.00', cashierName: 'Cashier 2' });
    db.close();
  });
});
