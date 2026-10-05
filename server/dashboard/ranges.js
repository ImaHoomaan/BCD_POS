'use strict';

// Date filters as half-open ranges [start, endExclusive) on local time (Req 15.5).
//   today  the current local calendar day
//   7d     the current local day and the 6 preceding local days
//   30d    the current local day and the 29 preceding local days

const { ValidationError } = require('../lib/errors');
const { startOfDay, addDays, formatLocal, formatDay } = require('../lib/clock');

const KINDS = ['today', '7d', '30d'];

function makeRange(startDate, endExclusiveDate, kind) {
  return {
    kind,
    start: startDate,
    endExclusive: endExclusiveDate,
    startText: formatLocal(startDate),
    endText: formatLocal(endExclusiveDate),
  };
}

function resolveRange(kind, now) {
  const today = startOfDay(now);
  const tomorrow = addDays(today, 1);
  if (kind === 'today') return makeRange(today, tomorrow, 'today');
  if (kind === '7d') return makeRange(addDays(today, -6), tomorrow, '7d');
  if (kind === '30d') return makeRange(addDays(today, -29), tomorrow, '30d');
  throw new ValidationError({ range: 'Unknown date filter.' });
}

// Custom range: start date 00:00:00 through end date 23:59:59, inclusive. end < start is rejected.
function resolveCustomRange(startDay, endDay) {
  const parse = (t) => {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(t || ''));
    if (!m) throw new ValidationError({ range: 'Dates must be in YYYY-MM-DD format.' });
    const d = new Date(+m[1], +m[2] - 1, +m[3]);
    if (formatDay(d) !== t) throw new ValidationError({ range: 'That date does not exist.' });
    return d;
  };
  const s = parse(startDay);
  const e = parse(endDay);
  if (e < s) throw new ValidationError({ range: 'The end date must not be earlier than the start date.' });
  return makeRange(s, addDays(e, 1), 'custom');
}

// Day-label list (local days) covered by a day-based range.
function daysInRange(range) {
  const days = [];
  for (let d = range.start; d < range.endExclusive; d = addDays(d, 1)) days.push(formatDay(d));
  return days;
}

module.exports = { KINDS, resolveRange, resolveCustomRange, daysInRange };
