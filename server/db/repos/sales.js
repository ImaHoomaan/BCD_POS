'use strict';

// SQL for transactions, order lines and all reporting queries used by the dashboard.

const TX_COLUMNS = `t.id, t.receipt_number AS receiptNumber, t.submission_id AS submissionId, t.created_at AS createdAt,
  t.cashier_id AS cashierId, u.username AS cashierName, t.subtotal_cents AS subtotalCents, t.tax_rate_bp AS taxRateBp,
  t.tax_cents AS taxCents, t.total_cents AS totalCents, t.cash_tendered_cents AS cashTenderedCents,
  t.change_due_cents AS changeDueCents`;

function findTransactionBySubmission(db, submissionId) {
  return db
    .prepare(`SELECT ${TX_COLUMNS} FROM transactions t JOIN users u ON u.id = t.cashier_id WHERE t.submission_id = ?`)
    .get(submissionId);
}

function getTransaction(db, id) {
  return db.prepare(`SELECT ${TX_COLUMNS} FROM transactions t JOIN users u ON u.id = t.cashier_id WHERE t.id = ?`).get(id);
}

function getLines(db, transactionId) {
  return db
    .prepare(
      `SELECT id, dish_ref AS dishRef, dish_name AS dishName, unit_price_cents AS unitPriceCents,
              serving_cost_cents AS servingCostCents, quantity, line_total_cents AS lineTotalCents
         FROM order_lines WHERE transaction_id = ? ORDER BY id`
    )
    .all(transactionId);
}

function nextTransactionId(db) {
  return db.prepare('SELECT COALESCE(MAX(id), 0) + 1 AS n FROM transactions').get().n;
}

function insertTransaction(db, t) {
  db.prepare(
    `INSERT INTO transactions (id, receipt_number, submission_id, created_at, cashier_id, subtotal_cents, tax_rate_bp,
       tax_cents, total_cents, cash_tendered_cents, change_due_cents)
     VALUES (@id, @receiptNumber, @submissionId, @createdAt, @cashierId, @subtotalCents, @taxRateBp, @taxCents,
       @totalCents, @cashTenderedCents, @changeDueCents)`
  ).run(t);
}

function insertOrderLine(db, l) {
  db.prepare(
    `INSERT INTO order_lines (transaction_id, dish_ref, dish_name, unit_price_cents, serving_cost_cents, quantity, line_total_cents)
     VALUES (@transactionId, @dishRef, @dishName, @unitPriceCents, @servingCostCents, @quantity, @lineTotalCents)`
  ).run(l);
}

function decrementStock(db, ingredientId, amountMilli) {
  db.prepare('UPDATE ingredients SET stock_milli = stock_milli - ? WHERE id = ?').run(amountMilli, ingredientId);
}

// ---- reporting ------------------------------------------------------------------------------
// Ranges are half-open [start, endExclusive) on the stored local-time text.

function transactionsInRange(db, startText, endText) {
  return db
    .prepare(
      `SELECT id, created_at AS createdAt, subtotal_cents AS subtotalCents, total_cents AS totalCents
         FROM transactions WHERE created_at >= ? AND created_at < ? ORDER BY created_at`
    )
    .all(startText, endText);
}

function lineAggregatesInRange(db, startText, endText) {
  return db
    .prepare(
      `SELECT COALESCE(SUM(l.line_total_cents), 0) AS grossCents,
              COALESCE(SUM(l.serving_cost_cents * l.quantity), 0) AS costCents,
              COUNT(DISTINCT t.id) AS txCount
         FROM transactions t JOIN order_lines l ON l.transaction_id = t.id
        WHERE t.created_at >= ? AND t.created_at < ?`
    )
    .get(startText, endText);
}

// Groups by the dish_ref snapshot so renames and deletions never split or drop history.
// The displayed name is the name recorded on the most recent line of that dish.
function dishSalesInRange(db, startText, endText) {
  return db
    .prepare(
      `SELECT l.dish_ref AS dishRef, SUM(l.quantity) AS units, SUM(l.line_total_cents) AS revenueCents,
              (SELECT l2.dish_name FROM order_lines l2 JOIN transactions t2 ON t2.id = l2.transaction_id
                WHERE l2.dish_ref = l.dish_ref ORDER BY t2.created_at DESC, l2.id DESC LIMIT 1) AS dishName
         FROM order_lines l JOIN transactions t ON t.id = l.transaction_id
        WHERE t.created_at >= ? AND t.created_at < ?
        GROUP BY l.dish_ref`
    )
    .all(startText, endText);
}

// Transaction log search. instr() is used instead of LIKE so '%' and '_' are literal.
function searchTransactions(db, { search = '', cashierId = null, startText = null, endText = null, limit, offset }) {
  const where = [];
  const params = {};
  if (search) {
    where.push('instr(lower(t.receipt_number), lower(@search)) > 0');
    params.search = search;
  }
  if (cashierId) {
    where.push('t.cashier_id = @cashierId');
    params.cashierId = cashierId;
  }
  if (startText && endText) {
    where.push('t.created_at >= @startText AND t.created_at < @endText');
    params.startText = startText;
    params.endText = endText;
  }
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const total = db.prepare(`SELECT COUNT(*) AS n FROM transactions t ${clause}`).get(params).n;
  const rows = db
    .prepare(
      `SELECT ${TX_COLUMNS} FROM transactions t JOIN users u ON u.id = t.cashier_id ${clause}
        ORDER BY t.created_at DESC, t.receipt_number DESC LIMIT @limit OFFSET @offset`
    )
    .all({ ...params, limit, offset });
  return { total, rows };
}

module.exports = {
  findTransactionBySubmission,
  getTransaction,
  getLines,
  nextTransactionId,
  insertTransaction,
  insertOrderLine,
  decrementStock,
  transactionsInRange,
  lineAggregatesInRange,
  dishSalesInRange,
  searchTransactions,
};
