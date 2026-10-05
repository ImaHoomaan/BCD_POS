'use strict';

// Availability_Status is DERIVED, never stored: a pure function of a dish's recipe and the
// current ingredient stock, computed on every read. It therefore cannot be stale, which is
// what makes Req 11.3 and 11.4 hold by construction.

const catalog = require('../db/repos/catalog');

// items: [{ qtyMilli, stockMilli }]. Returns how many whole servings current stock supports.
// An empty recipe supports 0 servings (Req 11.5).
function maxServings(items) {
  if (!items || items.length === 0) return 0;
  let m = Infinity;
  for (const it of items) m = Math.min(m, Math.floor(it.stockMilli / it.qtyMilli));
  return m;
}

// Available iff the recipe has at least one item and stock covers one serving of every item.
function isAvailable(items) {
  return !!items && items.length >= 1 && items.every((it) => it.stockMilli >= it.qtyMilli);
}

const UNAVAILABLE = Object.freeze({ available: false, maxServings: 0 });

// Returns { map: Map<dishId, {available, maxServings}>, error: boolean }.
// If the computation fails, every dish is treated as unavailable and error is set so the UI
// can say "availability could not be updated" (Req 11.9).
function availabilityMap(db) {
  try {
    const byDish = new Map();
    for (const row of catalog.getAllRecipeRows(db)) {
      if (!byDish.has(row.dishId)) byDish.set(row.dishId, []);
      byDish.get(row.dishId).push(row);
    }
    const map = new Map();
    for (const [dishId, items] of byDish) {
      map.set(dishId, { available: isAvailable(items), maxServings: maxServings(items) });
    }
    return { map, error: false };
  } catch {
    return { map: new Map(), error: true };
  }
}

function availabilityOf(map, dishId) {
  return map.get(dishId) || UNAVAILABLE;
}

module.exports = { maxServings, isAvailable, availabilityMap, availabilityOf, UNAVAILABLE };
