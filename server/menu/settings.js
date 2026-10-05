'use strict';

const catalog = require('../db/repos/catalog');
const { write } = require('../db/connection');
const { authorize, Permission } = require('../auth/rbac');
const { parseTaxRate, formatBp } = require('../lib/money');

// Tax rate in basis points. Defaults to 0 when nothing (or something unreadable) is stored.
function getTaxRateBp(db) {
  const raw = catalog.getSetting(db, 'tax_rate_bp');
  const n = Number(raw);
  return Number.isInteger(n) && n >= 0 && n <= 10000 ? n : 0;
}

function getTaxRate(db, actor) {
  authorize(actor, Permission.VIEW_MENU_MANAGEMENT);
  const bp = getTaxRateBp(db);
  return { taxRateBp: bp, taxRate: formatBp(bp) };
}

function setTaxRate(db, actor, { taxRate }) {
  authorize(actor, Permission.MANAGE_TAX_RATE);
  const bp = parseTaxRate(taxRate);
  write(db, () => catalog.setSetting(db, 'tax_rate_bp', bp));
  return { taxRateBp: bp, taxRate: formatBp(bp) };
}

module.exports = { getTaxRateBp, getTaxRate, setTaxRate };
