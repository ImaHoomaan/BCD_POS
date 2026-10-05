import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import order from '../../server/terminal/order.js';

const RUNS = { numRuns: 300 };

// Realistic dishes: available means at least one serving is in stock; unavailable means zero.
const dishArb = fc.oneof(
  fc.record({ visible: fc.boolean(), available: fc.constant(false), maxServings: fc.constant(0) }),
  fc.record({ visible: fc.boolean(), available: fc.constant(true), maxServings: fc.integer({ min: 1, max: 150 }) })
);
const toMap = (dishes) => new Map(dishes.map((d, i) => [i + 1, { ...d, id: i + 1, priceCents: 100 * (i + 1) }]));

describe('quantity input validation', () => {
  // Feature: restaurant-pos-system, Property 4: Quantity input validation
  it('accepts exactly whole numbers 1..99 within stock; everything else keeps the draft', () => {
    const raw = fc.oneof(
      fc.string({ maxLength: 6 }),
      fc.integer({ min: -5, max: 200 }).map(String),
      fc.constantFrom('', ' ', '0', '-1', '1.5', '1e1', '007', '99', '100', 'abc', '５')
    );
    fc.assert(
      fc.property(raw, fc.integer({ min: 1, max: 150 }), (text, m) => {
        const map = toMap([{ visible: true, available: true, maxServings: m }]);
        const before = { submissionId: 's', lines: [{ dishId: 1, quantity: 1 }], checkoutTaxBp: null };
        const wellFormed = /^\d{1,4}$/.test(text.trim());
        const q = wellFormed ? Number(text.trim()) : NaN;
        const inRange = wellFormed && q >= 1 && q <= 99;
        const ok = inRange && q <= m;
        if (ok) {
          const after = order.setQuantity(before, 1, text, map);
          expect(after.lines).toEqual([{ dishId: 1, quantity: q }]);
        } else {
          let err;
          try {
            order.setQuantity(before, 1, text, map);
          } catch (e) {
            err = e;
          }
          expect(err, `input ${JSON.stringify(text)}`).toBeDefined();
          expect(before.lines).toEqual([{ dishId: 1, quantity: 1 }]); // immutable, unchanged
          if (inRange && q > m) expect(err.detail.max).toBe(Math.min(99, m)); // states the maximum
          if (!wellFormed || !inRange) expect(err.message).toMatch(/whole number from 1 to 99/);
        }
      }),
      RUNS
    );
  });
});

describe('order editing model', () => {
  // Feature: restaurant-pos-system, Property 5: Order editing model
  it('keeps every invariant after any sequence of operations', () => {
    const op = fc.record({
      type: fc.constantFrom('add', 'add', 'add', 'set', 'remove', 'clear'),
      dish: fc.integer({ min: 1, max: 4 }),
      raw: fc.oneof(fc.integer({ min: -2, max: 120 }).map(String), fc.string({ maxLength: 3 })),
    });
    fc.assert(
      fc.property(fc.array(dishArb, { minLength: 4, maxLength: 4 }), fc.array(op, { maxLength: 40 }), (dishes, ops) => {
        const map = toMap(dishes);
        let draft = order.newDraft();
        for (const o of ops) {
          const prev = draft;
          try {
            if (o.type === 'add') draft = order.addDish(draft, o.dish, map);
            else if (o.type === 'set') draft = order.setQuantity(draft, o.dish, o.raw, map);
            else if (o.type === 'remove') draft = order.removeLine(draft, o.dish);
            else draft = order.clear(draft);
          } catch {
            expect(draft).toBe(prev); // rejected operation leaves the draft untouched
          }

          // Invariants
          const ids = draft.lines.map((l) => l.dishId);
          expect(new Set(ids).size).toBe(ids.length); // at most one line per dish
          for (const l of draft.lines) {
            expect(Number.isInteger(l.quantity)).toBe(true);
            expect(l.quantity).toBeGreaterThanOrEqual(1);
            expect(l.quantity).toBeLessThanOrEqual(99);
          }
          const prices = new Map([...map].map(([id, d]) => [id, d.priceCents]));
          expect(order.subtotalCents(draft, prices)).toBe(draft.lines.reduce((s, l) => s + l.quantity * prices.get(l.dishId), 0));

          // Transition-specific checks
          if (o.type === 'add' && draft !== prev) {
            const d = map.get(o.dish);
            expect(d.visible && d.available).toBe(true);
            const was = prev.lines.find((l) => l.dishId === o.dish);
            const now = draft.lines.find((l) => l.dishId === o.dish);
            expect(now.quantity).toBe(was ? was.quantity + 1 : 1);
            expect(now.quantity).toBeLessThanOrEqual(Math.min(99, d.maxServings));
          }
          if (o.type === 'add' && draft === prev) {
            const d = map.get(o.dish);
            const was = prev.lines.find((l) => l.dishId === o.dish);
            const blocked = !(d.visible && d.available) || (was && was.quantity + 1 > Math.min(99, d.maxServings));
            expect(!!blocked).toBe(true);
          }
          if (o.type === 'remove') expect(draft.lines.map((l) => l.dishId)).toEqual(prev.lines.filter((l) => l.dishId !== o.dish).map((l) => l.dishId));
          if (o.type === 'clear') expect(draft.lines).toEqual([]);
        }
      }),
      RUNS
    );
  });

  it('refuses hidden, unavailable and deleted dishes', () => {
    const map = toMap([
      { visible: false, available: true, maxServings: 5 },
      { visible: true, available: false, maxServings: 0 },
    ]);
    const d = order.newDraft();
    expect(() => order.addDish(d, 1, map)).toThrow(/unavailable/);
    expect(() => order.addDish(d, 2, map)).toThrow(/unavailable/);
    expect(() => order.addDish(d, 99, map)).toThrow(/unavailable/);
  });

  it('tapping an existing dish past the stock limit reports the maximum', () => {
    const map = toMap([{ visible: true, available: true, maxServings: 2 }]);
    let d = order.addDish(order.newDraft(), 1, map);
    d = order.addDish(d, 1, map);
    expect(d.lines[0].quantity).toBe(2);
    expect(() => order.addDish(d, 1, map)).toThrow(/Maximum supported quantity is 2/);
  });

  it('parseDraft recovers from corrupt data', () => {
    expect(order.parseDraft('not json').lines).toEqual([]);
    expect(order.parseDraft(JSON.stringify({ submissionId: 'x', lines: [{ dishId: 1, quantity: 500 }] })).lines).toEqual([]);
  });
});
