'use strict';

const catalog = require('../db/repos/catalog');
const { authorize, Permission } = require('../auth/rbac');
const { formatCents } = require('../lib/money');
const { availabilityMap, availabilityOf } = require('../inventory/availability');

const byName = (a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase());

// Internal catalog read used by both the Available_Menu_List and the POS terminal. It does
// not authorize; callers do. Returns visible AND hidden dishes with computed availability.
function loadCatalog(db) {
  const avail = availabilityMap(db);
  const dishes = catalog.listDishes(db).map((d) => {
    const a = availabilityOf(avail.map, d.id);
    return {
      id: d.id,
      name: d.name,
      categoryId: d.categoryId,
      categoryName: d.categoryName,
      priceCents: d.sellingPriceCents,
      price: formatCents(d.sellingPriceCents),
      visible: d.visible,
      available: a.available,
      maxServings: a.maxServings,
    };
  });
  return { dishes, availabilityError: avail.error };
}

const isOrderable = (d) => d.visible && d.available;

// Pure: groups orderable dishes by category. Categories and dishes sorted case-insensitively;
// categories with no orderable dish are omitted.
function groupOrderable(dishes) {
  const groups = new Map();
  for (const d of dishes.filter(isOrderable)) {
    if (!groups.has(d.categoryId)) groups.set(d.categoryId, { categoryId: d.categoryId, name: d.categoryName, dishes: [] });
    groups.get(d.categoryId).dishes.push({ id: d.id, name: d.name, price: d.price, priceCents: d.priceCents });
  }
  const out = [...groups.values()].sort(byName);
  for (const g of out) g.dishes.sort(byName);
  return out;
}

// Available_Menu_List (Req 8). Read-only.
function availableMenuList(db, actor) {
  authorize(actor, Permission.VIEW_AVAILABLE_MENU);
  const { dishes, availabilityError } = loadCatalog(db);
  return { groups: groupOrderable(dishes), availabilityError };
}

module.exports = { loadCatalog, groupOrderable, isOrderable, availableMenuList };
