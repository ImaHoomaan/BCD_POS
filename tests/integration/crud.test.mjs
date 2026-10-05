import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import fc from 'fast-check';

const require = createRequire(import.meta.url);
const { makeDb, addUsers, actorFor, buildWorld } = require('../helpers');
const { dumpDatabase, openDatabase } = require('../../server/db/connection');
const { initDatabase } = require('../../server/db/init');
const ingredients = require('../../server/inventory/ingredients');
const recipes = require('../../server/inventory/recipes');
const categories = require('../../server/menu/categories');
const dishes = require('../../server/menu/dishes');
const settings = require('../../server/menu/settings');
const { formatCents, formatMilli } = require('../../server/lib/money');
const { ValidationError, Conflict } = require('../../server/lib/errors');

const RUNS = { numRuns: 120 };

function fresh() {
  const db = makeDb();
  addUsers(db);
  return { db, owner: actorFor(db, 'Owner') };
}

const MONEY_RE = /^\d{1,6}(\.\d{1,2})?$/;
const toCents = (t) => {
  const [w, f = ''] = t.trim().split('.');
  return Number(w) * 100 + Number(f.padEnd(2, '0'));
};

// Text generators that mix valid and invalid shapes.
const moneyText = fc.oneof(
  fc.integer({ min: 0, max: 99999999 }).map(formatCents),
  fc.constantFrom('', ' ', '-1', '1.234', 'abc', '1000000.00', '0', '0.00', '5', '12.5', '.5', '1e2'),
  fc.string({ maxLength: 6 })
);

describe('ingredients', () => {
  // Feature: restaurant-pos-system, Property 30: Ingredient validation and name uniqueness
  it('accepts exactly valid, non-duplicate ingredients and reads back what was submitted', () => {
    const name = fc.oneof(fc.string({ maxLength: 12 }), fc.constantFrom('', '   ', ' EXISTING ', 'existing', 'a'.repeat(100), 'a'.repeat(101), 'Flour'));
    const input = fc.record({ name, unit: fc.constantFrom('grams', 'ml', 'pcs', 'kg', ''), unitCost: moneyText, stock: moneyText });
    fc.assert(
      fc.property(input, (i) => {
        const { db, owner } = fresh();
        ingredients.createIngredient(db, owner, { name: 'Existing', unit: 'grams', unitCost: '1.00', stock: '5' });
        const before = dumpDatabase(db);

        const trimmed = i.name.trim();
        const okName = trimmed.length >= 1 && [...trimmed].length <= 100;
        const okUnit = ['grams', 'ml', 'pcs'].includes(i.unit);
        const okCost = MONEY_RE.test(i.unitCost.trim());
        const okStock = MONEY_RE.test(i.stock.trim()) && (i.unit !== 'pcs' || /^\d+(\.0{1,2})?$/.test(i.stock.trim()));
        const dup = trimmed.toLowerCase() === 'existing';

        let err;
        let created;
        try {
          created = ingredients.createIngredient(db, owner, i);
        } catch (e) {
          err = e;
        }
        if (okName && okUnit && okCost && okStock && !dup) {
          expect(err).toBeUndefined();
          const row = ingredients.listIngredients(db, owner).find((r) => r.id === created.id);
          expect(row).toMatchObject({ name: trimmed, unit: i.unit, unitCostCents: toCents(i.unitCost) });
          expect(row.stockMilli).toBe(toCents(i.stock) * 10);
        } else if (dup && okName && okUnit && okCost && okStock) {
          expect(err).toBeInstanceOf(Conflict);
          expect(err.code).toBe('duplicate_name');
          expect(dumpDatabase(db)).toBe(before);
        } else {
          expect(err).toBeInstanceOf(ValidationError);
          const f = err.fields;
          expect(!!f.name).toBe(!okName);
          expect(!!f.unit).toBe(!okUnit);
          expect(!!f.unitCost).toBe(!okCost);
          expect(!!f.stock).toBe(!okStock); // every invalid field is reported
          expect(dumpDatabase(db)).toBe(before);
        }
        // list is always sorted alphabetically (case-insensitive)
        const names = ingredients.listIngredients(db, owner).map((r) => r.name.toLowerCase());
        expect(names).toEqual([...names].sort());
        db.close();
      }),
      RUNS
    );
  });

  // Feature: restaurant-pos-system, Property 31: Ingredient deletion guard
  it('deletes only unused ingredients and names the dishes that block a deletion', () => {
    const recipeArb = fc.array(fc.uniqueArray(fc.integer({ min: 0, max: 3 }), { maxLength: 3 }), { minLength: 1, maxLength: 3 });
    fc.assert(
      fc.property(recipeArb, (dishRecipes) => {
        const { db, owner } = fresh();
        const w = buildWorld(db, {
          ingredients: [0, 1, 2, 3].map((i) => ({ name: `Ing${i}`, stockMilli: 1000 })),
          dishes: dishRecipes.map((items, d) => ({ name: `Dish${d}`, priceCents: 100, recipe: items.map((i) => [i, 100]) })),
        });
        w.ingIds.forEach((id, idx) => {
          const users = dishRecipes.map((items, d) => (items.includes(idx) ? `Dish${d}` : null)).filter(Boolean);
          const before = dumpDatabase(db);
          if (users.length === 0) {
            ingredients.deleteIngredient(db, owner, id);
            expect(ingredients.listIngredients(db, owner).some((r) => r.id === id)).toBe(false);
          } else {
            let err;
            try {
              ingredients.deleteIngredient(db, owner, id);
            } catch (e) {
              err = e;
            }
            expect(err).toBeInstanceOf(Conflict);
            expect(err.detail.dishNames).toEqual(users);
            expect(dumpDatabase(db)).toBe(before);
          }
        });
        db.close();
      }),
      { numRuns: 60 }
    );
  });

  it('pcs ingredients only take whole numbers; stock edits change availability at once', () => {
    const { db, owner } = fresh();
    expect(() => ingredients.createIngredient(db, owner, { name: 'Egg', unit: 'pcs', unitCost: '0.20', stock: '2.5' })).toThrow(/whole number/);
    const ok = ingredients.createIngredient(db, owner, { name: 'Egg', unit: 'pcs', unitCost: '0.20', stock: '12' });
    expect(ok.stock).toBe('12');
    db.close();
  });
});

