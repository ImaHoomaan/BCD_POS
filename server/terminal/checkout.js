'use strict';

const { authorize, Permission } = require('../auth/rbac');
const { taxCents, formatCents, formatBp, evaluateTender } = require('../lib/money');
const { getTaxRateBp } = require('../menu/settings');
const { loadCatalog } = require('../menu/available');
const { OrderRejected, maxOrderable, MAX_QTY } = require('./order');

// Pure. lines: [{ unitPriceCents, quantity }]. Exact integer math; tax rounds half up.
function computeTotals(lines, taxRateBp) {
  const subtotalCents = lines.reduce((s, l) => s + l.unitPriceCents * l.quantity, 0);
  const tax = taxCents(subtotalCents, taxRateBp);
  return { subtotalCents, taxRateBp, taxCents: tax, totalCents: subtotalCents + tax };
}

function totalsView(t) {
  return {
    ...t,
    subtotal: formatCents(t.subtotalCents),
    taxRate: formatBp(t.taxRateBp),
    tax: formatCents(t.taxCents),
    total: formatCents(t.totalCents),
  };
}

// Draft -> lines priced from the live catalog (used for display and the checkout screen).
function priceDraft(draft, catalogDishes) {
  const byId = new Map(catalogDishes.map((d) => [d.id, d]));
  const lines = [];
  for (const l of draft.lines) {
    const d = byId.get(l.dishId);
    if (!d) continue; // dish was deleted since it was added; it drops out of the order
    lines.push({
      dishId: d.id,
      name: d.name,
      unitPriceCents: d.priceCents,
      unitPrice: formatCents(d.priceCents),
      quantity: l.quantity,
      lineTotalCents: d.priceCents * l.quantity,
      lineTotal: formatCents(d.priceCents * l.quantity),
      maxQuantity: maxOrderable(d),
      unavailable: !(d.visible && d.available),
    });
  }
  return lines;
}

function draftView(db, actor, draft) {
  authorize(actor, Permission.VIEW_TERMINAL);
  const { dishes } = loadCatalog(db);
  const lines = priceDraft(draft, dishes);
  const subtotal = lines.reduce((s, l) => s + l.lineTotalCents, 0);
  return {
    submissionId: draft.submissionId,
    lines,
    isEmpty: lines.length === 0,
    subtotalCents: subtotal,
    subtotal: formatCents(subtotal),
    maxQuantityLimit: MAX_QTY,
  };
}

// Opens the Checkout_Screen: snapshots the CURRENT tax rate into the draft so the rate stays
// fixed while the screen is open, even if the Owner saves a different one (Req 14.4, 14.5).
function openCheckout(db, actor, draft) {
  authorize(actor, Permission.BUILD_ORDER);
  const { dishes } = loadCatalog(db);
  const lines = priceDraft(draft, dishes);
  if (lines.length === 0) throw new OrderRejected('order_empty', 'The order is empty. Add items before checkout.');
  const taxRateBp = getTaxRateBp(db);
  const totals = computeTotals(lines, taxRateBp);
  return { draft: { ...draft, checkoutTaxBp: taxRateBp }, totals: totalsView(totals), lines };
}

function tender(actor, totalCents, raw) {
  authorize(actor, Permission.BUILD_ORDER);
  const r = evaluateTender(totalCents, raw);
  return {
    ...r,
    change: r.kind === 'sufficient' ? formatCents(r.changeCents) : undefined,
    remaining: r.kind === 'short' ? formatCents(r.remainingCents) : undefined,
  };
}

module.exports = { computeTotals, totalsView, priceDraft, draftView, openCheckout, tender };
