'use strict';

const catalog = require('../db/repos/catalog');
const { write } = require('../db/connection');
const { authorize, Permission } = require('../auth/rbac');
const { NotFound, ValidationError } = require('../lib/errors');
const { formatCents } = require('../lib/money');
const { validateName, validatePrice, validateTargetCost, collect } = require('../lib/validation');
const { availabilityMap, availabilityOf } = require('../inventory/availability');

function toView(d, avail) {
  return {
    id: d.id,
    name: d.name,
    categoryId: d.categoryId,
    categoryName: d.categoryName,
    sellingPriceCents: d.sellingPriceCents,
    sellingPrice: formatCents(d.sellingPriceCents),
    targetCostCents: d.targetCostCents,
    targetCost: formatCents(d.targetCostCents),
    visible: d.visible,
    available: avail.available,
    outOfStock: !avail.available, // out-of-stock indicator (Req 11.7)
    maxServings: avail.maxServings,
  };
}

// Lists ALL dishes, including hidden ones, with their computed availability.
function listDishes(db, actor) {
  authorize(actor, Permission.VIEW_MENU_MANAGEMENT);
  const avail = availabilityMap(db);
  return {
    availabilityError: avail.error,
    dishes: catalog.listDishes(db).map((d) => toView(d, availabilityOf(avail.map, d.id))),
  };
}

// Creates (dishId null) or edits a dish. Shares validators with the Recipe and Pricing Linker.
// New dishes are visible and default to a 0.00 target cost (set later in the Linker).
function saveDish(db, actor, dishId, input) {
  authorize(actor, Permission.MANAGE_DISHES);
  const i = input || {};
  const v = collect({
    name: () => validateName(i.name, { label: 'Dish name', max: 100 }),
    categoryId: () => {
      if (!Number.isInteger(i.categoryId)) throw new ValidationError({ categoryId: 'Category is required.' });
      // Checked here (not only inside the write) so that every invalid field is reported together.
      if (!catalog.getCategory(db, i.categoryId)) throw new ValidationError({ categoryId: 'Category does not exist.' });
      return i.categoryId;
    },
    sellingPriceCents: () => validatePrice(i.sellingPrice),
    targetCostCents: () => (i.targetCost === undefined || i.targetCost === '' ? null : validateTargetCost(i.targetCost)),
  });
  return write(db, () => {
    if (!catalog.getCategory(db, v.categoryId)) throw new ValidationError({ categoryId: 'Category does not exist.' });
    let id = dishId;
    if (dishId === null || dishId === undefined) {
      id = catalog.insertDish(db, { ...v, targetCostCents: v.targetCostCents ?? 0 });
    } else {
      const existing = catalog.getDish(db, dishId);
      if (!existing) throw new NotFound('Dish not found.');
      catalog.updateDish(db, dishId, { ...v, targetCostCents: v.targetCostCents ?? existing.targetCostCents });
    }
    const avail = availabilityMap(db);
    return toView(catalog.getDish(db, id), availabilityOf(avail.map, id));
  });
}

function setVisibility(db, actor, dishId, visible) {
  authorize(actor, Permission.MANAGE_DISHES);
  return write(db, () => {
    if (!catalog.getDish(db, dishId)) throw new NotFound('Dish not found.');
    catalog.setDishVisible(db, dishId, !!visible);
    return toView(catalog.getDish(db, dishId), availabilityOf(availabilityMap(db).map, dishId));
  });
}

// Deletion needs explicit confirmation (Req 13.8). Without it nothing changes and the
// caller receives the dish name to put in the confirmation prompt. Past Order_Lines keep
// their snapshots because order_lines.dish_ref is not a foreign key.
function deleteDish(db, actor, dishId, confirmed) {
  authorize(actor, Permission.MANAGE_DISHES);
  return write(db, () => {
    const dish = catalog.getDish(db, dishId);
    if (!dish) throw new NotFound('Dish not found.');
    if (confirmed !== true) return { deleted: false, needsConfirmation: true, dishName: dish.name };
    catalog.deleteDish(db, dishId);
    return { deleted: true, dishName: dish.name };
  });
}

module.exports = { listDishes, saveDish, setVisibility, deleteDish };
