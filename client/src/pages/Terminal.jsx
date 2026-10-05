import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import { usePolling, useDebounced } from '../hooks.js';
import { Alert, Field, Modal, btn, btnDanger, btnPrimary, btnSecondary, card, inputCls, useMoney } from '../ui.jsx';

// Quantity box: edits are committed on Enter or blur. If the server rejects the value the
// box snaps back to the previous quantity (resetNonce changes) and the message is shown.
function QtyInput({ line, onCommit, resetNonce }) {
  const [text, setText] = useState(String(line.quantity));
  useEffect(() => setText(String(line.quantity)), [line.quantity, resetNonce]);
  const commit = () => {
    if (text.trim() !== String(line.quantity)) onCommit(text);
  };
  return (
    <input
      aria-label={`Quantity for ${line.name}`}
      inputMode="numeric"
      className="w-16 rounded-lg border border-slate-300 px-2 py-2 text-center text-base font-semibold"
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
    />
  );
}

function CheckoutModal({ checkout, onClose, onDone, onProblem }) {
  const money = useMoney();
  const [cash, setCash] = useState('');
  const [tender, setTender] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const debounced = useDebounced(cash, 120);
  const { totals } = checkout;

  useEffect(() => {
    let live = true;
    api
      .post('/api/terminal/tender', { cashTendered: debounced })
      .then((t) => live && setTender(t))
      .catch(() => live && setTender(null));
    return () => {
      live = false;
    };
  }, [debounced]);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const res = await api.post('/api/terminal/submit', { submissionId: checkout.submissionId, cashTendered: cash });
      onDone(res);
    } catch (e) {
      setError(e.message);
      onProblem(e); // the order stays exactly as it was
    } finally {
      setBusy(false);
    }
  }

  const quick = [5, 10, 20, 50, 100];
  const canSubmit = tender?.canSubmit && !busy && cash === debounced;
  return (
    <Modal title="Checkout" onClose={onClose}>
      <dl className="space-y-1 text-sm">
        <div className="flex justify-between"><dt>Subtotal</dt><dd>{money(totals.subtotal)}</dd></div>
        <div className="flex justify-between"><dt>Tax ({totals.taxRate}%)</dt><dd>{money(totals.tax)}</dd></div>
        <div className="flex justify-between border-t pt-2 text-xl font-bold"><dt>Total</dt><dd>{money(totals.total)}</dd></div>
      </dl>

      <div className="mt-4 space-y-3">
        <Field id="cash" label="Cash tendered">
          <input
            id="cash"
            className={`${inputCls} text-lg`}
            inputMode="decimal"
            autoFocus
            value={cash}
            onChange={(e) => setCash(e.target.value)}
            aria-describedby="tender-status"
            placeholder="0.00"
          />
        </Field>
        <div className="flex flex-wrap gap-2">
          <button type="button" className={btnSecondary} onClick={() => setCash(totals.total)}>Exact</button>
          {quick.map((q) => (
            <button key={q} type="button" className={btnSecondary} onClick={() => setCash(`${q}.00`)}>{money(`${q}.00`)}</button>
          ))}
        </div>
        <div id="tender-status" aria-live="polite" className="min-h-14 rounded-lg bg-slate-100 p-3 text-sm">
          {!tender && <span className="text-slate-600">Enter the cash received.</span>}
          {tender?.kind === 'invalid' && <span role="alert" className="font-medium text-red-700">{tender.message}</span>}
          {tender?.kind === 'short' && (
            <span className="text-lg font-bold text-amber-800">Remaining due: {money(tender.remaining)}</span>
          )}
          {tender?.kind === 'sufficient' && (
            <span className="text-lg font-bold text-emerald-800">Change due: {money(tender.change)}</span>
          )}
        </div>
        {error && <Alert>{error}</Alert>}
        <div className="flex gap-3">
          <button type="button" className={`${btnPrimary} flex-1 !py-3 text-base`} disabled={!canSubmit} onClick={submit}>
            {busy ? 'Submitting…' : 'Submit order'}
          </button>
          <button type="button" className={btnSecondary} onClick={onClose}>Back</button>
        </div>
      </div>
    </Modal>
  );
}

