'use strict';

const sales = require('../db/repos/sales');
const users = require('../db/repos/users');
const { authorize, Permission } = require('../auth/rbac');
const { NotFound, ValidationError } = require('../lib/errors');
const { formatCents } = require('../lib/money');
const { receiptView } = require('../lib/receipt');

const PAGE_SIZE = 25;
const MAX_SEARCH = 50;

// query: { search, cashierId|null, range|null, page }
// Filters combine with AND. Sorted by date/time desc, ties by receipt number desc.
function searchTransactions(db, actor, query) {
  authorize(actor, Permission.VIEW_TRANSACTION_LOG);
  const search = (query.search || '').trim();
  if ([...search].length > MAX_SEARCH) throw new ValidationError({ search: `Search text can be at most ${MAX_SEARCH} characters.` });
  const requested = Number.isInteger(query.page) && query.page >= 1 ? query.page : 1;
  const base = {
    search,
    cashierId: query.cashierId || null,
    startText: query.range ? query.range.startText : null,
    endText: query.range ? query.range.endText : null,
  };
  const first = sales.searchTransactions(db, { ...base, limit: PAGE_SIZE, offset: 0 });
  const pages = Math.ceil(first.total / PAGE_SIZE);
  const page = pages === 0 ? 1 : Math.min(requested, pages);
  const res = page === 1 ? first : sales.searchTransactions(db, { ...base, limit: PAGE_SIZE, offset: (page - 1) * PAGE_SIZE });
  return {
    page,
    pages,
    pageSize: PAGE_SIZE,
    total: first.total,
    rows: res.rows.map((r) => ({
      id: r.id,
      receiptNumber: r.receiptNumber,
      createdAt: r.createdAt.slice(0, 16), // to the minute
      totalCents: r.totalCents,
      total: formatCents(r.totalCents),
      cashierName: r.cashierName,
    })),
  };
}

function getTransactionDetail(db, actor, id) {
  authorize(actor, Permission.VIEW_TRANSACTION_LOG);
  const tx = sales.getTransaction(db, id);
  if (!tx) throw new NotFound('Transaction not found.');
  return receiptView(tx, sales.getLines(db, id));
}

function listCashiers(db, actor) {
  authorize(actor, Permission.VIEW_TRANSACTION_LOG);
  return users.listCashiers(db);
}

module.exports = { PAGE_SIZE, searchTransactions, getTransactionDetail, listCashiers };
