'use strict';

const express = require('express');
const { Permission } = require('../auth/rbac');
const { toId } = require('../http/middleware');
const { KINDS, resolveRange, resolveCustomRange } = require('./ranges');
const { dashboardSummary } = require('./summary');
const txlog = require('./txlog');
const { ValidationError } = require('../lib/errors');

module.exports = function dashboardRoutes({ db, clock, http }) {
  const r = express.Router();
  const { requires } = http;

  r.get('/summary', requires(Permission.VIEW_DASHBOARD), (req, res) => {
    res.json(dashboardSummary(db, req.principal, String(req.query.range || 'today'), clock()));
  });

  r.get('/cashiers', requires(Permission.VIEW_TRANSACTION_LOG), (req, res) => {
    res.json({ cashiers: txlog.listCashiers(db, req.principal) });
  });

  // Filters: search (receipt number), cashier id, date filter (today | 7d | 30d) or a custom
  // start/end date, and a page number. An end date before the start date is a validation
  // error; the UI keeps the previous results and filters.
  r.get('/transactions', requires(Permission.VIEW_TRANSACTION_LOG), (req, res) => {
    const { search, cashier, range, start, end, page } = req.query;
    let rangeObj = null;
    if (start || end) {
      if (!start || !end) throw new ValidationError({ range: 'Enter both a start date and an end date.' });
      rangeObj = resolveCustomRange(String(start), String(end));
    } else if (range && range !== 'all') {
      if (!KINDS.includes(String(range))) throw new ValidationError({ range: 'Unknown date filter.' });
      rangeObj = resolveRange(String(range), clock());
    }
    const cashierId = cashier && cashier !== 'all' ? toId(cashier) : null;
    res.json(
      txlog.searchTransactions(db, req.principal, {
        search: typeof search === 'string' ? search : '',
        cashierId,
        range: rangeObj,
        page: page ? Number(page) : 1,
      })
    );
  });

  r.get('/transactions/:id', requires(Permission.VIEW_TRANSACTION_LOG), (req, res) => {
    res.json(txlog.getTransactionDetail(db, req.principal, toId(req.params.id)));
  });

  return r;
};