describe('recipes and costing', () => {
  // Feature: restaurant-pos-system, Property 32: Serving cost and margin
  it('matches the exact oracle, flags negative margins, and only touches dishes using a changed ingredient', () => {
    const itemsArb = fc.uniqueArray(fc.tuple(fc.integer({ min: 0, max: 2 }), fc.integer({ min: 1, max: 2_000_000 }), fc.integer({ min: 0, max: 20000 })), { selector: (t) => t[0], minLength: 1, maxLength: 3 });
    fc.assert(
      fc.property(itemsArb, fc.integer({ min: 1, max: 100000 }), fc.integer({ min: 0, max: 100000 }), fc.integer({ min: 0, max: 20000 }), (items, price, target, newCost) => {
        const { db, owner } = fresh();
        const costs = [0, 1, 2].map(() => 1);
        items.forEach(([ing, , c]) => (costs[ing] = c));
        const w = buildWorld(db, {
          ingredients: [0, 1, 2].map((i) => ({ name: `I${i}`, stockMilli: 999999000, unitCostCents: costs[i] })),
          dishes: [
            { name: 'Main', priceCents: price, recipe: [] },
            { name: 'Other', priceCents: price, recipe: [[0, 1000]] },
          ],
        });
        const dishId = w.dishIds[0];
        recipes.setPricing(db, owner, dishId, { sellingPrice: formatCents(price), targetCost: formatCents(target) });
        let view;
        for (const [ing, qty] of items) view = recipes.addRecipeItem(db, owner, dishId, { ingredientId: w.ingIds[ing], quantity: formatMilli(qty, 3) });

        const oracle = (list, c) => Number((list.reduce((s, [ing, q]) => s + BigInt(q) * BigInt(c[ing]), 0n) + 500n) / 1000n);
        const expected = oracle(items, costs);
        expect(view.servingCostCents).toBe(expected);
        expect(view.diffToTargetCents).toBe(expected - target);
        expect(view.diffToTarget).toBe(formatCents(expected - target)); // negative keeps its minus sign
        expect(view.negativeMargin).toBe(expected > price);

        // Change one unit cost: dishes using it are recomputed, others are not.
        const changed = items[0][0];
        const otherBefore = recipes.getRecipe(db, owner, w.dishIds[1]).servingCostCents;
        const ing = ingredients.listIngredients(db, owner).find((r) => r.id === w.ingIds[changed]);
        ingredients.updateIngredient(db, owner, ing.id, { name: ing.name, unit: ing.unit, unitCost: formatCents(newCost), stock: ing.stock });
        const costs2 = [...costs];
        costs2[changed] = newCost;
        expect(recipes.getRecipe(db, owner, dishId).servingCostCents).toBe(oracle(items, costs2));
        const otherAfter = recipes.getRecipe(db, owner, w.dishIds[1]).servingCostCents;
        if (changed === 0) expect(otherAfter).toBe(oracle([[0, 1000]], costs2));
        else expect(otherAfter).toBe(otherBefore);
        db.close();
      }),
      { numRuns: 60 }
    );
  });

  // Feature: restaurant-pos-system, Property 34: Recipe item rules
  it('enforces quantity, duplicate and removal rules without ever corrupting the recipe', () => {
    const qtyText = fc.oneof(
      fc.integer({ min: 1, max: 5_000_000 }).map((m) => formatMilli(m, 3)),
      fc.constantFrom('0', '0.000', '-1', '1.0005', 'x', '', '999999.999', '1000000', '2.5', '3')
    );
    const op = fc.record({
      type: fc.constantFrom('add', 'add', 'edit', 'remove'),
      ing: fc.integer({ min: 0, max: 3 }), // 3 is a pcs ingredient
      qty: qtyText,
    });
    fc.assert(
      fc.property(fc.array(op, { maxLength: 25 }), (ops) => {
        const { db, owner } = fresh();
        const w = buildWorld(db, {
          ingredients: [
            { name: 'G', stockMilli: 1000 }, { name: 'H', stockMilli: 1000 }, { name: 'J', stockMilli: 1000 },
            { name: 'P', unit: 'pcs', stockMilli: 1000 },
          ],
          dishes: [{ name: 'D', priceCents: 100, recipe: [] }],
        });
        const model = new Map(); // ingredient index -> milli
        const validQty = (text, ing) => {
          if (!/^\d{1,6}(\.\d{1,3})?$/.test(text)) return null;
          const [a, b = ''] = text.split('.');
          const milli = Number(a) * 1000 + Number(b.padEnd(3, '0'));
          if (milli < 1 || milli > 999999999) return null;
          if (ing === 3 && milli % 1000 !== 0) return null;
          return milli;
        };
        for (const o of ops) {
          const before = dumpDatabase(db);
          const id = w.ingIds[o.ing];
          const q = validQty(o.qty, o.ing);
          let err;
          try {
            if (o.type === 'add') recipes.addRecipeItem(db, owner, w.dishIds[0], { ingredientId: id, quantity: o.qty });
            else if (o.type === 'edit') recipes.updateRecipeItem(db, owner, w.dishIds[0], id, { quantity: o.qty });
            else recipes.removeRecipeItem(db, owner, w.dishIds[0], id);
          } catch (e) {
            err = e;
          }
          if (o.type === 'add') {
            if (q === null) expect(err).toBeInstanceOf(ValidationError);
            else if (model.has(o.ing)) expect(err.code).toBe('duplicate_ingredient');
            else { expect(err).toBeUndefined(); model.set(o.ing, q); }
          } else if (o.type === 'edit') {
            if (!model.has(o.ing)) expect(err).toBeDefined();
            else if (q === null) expect(err).toBeInstanceOf(ValidationError);
            else { expect(err).toBeUndefined(); model.set(o.ing, q); }
          } else if (model.has(o.ing)) {
            expect(err).toBeUndefined();
            model.delete(o.ing);
          } else expect(err).toBeDefined();
          if (err) expect(dumpDatabase(db)).toBe(before); // every rejection leaves the recipe unchanged

          const stored = new Map(recipes.getRecipe(db, owner, w.dishIds[0]).items.map((i) => [w.ingIds.indexOf(i.ingredientId), i.qtyMilli]));
          expect(stored).toEqual(model);
        }
        db.close();
      }),
      { numRuns: 60 }
    );
  });

  it('rejects a 51st recipe item', () => {
    const { db, owner } = fresh();
    const w = buildWorld(db, {
      ingredients: Array.from({ length: 51 }, (_, i) => ({ name: `I${i}`, stockMilli: 1000 })),
      dishes: [{ name: 'Big', priceCents: 100, recipe: [] }],
    });
    for (let i = 0; i < 50; i++) recipes.addRecipeItem(db, owner, w.dishIds[0], { ingredientId: w.ingIds[i], quantity: '1' });
    expect(() => recipes.addRecipeItem(db, owner, w.dishIds[0], { ingredientId: w.ingIds[50], quantity: '1' })).toThrow(/at most 50/);
    expect(recipes.getRecipe(db, owner, w.dishIds[0]).items).toHaveLength(50);
    db.close();
  });
});