function ReceiptModal({ receipt, onClose }) {
  const money = useMoney();
  return (
    <Modal title={`Receipt ${receipt.receiptNumber}`} onClose={onClose}>
      <div className="print-area text-sm">
        <p className="text-center text-base font-bold">BCD Restaurant POS</p>
        <p className="text-center">Receipt {receipt.receiptNumber}</p>
        <p className="text-center">{receipt.createdAt}</p>
        <p className="mb-2 text-center">Cashier: {receipt.cashierName}</p>
        <table className="w-full">
          <caption className="sr-only">Order lines</caption>
          <thead>
            <tr className="border-b text-left">
              <th scope="col" className="py-1">Item</th>
              <th scope="col" className="py-1 text-right">Qty</th>
              <th scope="col" className="py-1 text-right">Price</th>
              <th scope="col" className="py-1 text-right">Total</th>
            </tr>
          </thead>
          <tbody>
            {receipt.lines.map((l, i) => (
              <tr key={i}>
                <td className="py-0.5">{l.dishName}</td>
                <td className="py-0.5 text-right">{l.quantity}</td>
                <td className="py-0.5 text-right">{money(l.unitPrice)}</td>
                <td className="py-0.5 text-right">{money(l.lineTotal)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <dl className="mt-3 space-y-0.5 border-t pt-2">
          <div className="flex justify-between"><dt>Subtotal</dt><dd>{money(receipt.subtotal)}</dd></div>
          <div className="flex justify-between"><dt>Tax ({receipt.taxRate}%)</dt><dd>{money(receipt.tax)}</dd></div>
          <div className="flex justify-between text-base font-bold"><dt>Total</dt><dd>{money(receipt.total)}</dd></div>
          <div className="flex justify-between"><dt>Cash tendered</dt><dd>{money(receipt.cashTendered)}</dd></div>
          <div className="flex justify-between font-semibold"><dt>Change due</dt><dd>{money(receipt.changeDue)}</dd></div>
        </dl>
      </div>
      <div className="no-print mt-4 flex gap-3">
        <button type="button" className={`${btnPrimary} flex-1`} onClick={onClose} autoFocus>New order</button>
        <button type="button" className={btnSecondary} onClick={() => window.print()}>Print</button>
      </div>
    </Modal>
  );
}

export default function Terminal() {
  const money = useMoney();
  const catalog = usePolling((o) => api.get('/api/terminal/catalog', o), { interval: 2000, retryInterval: 5000 });
  const [order, setOrder] = useState(null);
  const [selected, setSelected] = useState(null);
  const [message, setMessage] = useState(null);
  const [checkout, setCheckout] = useState(null);
  const [receipt, setReceipt] = useState(null);
  const [resetNonce, setResetNonce] = useState(0);
  const lastCatalog = useRef('');

  const loadOrder = useCallback(
    () => api.get('/api/terminal/order').then(setOrder).catch((e) => setMessage({ kind: 'error', text: e.message })),
    []
  );
  useEffect(() => {
    loadOrder();
  }, [loadOrder]);

  // When the menu/stock changes under the cashier, re-read the order so maximums stay right.
  useEffect(() => {
    if (!catalog.data) return;
    const sig = JSON.stringify(catalog.data);
    if (lastCatalog.current && lastCatalog.current !== sig) loadOrder();
    lastCatalog.current = sig;
  }, [catalog.data, loadOrder]);

  async function act(fn) {
    try {
      setOrder(await fn());
      setMessage(null);
    } catch (e) {
      setMessage({ kind: 'error', text: e.message });
      setResetNonce((n) => n + 1);
      loadOrder();
    }
  }

  const addDish = (dishId) => act(() => api.post('/api/terminal/order/add', { dishId }));
  const setQty = (dishId, quantity) => act(() => api.post('/api/terminal/order/quantity', { dishId, quantity }));
  const removeLine = (dishId) => act(() => api.post('/api/terminal/order/remove', { dishId }));
  const clearOrder = () => act(() => api.post('/api/terminal/order/clear'));

  async function openCheckout() {
    try {
      setCheckout(await api.post('/api/terminal/checkout'));
      setMessage(null);
    } catch (e) {
      setMessage({ kind: 'error', text: e.message }); // empty order: stay on the terminal
    }
  }

  const categories = catalog.data?.categories ?? [];
  const active = categories.find((c) => c.id === selected) ?? categories[0];

  return (
    <div className="grid gap-5 lg:grid-cols-[1fr_400px]">
      <section aria-label="Menu" className="space-y-4">
        {catalog.stale && <Alert kind="warn">The menu may be out of date. Retrying…</Alert>}
        {catalog.data?.availabilityError && <Alert kind="warn">Availability could not be updated. Dishes are shown as unavailable.</Alert>}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div role="tablist" aria-label="Categories" className="flex flex-wrap gap-2">
            {categories.map((c) => (
              <button
                key={c.id}
                role="tab"
                aria-selected={active?.id === c.id}
                onClick={() => setSelected(c.id)}
                className={`${btn} ${active?.id === c.id ? 'bg-blue-700 text-white' : 'border border-slate-300 bg-white text-slate-800 hover:bg-slate-100'}`}
              >
                {c.name}
              </button>
            ))}
          </div>
          <Link to="/menu" className="text-sm font-semibold text-blue-700 underline">
            View Available Menu List
          </Link>
        </div>

        {!catalog.loaded && <p className="text-slate-600">Loading menu…</p>}
        {catalog.loaded && categories.length === 0 && (
          <Alert kind="warn">No dishes are currently available.</Alert>
        )}
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4">
          {active?.dishes.map((d) => (
            <button
              key={d.id}
              type="button"
              disabled={!d.available}
              onClick={() => addDish(d.id)}
              className={`flex min-h-28 flex-col items-start justify-between rounded-xl border p-4 text-left transition ${
                d.available
                  ? 'border-slate-200 bg-white shadow-sm hover:border-blue-500 hover:shadow'
                  : 'cursor-not-allowed border-dashed border-slate-300 bg-slate-100 text-slate-500'
              }`}
            >
              <span className="text-base font-semibold">{d.name}</span>
              <span className="flex w-full items-center justify-between">
                <span className="text-lg font-bold">{money(d.price)}</span>
                {!d.available && <span className="rounded bg-slate-300 px-2 py-0.5 text-xs font-bold text-slate-800">Unavailable</span>}
              </span>
            </button>
          ))}
        </div>
      </section>

      <aside aria-label="Current order" className={`${card} flex h-fit flex-col gap-3 lg:sticky lg:top-4`}>
        <h2 className="text-lg font-bold">Current order</h2>
        {message && <Alert kind={message.kind}>{message.text}</Alert>}
        {order?.isEmpty && <p className="rounded-lg bg-slate-100 p-4 text-center text-slate-600">The order is empty. Tap a dish to add it.</p>}
        <ul className="divide-y">
          {order?.lines.map((l) => (
            <li key={l.dishId} className="flex flex-col gap-2 py-3">
              <div className="flex items-start justify-between gap-2">
                <span className="font-semibold">{l.name}</span>
                <span className="font-semibold">{money(l.lineTotal)}</span>
              </div>
              {l.unavailable && <span className="text-xs font-semibold text-red-700">No longer available</span>}
              <div className="flex items-center gap-2">
                <button type="button" aria-label={`Decrease ${l.name}`} className={`${btnSecondary} !px-3`} disabled={l.quantity <= 1} onClick={() => setQty(l.dishId, l.quantity - 1)}>−</button>
                <QtyInput line={l} resetNonce={resetNonce} onCommit={(t) => setQty(l.dishId, t)} />
                <button type="button" aria-label={`Increase ${l.name}`} className={`${btnSecondary} !px-3`} onClick={() => addDish(l.dishId)}>+</button>
                <span className="ml-1 text-xs text-slate-500">@ {money(l.unitPrice)}</span>
                <button type="button" className={`${btnDanger} ml-auto !px-3 !py-2`} onClick={() => removeLine(l.dishId)} aria-label={`Remove ${l.name}`}>Remove</button>
              </div>
            </li>
          ))}
        </ul>
        <div className="flex items-center justify-between border-t pt-3 text-lg font-bold" aria-live="polite">
          <span>Subtotal</span>
          <span>{money(order?.subtotal ?? '0.00')}</span>
        </div>
        <div className="flex gap-3">
          <button type="button" className={`${btnPrimary} flex-1 !py-3 text-base`} onClick={openCheckout}>Checkout</button>
          <button type="button" className={btnSecondary} onClick={clearOrder} disabled={!order || order.isEmpty}>Clear order</button>
        </div>
      </aside>

      {checkout && (
        <CheckoutModal
          checkout={checkout}
          onClose={() => setCheckout(null)}
          onDone={(res) => {
            setCheckout(null);
            setReceipt(res.receipt);
            setOrder(res.order); // a new empty order starts after the receipt
            setMessage(null);
            catalog.refresh();
          }}
          onProblem={() => {
            loadOrder();
            catalog.refresh();
          }}
        />
      )}
      {receipt && <ReceiptModal receipt={receipt} onClose={() => setReceipt(null)} />}
    </div>
  );
}
