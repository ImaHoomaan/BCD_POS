'use strict';

const catalog = require('../db/repos/catalog');
const { write } = require('../db/connection');
const { authorize, Permission } = require('../auth/rbac');
const { Conflict, NotFound, ValidationError } = require('../lib/errors');
const { parseMoney, parseMilli, formatCents, formatMilli, MAX_STOCK_MILLI } = require('../lib/money');
const { validateName, validateUnit, collect } = require('../lib/validation');

function toView(r) {
  return {
    id: r.id,
    name: r.name,
    unit: r.unit,
    unitCostCents: r.unitCostCents,
    unitCost: formatCents(r.unitCostCents),
    stockMilli: r.stockMilli,
    stock: formatMilli(r.stockMilli, r.unit === 'pcs' ? 0 : 2),
  };
}

function parseInput(input) {
  return collect({
    name: () => validateName(input.name, { label: 'Ingredient name', max: 100 }),
    unit: () => validateUnit(input.unit),
    unitCostCents: () => parseMoney(input.unitCost, { field: 'unitCost', label: 'Unit cost' }),
    stockMilli: () =>
      parseMilli(input.stock, {
        field: 'stock',
        decimals: 2,
        maxMilli: MAX_STOCK_MILLI,
        label: 'Stock quantity',
        wholeOnly: input.unit === 'pcs',
      }),
  });
}

function listIngredients(db, actor) {
  authorize(actor, Permission.VIEW_INGREDIENTS);
  return catalog.listIngredients(db).map(toView);
}

function createIngredient(db, actor, input) {
  authorize(actor, Permission.MANAGE_INGREDIENTS);
  const v = parseInput(input || {});
  return write(db, () => {
    if (catalog.findIngredientByName(db, v.name)) {
      throw new Conflict('duplicate_name', 'An ingredient with this name already exists.');
    }
    const id = catalog.insertIngredient(db, v);
    return toView(catalog.getIngredient(db, id));
  });
}

function updateIngredient(db, actor, id, input) {
  authorize(actor, Permission.MANAGE_INGREDIENTS);
  const v = parseInput(input || {});
  return write(db, () => {
    const existing = catalog.getIngredient(db, id);
    if (!existing) throw new NotFound('Ingredient not found.');
    if (catalog.findIngredientByName(db, v.name, id)) {
      throw new Conflict('duplicate_name', 'An ingredient with this name already exists.');
    }
    // Recipes must stay whole-number for pcs ingredients (Req 9.9).
    if (v.unit === 'pcs' && catalog.recipeItemsForIngredient(db, id).some((r) => r.qtyMilli % 1000 !== 0)) {
      throw new ValidationError({ unit: 'Cannot switch to pcs while recipes use fractional quantities of this ingredient.' });
    }
    catalog.updateIngredient(db, id, v);
    return toView(catalog.getIngredient(db, id));
  });
}

function deleteIngredient(db, actor, id) {
  authorize(actor, Permission.MANAGE_INGREDIENTS);
  return write(db, () => {
    if (!catalog.getIngredient(db, id)) throw new NotFound('Ingredient not found.');
    const dishNames = catalog.dishesUsingIngredient(db, id);
    if (dishNames.length > 0) {
      throw new Conflict('in_use', `This ingredient is used by: ${dishNames.join(', ')}.`, { dishNames });
    }
    catalog.deleteIngredient(db, id);
    return { deleted: true };
  });
}

module.exports = { listIngredients, createIngredient, updateIngredient, deleteIngredient };