describe('dishes', () => {
  // Feature: restaurant-pos-system, Property 33: Dish validation
  it('saves exactly valid dishes (visible on creation) and reports every invalid field', () => {
    const input = fc.record({
      name: fc.oneof(fc.string({ maxLength: 10 }), fc.constantFrom('', '   ', 'x'.repeat(100), 'x'.repeat(101))),
      category: fc.constantFrom('valid', 'missing', 'null'),
      sellingPrice: moneyText,
      targetCost: fc.oneof(moneyText, fc.constant(undefined)),
    });
    fc.assert(
      fc.property(input, (i) => {
        const { db, owner } = fresh();
        const cat = categories.createCategory(db, owner, { name: 'Mains' });
        const categoryId = i.category === 'valid' ? cat.id : i.category === 'missing' ? 9999 : null;
        const before = dumpDatabase(db);

        const t = i.name.trim();
        const okName = t.length >= 1 && [...t].length <= 100;
        const okPrice = MONEY_RE.test(i.sellingPrice.trim()) && toCents(i.sellingPrice) >= 1;
        const okTarget = i.targetCost === undefined || i.targetCost === '' || MONEY_RE.test(i.targetCost.trim());
        const okCat = i.category === 'valid';

        let err;
        let saved;
        try {
          saved = dishes.saveDish(db, owner, null, { name: i.name, categoryId, sellingPrice: i.sellingPrice, targetCost: i.targetCost });
        } catch (e) {
          err = e;
        }
        if (okName && okPrice && okTarget && okCat) {
          expect(err).toBeUndefined();
          expect(saved).toMatchObject({ name: t, categoryId: cat.id, sellingPriceCents: toCents(i.sellingPrice), visible: true });
          expect(saved.targetCostCents).toBe(i.targetCost === undefined || i.targetCost === '' ? 0 : toCents(i.targetCost));
        } else {
          expect(err).toBeInstanceOf(ValidationError);
          expect(!!err.fields.name).toBe(!okName);
          expect(!!err.fields.sellingPrice).toBe(!okPrice);
          expect(!!err.fields.targetCost).toBe(!okTarget);
          expect(!!err.fields.categoryId).toBe(!okCat);
          expect(dumpDatabase(db)).toBe(before);
        }
        db.close();
      }),
      RUNS
    );
  });

  it('delete needs confirmation, and visibility toggling twice restores the state', () => {
    const { db, owner } = fresh();
    const w = buildWorld(db, { ingredients: [{ name: 'A', stockMilli: 9999 }], dishes: [{ name: 'Soup', priceCents: 500, recipe: [[0, 100]] }] });
    const id = w.dishIds[0];
    const before = dumpDatabase(db);
    expect(dishes.deleteDish(db, owner, id, false)).toMatchObject({ deleted: false, needsConfirmation: true, dishName: 'Soup' });
    expect(dumpDatabase(db)).toBe(before);
    dishes.setVisibility(db, owner, id, false);
    dishes.setVisibility(db, owner, id, true);
    expect(dumpDatabase(db)).toBe(before);
    expect(dishes.deleteDish(db, owner, id, true).deleted).toBe(true);
    expect(dishes.listDishes(db, owner).dishes).toHaveLength(0);
    db.close();
  });
});

