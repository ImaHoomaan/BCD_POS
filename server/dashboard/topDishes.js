'use strict';

const sales = require('../db/repos/sales');
const { authorize, Permission } = require('../auth/rbac');
const { formatCents } = require('../lib/money');

// Pure ranking: units desc, then revenue desc, then recorded name asc (case-insensitive).
function rankDishes(rows, limit = 5) {
  return [...rows]
    .sort(
      (a, b) =>
        b.units - a.units ||
        b.revenueCents - a.revenueCents ||
        a.dishName.toLowerCase().localeCompare(b.dishName.toLowerCase())
    )
    .slice(0, limit)
    .map((r, i) => ({
      rank: i + 1,
      dishRef: r.dishRef,
      dishName: r.dishName,
      units: r.units,
      revenueCents: r.revenueCents,
      revenue: formatCents(r.revenueCents),
      isTop: i === 0, // the "Top-Selling Dish" label goes only to rank 1
    }));
}

function topDishes(db, actor, range, limit = 5) {
  authorize(actor, Permission.VIEW_DASHBOARD);
  return rankDishes(sales.dishSalesInRange(db, range.startText, range.endText), limit);
}

module.exports = { rankDishes, topDishes };
