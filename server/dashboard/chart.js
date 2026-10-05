'use strict';

const sales = require('../db/repos/sales');
const { authorize, Permission } = require('../auth/rbac');
const { formatCents } = require('../lib/money');
const { daysInRange } = require('./ranges');
const { grossOfTransaction } = require('./overview');

// Pure bucketing. txns: [{ createdAt: 'YYYY-MM-DD HH:MM:SS', subtotalCents }].
//   today  -> 24 hourly buckets (00..23)
//   7d/30d -> one bucket per local calendar day
// Empty buckets are 0.00, and the bucket values always sum to Gross_Sales (Req 17.4, 17.5).
function bucketSales(txns, range) {
  const hourly = range.kind === 'today';
  const labels = hourly
    ? Array.from({ length: 24 }, (_, h) => String(h).padStart(2, '0'))
    : daysInRange(range);
  const sums = new Map(labels.map((l) => [l, 0]));
  for (const t of txns) {
    const key = hourly ? t.createdAt.slice(11, 13) : t.createdAt.slice(0, 10);
    if (sums.has(key)) sums.set(key, sums.get(key) + grossOfTransaction(t));
  }
  const buckets = labels.map((l) => ({
    label: hourly ? `${l}:00` : l,
    cents: sums.get(l),
    value: formatCents(sums.get(l)),
  }));
  return {
    granularity: hourly ? 'hour' : 'day',
    xLabel: hourly ? 'Hour of day' : 'Day',
    buckets,
    totalCents: buckets.reduce((s, b) => s + b.cents, 0),
  };
}

function salesChart(db, actor, range) {
  authorize(actor, Permission.VIEW_DASHBOARD);
  return bucketSales(sales.transactionsInRange(db, range.startText, range.endText), range);
}

module.exports = { bucketSales, salesChart };
