'use strict';

const { authorize, Permission } = require('../auth/rbac');
const { resolveRange } = require('./ranges');
const { overview } = require('./overview');
const { topDishes } = require('./topDishes');
const { salesChart } = require('./chart');

// Each dashboard component catches its own failure and reports { error } instead of
// showing 0.00, stale values or partial chart data (Req 15.7, 17.7). Authorization is
// checked first and is NOT swallowed.
function attempt(fn) {
  try {
    return { ok: true, data: fn() };
  } catch (e) {
    return { ok: false, error: 'Could not load this section. Select the filter again to retry.' };
  }
}

function dashboardSummary(db, actor, kind, now) {
  authorize(actor, Permission.VIEW_DASHBOARD);
  const range = resolveRange(kind, now); // invalid filter -> ValidationError
  return {
    range: { kind: range.kind, startText: range.startText, endText: range.endText },
    overview: attempt(() => overview(db, actor, range)),
    topDishes: attempt(() => topDishes(db, actor, range)),
    chart: attempt(() => salesChart(db, actor, range)),
  };
}

module.exports = { dashboardSummary };
