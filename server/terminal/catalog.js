'use strict';

const { authorize, Permission } = require('../auth/rbac');
const { loadCatalog, isOrderable } = require('../menu/available');

const byName = (a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase());

// POS terminal catalog. Categories are shown only when they hold at least one Orderable_Dish
// (Req 5.1), so the category list always equals the Available_Menu_List's. Inside a category
// the terminal also shows visible-but-unavailable dishes, labelled and disabled (Req 11.6).
function terminalCatalog(db, actor) {
  authorize(actor, Permission.VIEW_TERMINAL);
  const { dishes, availabilityError } = loadCatalog(db);
  const categories = new Map();
  for (const d of dishes.filter(isOrderable)) {
    if (!categories.has(d.categoryId)) categories.set(d.categoryId, { id: d.categoryId, name: d.categoryName, dishes: [] });
  }
  for (const d of dishes.filter((x) => x.visible)) {
    const cat = categories.get(d.categoryId);
    if (cat) {
      cat.dishes.push({ id: d.id, name: d.name, price: d.price, priceCents: d.priceCents, available: d.available, maxServings: d.maxServings });
    }
  }
  const out = [...categories.values()].sort(byName);
  for (const c of out) c.dishes.sort(byName);
  return { categories: out, availabilityError };
}

module.exports = { terminalCatalog };
