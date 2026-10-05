'use strict';

const express = require('express');
const users = require('../db/repos/users');
const { write } = require('../db/connection');
const { Permission } = require('../auth/rbac');
const { parseMoney } = require('../lib/money');
const { loadCatalog } = require('../menu/available');
const { getTaxRateBp } = require('../menu/settings');
const order = require('./order');
const checkout = require('./checkout');
const { terminalCatalog } = require('./catalog');
const { submitOrder, replayIfStored } = require('./submission');
const { toId } = require('../http/middleware');

module.exports = function terminalRoutes({ db, clock, http }) {
  const r = express.Router();
  const { requires } = http;

  const loadDraft = (req) => order.parseDraft(req.session.draftJson);
  const saveDraft = (req, draft) => {
    const json = order.serializeDraft(draft);
    write(db, () => users.saveDraft(db, req.session.token, json));
    req.session.draftJson = json;
  };
  const catalogMap = () => new Map(loadCatalog(db).dishes.map((d) => [d.id, d]));

  r.get('/catalog', requires(Permission.VIEW_TERMINAL), (req, res) => {
    res.json(terminalCatalog(db, req.principal));
  });

  r.get('/order', requires(Permission.VIEW_TERMINAL), (req, res) => {
    res.json(checkout.draftView(db, req.principal, loadDraft(req)));
  });

  r.post('/order/add', requires(Permission.BUILD_ORDER), (req, res) => {
    const next = order.addDish(loadDraft(req), toId(req.body?.dishId), catalogMap());
    saveDraft(req, next);
    res.json(checkout.draftView(db, req.principal, next));
  });

  r.post('/order/quantity', requires(Permission.BUILD_ORDER), (req, res) => {
    const next = order.setQuantity(loadDraft(req), toId(req.body?.dishId), req.body?.quantity, catalogMap());
    saveDraft(req, next);
    res.json(checkout.draftView(db, req.principal, next));
  });

  r.post('/order/remove', requires(Permission.BUILD_ORDER), (req, res) => {
    const next = order.removeLine(loadDraft(req), toId(req.body?.dishId));
    saveDraft(req, next);
    res.json(checkout.draftView(db, req.principal, next));
  });

  r.post('/order/clear', requires(Permission.BUILD_ORDER), (req, res) => {
    const next = order.clear(loadDraft(req));
    saveDraft(req, next);
    res.json(checkout.draftView(db, req.principal, next));
  });

  // Opens the checkout screen and snapshots the current tax rate into the draft.
  r.post('/checkout', requires(Permission.BUILD_ORDER), (req, res) => {
    const opened = checkout.openCheckout(db, req.principal, loadDraft(req));
    saveDraft(req, opened.draft);
    res.json({ submissionId: opened.draft.submissionId, totals: opened.totals, lines: opened.lines });
  });

  // Live evaluation of the cash input (change due, remaining amount, or validation message).
  r.post('/tender', requires(Permission.BUILD_ORDER), (req, res) => {
    const draft = loadDraft(req);
    const { dishes } = loadCatalog(db);
    const lines = checkout.priceDraft(draft, dishes);
    const taxRateBp = draft.checkoutTaxBp ?? getTaxRateBp(db);
    const totals = checkout.computeTotals(lines, taxRateBp);
    res.json(checkout.tender(req.principal, totals.totalCents, req.body?.cashTendered));
  });

  r.post('/submit', requires(Permission.SUBMIT_ORDER), (req, res) => {
    const draft = loadDraft(req);
    const sid = typeof req.body?.submissionId === 'string' ? req.body.submissionId : draft.submissionId;

    // A retry of an already-closed order (for example after a lost response) gets the
    // original receipt and nothing is written.
    if (sid !== draft.submissionId) {
      const replay = replayIfStored(db, sid);
      if (replay) return res.json({ ...replay, order: checkout.draftView(db, req.principal, draft) });
      throw new order.OrderRejected('stale_order', 'This order is no longer open. Start a new order.');
    }

    const cashTenderedCents = parseMoney(req.body?.cashTendered, { field: 'cashTendered', label: 'Cash tendered' });
    const taxRateBp = draft.checkoutTaxBp ?? getTaxRateBp(db);
    const result = submitOrder(
      db,
      req.principal,
      { submissionId: sid, lines: draft.lines, cashTenderedCents, taxRateBp },
      clock
    );
    // Success (or replay): only now does the terminal start a new empty order.
    const fresh = order.newDraft();
    saveDraft(req, fresh);
    res.json({ ...result, order: checkout.draftView(db, req.principal, fresh) });
  });

  return r;
};
