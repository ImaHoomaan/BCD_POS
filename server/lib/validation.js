'use strict';

// Shared field validators. Every service calls these so the same rule is never written
// twice (for example the Dish editor and the Recipe and Pricing Linker share the price rules).

const { ValidationError } = require('./errors');
const { parseMoney } = require('./money');

const UNITS = ['grams', 'ml', 'pcs'];

function validateName(input, { field = 'name', label = 'Name', max = 100 } = {}) {
  const text = typeof input === 'string' ? input.trim() : '';
  if (text.length === 0) throw new ValidationError({ [field]: `${label} is required.` });
  if ([...text].length > max) throw new ValidationError({ [field]: `${label} must be at most ${max} characters.` });
  return text;
}

function validatePrice(input, field = 'sellingPrice') {
  return parseMoney(input, { field, minCents: 1, label: 'Selling price' });
}

function validateTargetCost(input, field = 'targetCost') {
  return parseMoney(input ?? '0.00', { field, minCents: 0, label: 'Target cost' });
}

function validateUnit(input, field = 'unit') {
  if (!UNITS.includes(input)) throw new ValidationError({ [field]: 'Unit must be grams, ml or pcs.' });
  return input;
}

// Runs every step, collecting all field errors into one ValidationError (Req 9.4 asks for
// a message per invalid field). steps: { field: () => value }.
function collect(steps) {
  const values = {};
  const fields = {};
  for (const [key, fn] of Object.entries(steps)) {
    try {
      values[key] = fn();
    } catch (e) {
      if (e instanceof ValidationError) Object.assign(fields, e.fields);
      else throw e;
    }
  }
  if (Object.keys(fields).length > 0) throw new ValidationError(fields);
  return values;
}

module.exports = { UNITS, validateName, validatePrice, validateTargetCost, validateUnit, collect };
