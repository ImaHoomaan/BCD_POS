'use strict';

const catalog = require('../db/repos/catalog');
const { write } = require('../db/connection');
const { authorize, Permission } = require('../auth/rbac');
const { Conflict, NotFound } = require('../lib/errors');
const { parseMilli, formatCents, formatMilli, MAX_RECIPE_MILLI } = require('../lib/money');
const { validatePrice, validateTargetCost, collect } = require('../lib/validation');
const costing = require('./costing');
const { availabilityMap, availabilityOf } = require('./availability');

const MAX_RECIPE_ITEMS = 50;

function itemView(r) {
  return {
    ingredientId: r.ingredientId,
    ingredientName: r.ingredientName,
    unit: r.unit,
    qtyMilli: r.qtyMilli,
    qty: formatMilli(r.qtyMilli, r.unit === 'pcs' ? 0 : 3),
    unitCostCents: r.unitCostCents,
    unitCost: formatCents(r.unitCostCents),
    stockMilli: r.stockMilli,
    lineCostCents: costing.servingCost([r]),
  };
}

// Builds the Recipe and Pricing Linker view of one dish. Serving cost is always recomputed
// from current ingredient unit costs, so a unit-cost change shows up on every dish that
// uses the ingredient (Req 10.6).
function buildView(db, dish, rows, availMap) {
  const servingCostCents = costing.servingCost(rows);
  const diff = costing.marginDifference(servingCostCents, dish.targetCostCents);
  const avail = availabilityOf(availMap, dish.id);
  return {
    dish: {
      id: dish.id,
      name: dish.name,
      categoryId: dish.categoryId,
      categoryName: dish.categoryName,
      sellingPriceCents: dish.sellingPriceCents,
      sellingPrice: formatCents(dish.sellingPriceCents),
      targetCostCents: dish.targetCostCents,
      targetCost: formatCents(dish.targetCostCents),
      visible: dish.visible,
    },
    items: rows.map(itemView),
    servingCostCents,
    servingCost: formatCents(servingCostCents),
    diffToTargetCents: diff,
    diffToTarget: formatCents(diff),
    negativeMargin: costing.isNegativeMargin(servingCostCents, dish.sellingPriceCents),
    available: avail.available,
    maxServings: avail.maxServings,
  };
}

function getRecipe(db, actor, dishId) {
  authorize(actor, Permission.VIEW_RECIPES);
  const dish = catalog.getDish(db, dishId);
  if (!dish) throw new NotFound('Dish not found.');
  return buildView(db, dish, catalog.getRecipeRows(db, dishId), availabilityMap(db).map);
}

// Overview list for the Linker: one summary row per dish.
function listRecipes(db, actor) {
  authorize(actor, Permission.VIEW_RECIPES);
  const avail = availabilityMap(db);
  const byDish = new Map();
  for (const r of catalog.getAllRecipeRows(db)) {
    if (!byDish.has(r.dishId)) byDish.set(r.dishId, []);
    byDish.get(r.dishId).push(r);
  }
  return {
    availabilityError: avail.error,
    dishes: catalog.listDishes(db).map((d) => {
      const v = buildView(db, d, byDish.get(d.id) || [], avail.map);
      return { ...v.dish, itemCount: v.items.length, servingCost: v.servingCost, servingCostCents: v.servingCostCents,
        diffToTarget: v.diffToTarget, negativeMargin: v.negativeMargin, available: v.available };
    }),
  };
}

function parseQty(ingredient, qtyText) {
  return parseMilli(qtyText, {
    field: 'quantity',
    decimals: 3,
    minMilli: 1,
    maxMilli: MAX_RECIPE_MILLI,
    label: 'Quantity per serving',
    wholeOnly: ingredient.unit === 'pcs',
  });
}

function mustGetDish(db, dishId) {
  const dish = catalog.getDish(db, dishId);
  if (!dish) throw new NotFound('Dish not found.');
  return dish;
}

function afterChange(db, dishId) {
  return buildView(db, catalog.getDish(db, dishId), catalog.getRecipeRows(db, dishId), availabilityMap(db).map);
}

function addRecipeItem(db, actor, dishId, { ingredientId, quantity }) {
  authorize(actor, Permission.MANAGE_RECIPES);
  return write(db, () => {
    mustGetDish(db, dishId);
    const ing = catalog.getIngredient(db, ingredientId);
    if (!ing) throw new NotFound('Ingredient not found.');
    const qty = parseQty(ing, quantity);
    if (catalog.getRecipeItem(db, dishId, ingredientId)) {
      throw new Conflict('duplicate_ingredient', 'This ingredient is already in the recipe.');
    }
    if (catalog.countRecipeItems(db, dishId) >= MAX_RECIPE_ITEMS) {
      throw new Conflict('recipe_limit', `A recipe can have at most ${MAX_RECIPE_ITEMS} ingredients.`);
    }
    catalog.insertRecipeItem(db, dishId, ingredientId, qty);
    return afterChange(db, dishId);
  });
}

function updateRecipeItem(db, actor, dishId, ingredientId, { quantity }) {
  authorize(actor, Permission.MANAGE_RECIPES);
  return write(db, () => {
    mustGetDish(db, dishId);
    const ing = catalog.getIngredient(db, ingredientId);
    if (!ing) throw new NotFound('Ingredient not found.');
    if (!catalog.getRecipeItem(db, dishId, ingredientId)) throw new NotFound('Recipe item not found.');
    catalog.updateRecipeItem(db, dishId, ingredientId, parseQty(ing, quantity));
    return afterChange(db, dishId);
  });
}

function removeRecipeItem(db, actor, dishId, ingredientId) {
  authorize(actor, Permission.MANAGE_RECIPES);
  return write(db, () => {
    mustGetDish(db, dishId);
    if (!catalog.getRecipeItem(db, dishId, ingredientId)) throw new NotFound('Recipe item not found.');
    catalog.deleteRecipeItem(db, dishId, ingredientId);
    return afterChange(db, dishId);
  });
}

// Linker price / target cost edit. Shares validators with the Menu Management dish editor.
function setPricing(db, actor, dishId, { sellingPrice, targetCost }) {
  authorize(actor, Permission.MANAGE_RECIPES);
  const v = collect({
    sellingPriceCents: () => validatePrice(sellingPrice),
    targetCostCents: () => validateTargetCost(targetCost),
  });
  return write(db, () => {
    mustGetDish(db, dishId);
    catalog.updatePricing(db, dishId, v.sellingPriceCents, v.targetCostCents);
    return afterChange(db, dishId);
  });
}

module.exports = { MAX_RECIPE_ITEMS, getRecipe, listRecipes, addRecipeItem, updateRecipeItem, removeRecipeItem, setPricing };
