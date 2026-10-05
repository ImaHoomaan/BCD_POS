'use strict';

// The draft Order: pure, immutable functions. The draft is stored on the server (on the
// session row), so it survives navigating to the Available Menu List and page reloads.

const crypto = require('node:crypto');
const { PosError, ValidationError } = require('../lib/errors');

const MAX_QTY = 99;
const MAX_LINES = 100;

class OrderRejected extends PosError {
  constructor(code, message, detail) {
    super(message, { status: 422, code, detail });
  }
}

// Order_Submission_Identifier: random UUIDv4 created when a new empty draft starts. It is
// constant while lines are edited or a submission is retried, and only replaced after a
// receipt has been shown (Req 7.8, 7.10).
function newDraft() {
  return { submissionId: crypto.randomUUID(), lines: [], checkoutTaxBp: null };
}

function serializeDraft(d) {
  return JSON.stringify({ submissionId: d.submissionId, lines: d.lines, checkoutTaxBp: d.checkoutTaxBp });
}

// Tolerant parse: a corrupt or missing draft becomes a fresh empty one.
function parseDraft(json) {
  try {
    const o = JSON.parse(json);
    if (!o || typeof o.submissionId !== 'string' || !Array.isArray(o.lines)) return newDraft();
    const lines = o.lines
      .filter((l) => Number.isInteger(l.dishId) && Number.isInteger(l.quantity) && l.quantity >= 1 && l.quantity <= MAX_QTY)
      .map((l) => ({ dishId: l.dishId, quantity: l.quantity }));
    const bp = Number.isInteger(o.checkoutTaxBp) ? o.checkoutTaxBp : null;
    return { submissionId: o.submissionId, lines, checkoutTaxBp: bp };
  } catch {
    return newDraft();
  }
}

// Whole number 1..99 only. Empty, non-numeric, negative, zero, decimal and >99 are rejected.
function parseQuantity(raw) {
  const text = typeof raw === 'number' ? String(raw) : typeof raw === 'string' ? raw.trim() : '';
  if (!/^\d{1,4}$/.test(text)) {
    throw new ValidationError({ quantity: 'Quantity must be a whole number from 1 to 99.' });
  }
  const q = Number(text);
  if (q < 1 || q > MAX_QTY) throw new ValidationError({ quantity: 'Quantity must be a whole number from 1 to 99.' });
  return q;
}

// catalogDish: { visible, available, maxServings } or undefined (deleted dish).
function maxOrderable(catalogDish) {
  if (!catalogDish || !catalogDish.visible || !catalogDish.available) return 0;
  return Math.min(MAX_QTY, catalogDish.maxServings);
}

const edited = (draft, lines) => ({ ...draft, lines, checkoutTaxBp: null });

function addDish(draft, dishId, catalogMap) {
  const dish = catalogMap.get(dishId);
  if (!dish || !dish.visible || !dish.available) {
    throw new OrderRejected('dish_unavailable', 'This dish is currently unavailable.');
  }
  const existing = draft.lines.find((l) => l.dishId === dishId);
  const max = maxOrderable(dish);
  if (existing) {
    if (existing.quantity + 1 > max) {
      throw new OrderRejected('quantity_limit', `Maximum supported quantity is ${max}.`, { max });
    }
    return edited(draft, draft.lines.map((l) => (l.dishId === dishId ? { ...l, quantity: l.quantity + 1 } : l)));
  }
  if (draft.lines.length >= MAX_LINES) {
    throw new OrderRejected('line_limit', `An order can have at most ${MAX_LINES} lines.`);
  }
  return edited(draft, [...draft.lines, { dishId, quantity: 1 }]);
}

function setQuantity(draft, dishId, raw, catalogMap) {
  if (!draft.lines.some((l) => l.dishId === dishId)) throw new OrderRejected('line_missing', 'That dish is not in the order.');
  const q = parseQuantity(raw);
  const max = maxOrderable(catalogMap.get(dishId));
  if (q > max) throw new OrderRejected('quantity_limit', `Maximum supported quantity is ${max}.`, { max });
  return edited(draft, draft.lines.map((l) => (l.dishId === dishId ? { ...l, quantity: q } : l)));
}

function removeLine(draft, dishId) {
  return edited(draft, draft.lines.filter((l) => l.dishId !== dishId));
}

function clear(draft) {
  return edited(draft, []);
}

// prices: Map dishId -> priceCents
function subtotalCents(draft, prices) {
  return draft.lines.reduce((s, l) => s + (prices.get(l.dishId) || 0) * l.quantity, 0);
}

module.exports = {
  MAX_QTY,
  MAX_LINES,
  OrderRejected,
  newDraft,
  serializeDraft,
  parseDraft,
  parseQuantity,
  maxOrderable,
  addDish,
  setQuantity,
  removeLine,
  clear,
  subtotalCents,
};
