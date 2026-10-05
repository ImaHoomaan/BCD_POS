'use strict';

const sales = require('../db/repos/sales');
const catalog = require('../db/repos/catalog');
const { write } = require('../db/connection');
const { authorize, Permission } = require('../auth/rbac');
const { PosError, StorageError, InsufficientStock } = require('../lib/errors');
const { servingCostCents, MAX_MONEY_CENTS } = require('../lib/money');
const { formatLocal } = require('../lib/clock');
const { receiptView } = require('../lib/receipt');
const { computeTotals } = require('./checkout');
const { MAX_QTY, MAX_LINES } = require('./order');

// A submission rejected for breaking a validity rule. detail.rule names the failed rule.
class SubmissionRejected extends PosError {
  constructor(rule, message) {
    super(message, { status: 422, code: 'submission_invalid', detail: { rule } });
    this.rule = rule;
  }
}

const pad8 = (n) => String(n).padStart(8, '0');

function receiptFor(db, tx) {
  return receiptView(tx, sales.getLines(db, tx.id));
}

// If this Order_Submission_Identifier already belongs to a stored Transaction, return that
// receipt and write nothing (Req 7.10). Safe to call outside a write transaction.
function replayIfStored(db, submissionId) {
  const tx = sales.findTransactionBySubmission(db, submissionId);
  return tx ? { receipt: receiptFor(db, tx), replayed: true } : null;
}

// submission: { submissionId, lines: [{dishId, quantity}], cashTenderedCents, taxRateBp }
//
// Everything below runs in ONE BEGIN IMMEDIATE transaction: the idempotency lookup, the
// stock check, the Transaction insert and every stock decrease. Either all of it is stored
// or none of it is (Req 7.4), and concurrent submissions are serialized (Req 7.9).
function submitOrder(db, actor, submission, clock) {
  authorize(actor, Permission.SUBMIT_ORDER);
  try {
    return write(db, () => {
      // 2. Replay check comes before validation, so a retry after a lost response always
      //    gets the original receipt.
      const replay = replayIfStored(db, submission.submissionId);
      if (replay) return replay;

      // 3. Shape validation.
      const lines = submission.lines || [];
      if (lines.length === 0) throw new SubmissionRejected('no_lines', 'The order has no items.');
      if (lines.length > MAX_LINES) throw new SubmissionRejected('line_count', `An order can have at most ${MAX_LINES} lines.`);
      const seen = new Set();
      for (const l of lines) {
        if (!Number.isInteger(l.quantity) || l.quantity < 1 || l.quantity > MAX_QTY) {
          throw new SubmissionRejected('quantity_range', `Each quantity must be a whole number from 1 to ${MAX_QTY}.`);
        }
        if (!Number.isInteger(l.dishId) || seen.has(l.dishId)) {
          throw new SubmissionRejected('duplicate_dish', 'Each dish may appear only once in an order.');
        }
        seen.add(l.dishId);
      }
      const cash = submission.cashTenderedCents;
      if (!Number.isInteger(cash) || cash < 0 || cash > MAX_MONEY_CENTS) {
        throw new SubmissionRejected('invalid_cash', 'Cash tendered is not a valid amount.');
      }

      // 4. Load dishes and recipes at submission time (prices and recipes are snapshotted now).
      const dishes = new Map();
      for (const l of lines) dishes.set(l.dishId, catalog.getDish(db, l.dishId));
      const recipeRows = catalog.getRecipeRowsForDishes(db, lines.map((l) => l.dishId));
      const recipeByDish = new Map();
      for (const r of recipeRows) {
        if (!recipeByDish.has(r.dishId)) recipeByDish.set(r.dishId, []);
        recipeByDish.get(r.dishId).push(r);
      }

      // 5. Aggregate requirement per ingredient across ALL lines (a shared ingredient is
      //    counted once per use). Every dish touching a short ingredient is unfulfillable.
      const required = new Map(); // ingredientId -> { needed, stock }
      for (const l of lines) {
        for (const r of recipeByDish.get(l.dishId) || []) {
          const cur = required.get(r.ingredientId) || { needed: 0, stock: r.stockMilli };
          cur.needed += r.qtyMilli * l.quantity;
          required.set(r.ingredientId, cur);
        }
      }
      const unfulfillable = [];
      for (const l of lines) {
        const dish = dishes.get(l.dishId);
        const items = recipeByDish.get(l.dishId) || [];
        const bad = !dish || !dish.visible || items.length === 0 || items.some((r) => required.get(r.ingredientId).needed > r.stockMilli);
        if (bad) unfulfillable.push(dish ? dish.name : `Dish #${l.dishId}`);
      }
      if (unfulfillable.length > 0) throw new InsufficientStock(unfulfillable);

      // 6. Totals at submission-time prices with the snapshotted tax rate.
      const priced = lines.map((l) => ({ unitPriceCents: dishes.get(l.dishId).sellingPriceCents, quantity: l.quantity }));
      const totals = computeTotals(priced, submission.taxRateBp);
      if (cash < totals.totalCents) {
        throw new SubmissionRejected('cash_below_total', 'Cash tendered is less than the total.');
      }

      // 7. Insert the Transaction and its Order_Lines with snapshots.
      const id = sales.nextTransactionId(db);
      sales.insertTransaction(db, {
        id,
        receiptNumber: `R${pad8(id)}`,
        submissionId: submission.submissionId,
        createdAt: formatLocal(clock()),
        cashierId: actor.userId,
        subtotalCents: totals.subtotalCents,
        taxRateBp: totals.taxRateBp,
        taxCents: totals.taxCents,
        totalCents: totals.totalCents,
        cashTenderedCents: cash,
        changeDueCents: cash - totals.totalCents,
      });
      for (const l of lines) {
        const dish = dishes.get(l.dishId);
        sales.insertOrderLine(db, {
          transactionId: id,
          dishRef: dish.id,
          dishName: dish.name,
          unitPriceCents: dish.sellingPriceCents,
          servingCostCents: servingCostCents(recipeByDish.get(l.dishId)),
          quantity: l.quantity,
          lineTotalCents: dish.sellingPriceCents * l.quantity,
        });
      }

      // 8. Deduct stock. The schema CHECK (stock_milli >= 0) is a backstop.
      for (const [ingredientId, { needed }] of required) sales.decrementStock(db, ingredientId, needed);

      return { receipt: receiptFor(db, sales.getTransaction(db, id)), replayed: false };
    });
  } catch (e) {
    if (e instanceof PosError) throw e;
    // Any unexpected failure: the transaction already rolled back, nothing was recorded.
    throw new StorageError('The sale was not recorded. No data was changed.', e);
  }
}

module.exports = { SubmissionRejected, submitOrder, replayIfStored };
