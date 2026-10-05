'use strict';

const { formatCents, formatBp } = require('./money');

// Pure presentation of a stored Transaction plus its Order_Lines. Everything comes from the
// stored snapshots, never from live menu data, so old receipts never change (Req 7.3).
function receiptView(tx, lines) {
  return {
    id: tx.id,
    receiptNumber: tx.receiptNumber,
    createdAt: tx.createdAt,
    cashierName: tx.cashierName,
    lines: lines.map((l) => ({
      dishName: l.dishName,
      quantity: l.quantity,
      unitPriceCents: l.unitPriceCents,
      unitPrice: formatCents(l.unitPriceCents),
      lineTotalCents: l.lineTotalCents,
      lineTotal: formatCents(l.lineTotalCents),
    })),
    subtotalCents: tx.subtotalCents,
    subtotal: formatCents(tx.subtotalCents),
    taxRateBp: tx.taxRateBp,
    taxRate: formatBp(tx.taxRateBp),
    taxCents: tx.taxCents,
    tax: formatCents(tx.taxCents),
    totalCents: tx.totalCents,
    total: formatCents(tx.totalCents),
    cashTenderedCents: tx.cashTenderedCents,
    cashTendered: formatCents(tx.cashTenderedCents),
    changeDueCents: tx.changeDueCents,
    changeDue: formatCents(tx.changeDueCents),
  };
}

module.exports = { receiptView };
