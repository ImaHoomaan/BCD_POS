'use strict';

const { servingCostCents } = require('../lib/money');

// items: [{ qtyMilli, unitCostCents }]. Sum first, round once half-up (Req 10.5).
function servingCost(items) {
  return servingCostCents(items);
}

// Serving_Cost minus Target_Cost; negative values keep their sign.
function marginDifference(servingCost, targetCost) {
  return servingCost - targetCost;
}

// Negative margin when Serving_Cost exceeds Selling_Price (Req 10.10).
function isNegativeMargin(servingCost, sellingPrice) {
  return servingCost > sellingPrice;
}

module.exports = { servingCost, marginDifference, isNegativeMargin };