describe('categories', () => {
  // Feature: restaurant-pos-system, Property 35: Category rules
  it('follows the reference model for any sequence of create, rename and delete', () => {
    const name = fc.oneof(fc.constantFrom('Mains', 'mains', ' MAINS ', 'Drinks', 'Desserts', '', '   ', 'x'.repeat(51), 'y'.repeat(50)), fc.string({ maxLength: 6 }));
    const op = fc.record({ type: fc.constantFrom('create', 'create', 'rename', 'delete'), idx: fc.nat(5), name });
    fc.assert(
      fc.property(fc.array(op, { maxLength: 25 }), (ops) => {
        const { db, owner } = fresh();
        const model = []; // { id, name, dishes }
        const check = (text) => {
          const t = text.trim();
          if (t.length === 0) return 'empty';
          if ([...t].length > 50) return 'too long';
          return t;
        };
        for (const o of ops) {
          const before = dumpDatabase(db);
          let err;
          if (o.type === 'create') {
            const v = check(o.name);
            try {
              const c = categories.createCategory(db, owner, { name: o.name });
              model.push({ id: c.id, name: v, dishes: 0 });
              // some categories receive dishes so that deletion is blocked
              if (c.id % 2 === 0) {
                dishes.saveDish(db, owner, null, { name: `Dish ${c.id}`, categoryId: c.id, sellingPrice: '1.00' });
                model[model.length - 1].dishes = 1;
              }
              expect(['empty', 'too long']).not.toContain(v);
              expect(model.slice(0, -1).some((m) => m.name.toLowerCase() === v.toLowerCase())).toBe(false);
            } catch (e) {
              err = e;
              const dup = ['empty', 'too long'].includes(v) ? false : model.some((m) => m.name.toLowerCase() === v.toLowerCase());
              expect(e).toBeInstanceOf(ValidationError);
              expect(e.fields.name).toMatch(v === 'empty' ? /empty/ : v === 'too long' ? /too long/ : /duplicate/);
              expect(v === 'empty' || v === 'too long' || dup).toBe(true);
            }
          } else if (model.length > 0) {
            const m = model[o.idx % model.length];
            if (o.type === 'rename') {
              const v = check(o.name);
              try {
                categories.renameCategory(db, owner, m.id, { name: o.name });
                expect(['empty', 'too long']).not.toContain(v);
                expect(model.some((x) => x !== m && x.name.toLowerCase() === v.toLowerCase())).toBe(false);
                m.name = v;
              } catch (e) {
                err = e;
                expect(e).toBeInstanceOf(ValidationError);
              }
            } else {
              try {
                categories.deleteCategory(db, owner, m.id);
                expect(m.dishes).toBe(0);
                model.splice(model.indexOf(m), 1);
              } catch (e) {
                err = e;
                expect(e.code).toBe('category_not_empty');
                expect(e.detail.count).toBe(m.dishes);
              }
            }
          }
          if (err) expect(dumpDatabase(db)).toBe(before);
          const listed = categories.listCategories(db, owner);
          expect(listed.map((c) => [c.id, c.name, c.dishCount]).sort()).toEqual(model.map((m) => [m.id, m.name, m.dishes]).sort());
        }
        db.close();
      }),
      { numRuns: 60 }
    );
  });
});

