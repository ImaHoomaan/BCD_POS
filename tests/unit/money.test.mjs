import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import money from '../../server/lib/money.js';
import checkout from '../../server/terminal/checkout.js';

const { computeTotals } = checkout;
const RUNS = { numRuns: 200 };

describe('money formatting', () => {
  // Feature: restaurant-pos-system, Property 1: Money formatting round trip
  it('parse(format(c)) === c and always has two decimals', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: money.MAX_MONEY_CENTS }), (c) => {
        const text = money.formatCents(c);
        expect(text).toMatch(/^\d+\.\d{2}$/);
        expect(money.parseMoney(text)).toBe(c);
      }),
      RUNS
    );
  });

  it('rejects malformed amounts', () => {
    for (const bad of ['', ' ', '-1', '1.234', 'abc', '1,000', '1e3', '1000000.00', '.5', '5.']) {
      expect(() => money.parseMoney(bad), bad).toThrow();
    }
    expect(money.parseMoney('0.5')).toBe(50);
    expect(money.parseMoney(' 12.30 ')).toBe(1230);
    expect(money.parseMoney('999999.99')).toBe(99999999);
  });
});

// Independent oracle: exact rational arithmetic with BigInt, round half up.
function oracleTax(subtotal, bp) {
  const num = BigInt(subtotal) * BigInt(bp); // tax = num / 10000
  return Number((2n * num + 10000n) / 20000n);
}

describe('checkout totals', () => {
  // Feature: restaurant-pos-system, Property 2: Checkout totals are exact and round half up
  it('subtotal, tax and total match the exact oracle for any lines and tax rate', () => {
    const line = fc.record({
      unitPriceCents: fc.integer({ min: 1, max: 99999999 }),
      quantity: fc.integer({ min: 1, max: 99 }),
    });
    fc.assert(
      fc.property(fc.array(line, { minLength: 1, maxLength: 100 }), fc.integer({ min: 0, max: 10000 }), (lines, bp) => {
        const t = computeTotals(lines, bp);
        const subtotal = lines.reduce((s, l) => s + l.unitPriceCents * l.quantity, 0);
        expect(t.subtotalCents).toBe(subtotal);
        expect(t.taxCents).toBe(oracleTax(subtotal, bp));
        expect(t.totalCents).toBe(subtotal + t.taxCents);
        if (bp === 0) {
          expect(t.taxCents).toBe(0);
          expect(t.totalCents).toBe(subtotal);
        }
      }),
      RUNS
    );
  });

  it('rounds exact half cents up and sub-half cents down', () => {
    expect(money.taxCents(6, 825)).toBe(0); // 0.00495 -> 0.00
    expect(money.taxCents(5, 1000)).toBe(1); // 0.005 -> 0.01
    expect(money.taxCents(100, 50)).toBe(1); // 0.005 -> 0.01
    expect(money.taxCents(1000, 825)).toBe(83); // 82.5 -> 83
  });
});

describe('cash tender', () => {
  // Feature: restaurant-pos-system, Property 3: Cash tender classification
  it('classifies any input string', () => {
    const validAmount = fc.integer({ min: 0, max: money.MAX_MONEY_CENTS }).map(money.formatCents);
    const junk = fc.oneof(
      fc.constant(''),
      fc.constant('-1.00'),
      fc.constant('abc'),
      fc.constant('1.234'),
      fc.constant('1000000.00'),
      fc.string({ maxLength: 8 })
    );
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 5000000 }), fc.oneof(validAmount, junk), (total, raw) => {
        const r = money.evaluateTender(total, raw);
        const valid = /^\d{1,6}(\.\d{1,2})?$/.test(raw.trim());
        if (!valid) {
          expect(r.kind).toBe('invalid');
          expect(r.canSubmit).toBe(false);
          expect(r.changeCents).toBeUndefined();
          expect(r.remainingCents).toBeUndefined();
          return;
        }
        const cents = money.parseMoney(raw);
        if (cents >= total) {
          expect(r).toMatchObject({ kind: 'sufficient', changeCents: cents - total, canSubmit: true });
        } else {
          expect(r).toMatchObject({ kind: 'short', remainingCents: total - cents, canSubmit: false });
          expect(r.changeCents).toBeUndefined();
        }
      }),
      RUNS
    );
  });

  it('tender equal to the total gives zero change, one cent short is rejected', () => {
    expect(money.evaluateTender(1250, '12.50')).toMatchObject({ kind: 'sufficient', changeCents: 0 });
    expect(money.evaluateTender(1250, '12.49')).toMatchObject({ kind: 'short', remainingCents: 1 });
  });
});

describe('scaled quantities and serving cost', () => {
  it('serving cost sums first and rounds once, half up', () => {
    expect(money.servingCostCents([{ qtyMilli: 500, unitCostCents: 3 }])).toBe(2); // 0.015 -> 0.02
    expect(money.servingCostCents([{ qtyMilli: 500, unitCostCents: 3 }, { qtyMilli: 500, unitCostCents: 3 }])).toBe(3);
    expect(money.servingCostCents([])).toBe(0);
  });

  it('does not overflow for the largest allowed values', () => {
    const big = money.servingCostCents([{ qtyMilli: 999999999, unitCostCents: 99999999 }]);
    expect(big).toBe(Number((999999999n * 99999999n + 500n) / 1000n));
  });

  it('parses milli quantities with the right decimals', () => {
    expect(money.parseMilli('2.5', { decimals: 2, maxMilli: money.MAX_STOCK_MILLI })).toBe(2500);
    expect(money.parseMilli('0.125', { decimals: 3, minMilli: 1, maxMilli: money.MAX_RECIPE_MILLI })).toBe(125);
    expect(() => money.parseMilli('0.125', { decimals: 2, maxMilli: money.MAX_STOCK_MILLI })).toThrow();
    expect(() => money.parseMilli('1.5', { decimals: 2, maxMilli: money.MAX_STOCK_MILLI, wholeOnly: true })).toThrow();
  });

  it('tax rate parsing', () => {
    expect(money.parseTaxRate('8.25')).toBe(825);
    expect(money.parseTaxRate('100')).toBe(10000);
    expect(money.parseTaxRate('0')).toBe(0);
    for (const bad of ['', '-1', '100.01', '101', '1.234', 'x']) expect(() => money.parseTaxRate(bad), bad).toThrow();
  });
});
