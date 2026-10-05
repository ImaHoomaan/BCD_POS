'use strict';

// Exact arithmetic helpers. No floating point is used anywhere in money or stock paths.
//   money            -> integer cents
//   stock / recipe   -> integer milli-units (x1000)
//   tax rate         -> integer basis points (hundredths of a percent)
// Products that may exceed 2^53 (tax, serving cost) are computed with BigInt.

const { ValidationError } = require('./errors');

const MAX_MONEY_CENTS = 99999999; // 999,999.99
const MAX_STOCK_MILLI = 999999990; // 999,999.99 (2 decimals)
const MAX_RECIPE_MILLI = 999999999; // 999,999.999 (3 decimals)

function fail(field, message) {
  throw new ValidationError({ [field]: message });
}

function toText(value) {
  return typeof value === 'string' ? value.trim() : typeof value === 'number' ? String(value) : '';
}

// Strict grammar: up to 6 integer digits, optional '.' and 1..decimals digits.
function parseFixed(text, decimals) {
  const re = new RegExp(`^(\\d{1,6})(?:\\.(\\d{1,${decimals}}))?$`);
  const m = re.exec(text);
  if (!m) return null;
  const frac = (m[2] || '').padEnd(decimals, '0');
  return { whole: Number(m[1]), frac: frac === '' ? 0 : Number(frac), decimals };
}

// Parses a monetary amount like "12.50" into integer cents.
function parseMoney(input, { field = 'amount', minCents = 0, maxCents = MAX_MONEY_CENTS, label = 'Amount' } = {}) {
  const text = toText(input);
  if (text === '') fail(field, `${label} is required.`);
  const p = parseFixed(text, 2);
  if (!p) fail(field, `${label} must be a number with at most 2 decimal places.`);
  const cents = p.whole * 100 + p.frac;
  if (cents < minCents || cents > maxCents) {
    fail(field, `${label} must be between ${formatCents(minCents)} and ${formatCents(maxCents)}.`);
  }
  return cents;
}

function formatCents(cents) {
  const neg = cents < 0;
  const abs = Math.abs(cents);
  const whole = Math.floor(abs / 100);
  const frac = String(abs % 100).padStart(2, '0');
  return `${neg ? '-' : ''}${whole}.${frac}`;
}

// Parses a quantity into milli-units. decimals = 2 for stock, 3 for recipe quantities.
function parseMilli(input, { field = 'quantity', decimals = 2, minMilli = 0, maxMilli, label = 'Quantity', wholeOnly = false } = {}) {
  const text = toText(input);
  if (text === '') fail(field, `${label} is required.`);
  const p = parseFixed(text, decimals);
  if (!p) fail(field, `${label} must be a number with at most ${decimals} decimal places.`);
  const milli = p.whole * 1000 + (decimals === 3 ? p.frac : p.frac * 10 ** (3 - decimals));
  if (wholeOnly && milli % 1000 !== 0) fail(field, `${label} must be a whole number for pcs ingredients.`);
  if (milli < minMilli || milli > maxMilli) {
    fail(field, `${label} must be between ${formatMilli(minMilli, decimals)} and ${formatMilli(maxMilli, decimals)}.`);
  }
  return milli;
}

function formatMilli(milli, decimals = 2) {
  const whole = Math.floor(milli / 1000);
  if (decimals === 0) return String(whole);
  const frac = String(milli % 1000).padStart(3, '0').slice(0, decimals);
  return `${whole}.${frac}`;
}

// Tax: (subtotal * bp + 5000) / 10000, i.e. round half up, using BigInt to avoid overflow.
function taxCents(subtotalCents, taxRateBp) {
  return Number((BigInt(subtotalCents) * BigInt(taxRateBp) + 5000n) / 10000n);
}

// Serving cost: sum(qtyMilli * unitCostCents) first, then round once half-up to cents.
function servingCostCents(items) {
  let sum = 0n;
  for (const it of items) sum += BigInt(it.qtyMilli) * BigInt(it.unitCostCents);
  return Number((sum + 500n) / 1000n);
}

// Tax rate percent text -> basis points. 0..100 with at most 2 decimals.
function parseTaxRate(input, field = 'taxRate') {
  const text = toText(input);
  if (text === '') fail(field, 'Tax rate is required.');
  const m = /^(\d{1,3})(?:\.(\d{1,2}))?$/.exec(text);
  if (!m) fail(field, 'Tax rate must be a number with at most 2 decimal places.');
  const bp = Number(m[1]) * 100 + Number((m[2] || '').padEnd(2, '0') || 0);
  if (bp < 0 || bp > 10000) fail(field, 'Tax rate must be between 0 and 100 percent.');
  return bp;
}

function formatBp(bp) {
  return formatCents(bp);
}

// Cash tender classification for the checkout screen (Req 6.2 - 6.4).
function evaluateTender(totalCents, raw) {
  const text = toText(raw);
  const p = text === '' ? null : parseFixed(text, 2);
  const cents = p ? p.whole * 100 + p.frac : null;
  if (cents === null || cents > MAX_MONEY_CENTS) {
    const message =
      text === ''
        ? 'Enter the cash tendered.'
        : 'Cash tendered must be a positive amount with at most 2 decimals, up to 999999.99.';
    return { kind: 'invalid', message, canSubmit: false };
  }
  if (cents >= totalCents) {
    return { kind: 'sufficient', cashCents: cents, changeCents: cents - totalCents, canSubmit: true };
  }
  return { kind: 'short', cashCents: cents, remainingCents: totalCents - cents, canSubmit: false };
}

module.exports = {
  MAX_MONEY_CENTS,
  MAX_STOCK_MILLI,
  MAX_RECIPE_MILLI,
  parseMoney,
  formatCents,
  parseMilli,
  formatMilli,
  taxCents,
  servingCostCents,
  parseTaxRate,
  formatBp,
  evaluateTender,
};
