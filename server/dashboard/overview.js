'use strict';

const sales = require('../db/repos/sales');
const { authorize, Permission } = require('../auth/rbac');
const { formatCents } = require('../lib/money');

// THE single definition point of Gross_Sales for one Transaction.
// The glossary says "sum of Total" (tax included) but acceptance criterion 15.6 says
// selling price x quantity (tax excluded); we follow 15.6: collected tax is not revenue.
// Changing the definition means changing this function and the SQL in sales.lineAggregatesInRange.
function grossOfTransaction(t) {
  return t.subtotalCents;
}

// Gross_Sales = sum(price x qty); Net_Revenue = Gross_Sales - sum(recorded serving cost x qty).
// Serving cost comes from each Order_Line's snapshot, so later menu changes never alter it.
function overview(db, actor, range) {
  authorize(actor, Permission.VIEW_DASHBOARD);
  const a = sales.lineAggregatesInRange(db, range.startText, range.endText);
  const netCents = a.grossCents - a.costCents;
  return {
    grossCents: a.grossCents,
    gross: formatCents(a.grossCents),
    costCents: a.costCents,
    cost: formatCents(a.costCents),
    netCents,
    net: formatCents(netCents),
    transactionCount: a.txCount,
  };
}

module.exports = { grossOfTransaction, overview };