describe('tax rate', () => {
  // Feature: restaurant-pos-system, Property 36: Tax rate validation and persistence
  it('accepts exactly 0..100 with at most 2 decimals; rejected input keeps the old rate; default is 0', () => {
    const text = fc.oneof(
      fc.integer({ min: 0, max: 10000 }).map((bp) => formatCents(bp)),
      fc.constantFrom('', ' ', '-1', '-0.01', '100.01', '100', '0', '8.255', 'abc', '1e1', '7.5', '.5', '10.'),
      fc.string({ maxLength: 6 })
    );
    fc.assert(
      fc.property(fc.array(text, { minLength: 1, maxLength: 8 }), (inputs) => {
        const { db, owner } = fresh();
        expect(settings.getTaxRateBp(db)).toBe(0); // nothing stored -> 0 percent
        let stored = 0;
        for (const t of inputs) {
          const m = /^(\d{1,3})(?:\.(\d{1,2}))?$/.exec(t.trim());
          const valid = !!m && Number(m[1]) * 100 + Number((m[2] || '').padEnd(2, '0') || 0) <= 10000;
          try {
            const r = settings.setTaxRate(db, owner, { taxRate: t });
            expect(valid).toBe(true);
            stored = Number(m[1]) * 100 + Number((m[2] || '').padEnd(2, '0') || 0);
            expect(r.taxRateBp).toBe(stored);
          } catch (e) {
            expect(valid).toBe(false);
            expect(e).toBeInstanceOf(ValidationError);
          }
          expect(settings.getTaxRateBp(db)).toBe(stored);
        }
        db.close();
      }),
      RUNS
    );
  });

  it('survives closing and reopening the database', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pos-tax-'));
    try {
      const file = path.join(dir, 'pos.db');
      initDatabase(file);
      let db = openDatabase(file);
      addUsers(db);
      settings.setTaxRate(db, actorFor(db, 'Owner'), { taxRate: '8.25' });
      db.close();
      db = openDatabase(file);
      expect(settings.getTaxRateBp(db)).toBe(825);
      db.close();
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
