import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import availability from '../../server/inventory/availability.js';
import helpers from '../helpers.js';
import recipes from '../../server/inventory/recipes.js';
import ingredients from '../../server/inventory/ingredients.js';
import menuAvailable from '../../server/menu/available.js';
import dishesSvc from '../../server/menu/dishes.js';

const { maxServings, isAvailable, availabilityMap } = availability;
const { makeDb, buildWorld, addUsers, actorFor } = helpers;

const RUNS = { numRuns: 300 };
const item = fc.record({ qtyMilli: fc.integer({ min: 1, max: 5000 }), stockMilli: fc.integer({ min: 0, max: 20000 }) });

describe('availability computation', () => {
  // Feature: restaurant-pos-system, Property 6: Availability computation
  it('available iff the recipe is non-empty and every stock covers one serving', () => {
    fc.assert(
      fc.property(fc.array(item, { maxLength: 6 }), (items) => {
        const expected = items.length >= 1 && items.every((i) => i.stockMilli >= i.qtyMilli);
        expect(isAvailable(items)).toBe(expected);
        const expectedMax = items.length === 0 ? 0 : Math.min(...items.map((i) => Math.floor(i.stockMilli / i.qtyMilli)));
        expect(maxServings(items)).toBe(expectedMax);
        expect(isAvailable(items)).toBe(maxServings(items) >= 1);
      }),
      RUNS
    );
  });

  // Same result when the state goes through the database, services and availabilityMap.
  it('matches the persisted computation after stock and recipe edits', () => {
    fc.assert(
      fc.property(fc.array(item, { minLength: 0, maxLength: 4 }), (items) => {
        const db = makeDb();
        addUsers(db);
        const spec = {
          ingredients: items.map((i, n) => ({ name: `I${n}`, stockMilli: i.stockMilli })),
          dishes: [{ name: 'D', priceCents: 100, recipe: items.map((i, n) => [n, i.qtyMilli]) }],
        };
        const w = buildWorld(db, spec);
        const got = availabilityMap(db).map.get(w.dishIds[0]);
        if (items.length === 0) expect(got).toBeUndefined(); // no recipe rows: treated as unavailable
        else expect(got.available).toBe(items.every((i) => i.stockMilli >= i.qtyMilli));
        db.close();
      }),
      { numRuns: 60 }
    );
  });

  // Feature: restaurant-pos-system, Property 7: Availability monotonicity
  it('more stock or smaller quantities never reduce availability', () => {
    fc.assert(
      fc.property(fc.array(item, { minLength: 1, maxLength: 5 }), fc.array(fc.nat(500), { minLength: 5, maxLength: 5 }), fc.array(fc.nat(50), { minLength: 5, maxLength: 5 }), (items, addStock, cut) => {
        const better = items.map((i, n) => ({
          stockMilli: i.stockMilli + addStock[n],
          qtyMilli: Math.max(1, i.qtyMilli - cut[n]),
        }));
        if (isAvailable(items)) expect(isAvailable(better)).toBe(true);
        expect(maxServings(better)).toBeGreaterThanOrEqual(maxServings(items));
        // and the reverse edit never makes an unavailable dish available
        if (!isAvailable(items)) expect(isAvailable(items.map((i) => ({ ...i, stockMilli: Math.max(0, i.stockMilli - 1) })))).toBe(false);
      }),
      RUNS
    );
  });

  it('zero stock, exactly one serving, and empty recipe', () => {
    expect(isAvailable([{ qtyMilli: 100, stockMilli: 0 }])).toBe(false);
    expect(isAvailable([{ qtyMilli: 100, stockMilli: 100 }])).toBe(true);
    expect(isAvailable([])).toBe(false);
  });
});

describe('availability follows owner edits immediately', () => {
  it('ingredient edit and recipe edit change the Available Menu List', () => {
    const db = makeDb({ seed: true });
    const owner = actorFor(db, 'Owner');
    const cashier = actorFor(db, 'Cashier 1');
    const names = () => menuAvailable.availableMenuList(db, cashier).groups.flatMap((g) => g.dishes.map((d) => d.name));
    expect(names()).toContain('French Fries');
    expect(names()).not.toContain('Iced Cola'); // seeded low stock
    expect(names()).not.toContain("Chef's Special"); // seeded hidden

    const cola = ingredients.listIngredients(db, owner).find((i) => i.name === 'Cola Syrup');
    ingredients.updateIngredient(db, owner, cola.id, { name: cola.name, unit: cola.unit, unitCost: cola.unitCost, stock: '500' });
    expect(names()).toContain('Iced Cola');

    const fries = dishesSvc.listDishes(db, owner).dishes.find((d) => d.name === 'French Fries');
    const potato = ingredients.listIngredients(db, owner).find((i) => i.name === 'Potato');
    recipes.removeRecipeItem(db, owner, fries.id, potato.id);
    recipes.removeRecipeItem(db, owner, fries.id, ingredients.listIngredients(db, owner).find((i) => i.name === 'Cooking Oil').id);
    expect(names()).not.toContain('French Fries'); // empty recipe -> unavailable

    dishesSvc.setVisibility(db, owner, fries.id, false);
    dishesSvc.setVisibility(db, owner, fries.id, true);
    db.close();
  });
});
