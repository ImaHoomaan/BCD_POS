import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Bar, BarChart, CartesianGrid, Label, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { api } from '../api.js';
import { useDebounced } from '../hooks.js';
import { Alert, Badge, Field, Modal, PageHeader, btnPrimary, btnSecondary, card, inputCls, useMoney } from '../ui.jsx';
import { useAuth } from '../auth.jsx';

const FILTERS = [
  { key: 'today', label: 'Today' },
  { key: '7d', label: 'Past 7 Days' },
  { key: '30d', label: 'Past 30 Days' },
];

function SectionError({ children }) {
  return <Alert>{children || 'Could not load this section. Select the filter again to retry.'}</Alert>;
}

function Cards({ part }) {
  const money = useMoney();
  // On failure show an error indication, never 0.00 or a stale number (Req 15.7).
  const items = [
    { label: 'Gross Sales', value: part.ok ? money(part.data.gross) : null },
    { label: 'Net Revenue', value: part.ok ? money(part.data.net) : null, hint: 'Gross sales minus ingredient cost' },
  ];
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {items.map((c) => (
        <div key={c.label} className={card}>
          <p className="text-sm font-medium text-slate-600">{c.label}</p>
          {part.ok ? (
            <p className="mt-1 text-3xl font-extrabold" aria-live="polite">{c.value}</p>
          ) : (
            <p role="alert" className="mt-1 text-sm font-semibold text-red-700">Error loading</p>
          )}
          {c.hint && <p className="mt-1 text-xs text-slate-500">{c.hint}</p>}
        </div>
      ))}
    </div>
  );
}

function TopDishes({ part }) {
  const money = useMoney();
  return (
    <section className={card} aria-labelledby="top-h">
      <h2 id="top-h" className="mb-3 text-lg font-bold">Top-selling dishes</h2>
      {!part.ok && <SectionError>{part.error}</SectionError>}
      {part.ok && part.data.length === 0 && <p className="text-slate-600">No sales data is available for this period.</p>}
      {part.ok && part.data.length > 0 && (
        <table className="w-full text-sm">
          <caption className="sr-only">Top 5 dishes by units sold</caption>
          <thead>
            <tr className="border-b text-left">
              <th scope="col" className="py-2">#</th>
              <th scope="col" className="py-2">Dish</th>
              <th scope="col" className="py-2 text-right">Units sold</th>
              <th scope="col" className="py-2 text-right">Revenue</th>
            </tr>
          </thead>
          <tbody>
            {part.data.map((d) => (
              <tr key={d.dishRef} className="border-b last:border-0">
                <td className="py-2">{d.rank}</td>
                <td className="py-2 font-medium">{d.dishName} {d.isTop && <Badge tone="blue">Top-Selling Dish</Badge>}</td>
                <td className="py-2 text-right">{d.units}</td>
                <td className="py-2 text-right">{money(d.revenue)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

function SalesChart({ part }) {
  const { session } = useAuth();
  const cur = session.config.currency;
  const money = useMoney();
  return (
    <section className={card} aria-labelledby="chart-h">
      <h2 id="chart-h" className="mb-3 text-lg font-bold">Sales over time</h2>
      {!part.ok && <SectionError>The chart failed to load. Select the filter again to retry.</SectionError>}
      {part.ok && (
        <>
          <div className="h-72 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={part.data.buckets.map((b) => ({ ...b, amount: b.cents / 100 }))} margin={{ top: 8, right: 16, left: 16, bottom: 28 }}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="label" interval="preserveStartEnd" tick={{ fontSize: 12 }}>
                  <Label value={part.data.xLabel} position="insideBottom" offset={-18} />
                </XAxis>
                <YAxis tick={{ fontSize: 12 }}>
                  <Label value={`Sales (${cur})`} angle={-90} position="insideLeft" offset={-4} style={{ textAnchor: 'middle' }} />
                </YAxis>
                <Tooltip formatter={(_v, _n, p) => [money(p.payload.value), 'Sales']} />
                <Bar dataKey="amount" fill="#1d4ed8" isAnimationActive={false} />
              </BarChart>
            </ResponsiveContainer>
          </div>
          {/* Text alternative for the chart */}
          <details className="mt-2 text-sm">
            <summary className="cursor-pointer font-medium text-blue-700">View chart data as a table</summary>
            <table className="mt-2 w-full">
              <thead><tr className="border-b text-left"><th scope="col" className="py-1">{part.data.xLabel}</th><th scope="col" className="py-1 text-right">Sales</th></tr></thead>
              <tbody>
                {part.data.buckets.map((b) => (
                  <tr key={b.label}><td className="py-0.5">{b.label}</td><td className="py-0.5 text-right">{money(b.value)}</td></tr>
                ))}
              </tbody>
            </table>
          </details>
        </>
      )}
    </section>
  );
}

function ReceiptDetail({ id, onClose }) {
  const money = useMoney();
  const [tx, setTx] = useState(null);
  const [err, setErr] = useState('');
  useEffect(() => {
    api.get(`/api/dashboard/transactions/${id}`).then(setTx).catch((e) => setErr(e.message));
  }, [id]);
  return (
    <Modal title={tx ? `Receipt ${tx.receiptNumber}` : 'Receipt'} onClose={onClose}>
      {err && <Alert>{err}</Alert>}
      {tx && (
        <div className="text-sm">
          <p>{tx.createdAt} · Cashier: {tx.cashierName}</p>
          <table className="mt-2 w-full">
            <caption className="sr-only">Order lines</caption>
            <thead><tr className="border-b text-left"><th scope="col" className="py-1">Item</th><th scope="col" className="py-1 text-right">Qty</th><th scope="col" className="py-1 text-right">Price</th><th scope="col" className="py-1 text-right">Total</th></tr></thead>
            <tbody>
              {tx.lines.map((l, i) => (
                <tr key={i}><td className="py-0.5">{l.dishName}</td><td className="py-0.5 text-right">{l.quantity}</td><td className="py-0.5 text-right">{money(l.unitPrice)}</td><td className="py-0.5 text-right">{money(l.lineTotal)}</td></tr>
              ))}
            </tbody>
          </table>
          <dl className="mt-3 space-y-0.5 border-t pt-2">
            <div className="flex justify-between"><dt>Subtotal</dt><dd>{money(tx.subtotal)}</dd></div>
            <div className="flex justify-between"><dt>Tax ({tx.taxRate}%)</dt><dd>{money(tx.tax)}</dd></div>
            <div className="flex justify-between font-bold"><dt>Total</dt><dd>{money(tx.total)}</dd></div>
            <div className="flex justify-between"><dt>Cash tendered</dt><dd>{money(tx.cashTendered)}</dd></div>
            <div className="flex justify-between"><dt>Change due</dt><dd>{money(tx.changeDue)}</dd></div>
          </dl>
        </div>
      )}
    </Modal>
  );
}

const EMPTY_FILTERS = { search: '', cashier: 'all', range: 'all', start: '', end: '' };

function TransactionLog() {
  const money = useMoney();
  const [cashiers, setCashiers] = useState([]);
  const [draft, setDraft] = useState(EMPTY_FILTERS);
  const [applied, setApplied] = useState(EMPTY_FILTERS); // the filters that produced `result`
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [openId, setOpenId] = useState(null);
  const search = useDebounced(draft.search, 250);
  const seq = useRef(0);

  useEffect(() => {
    api.get('/api/dashboard/cashiers').then((r) => setCashiers(r.cashiers)).catch(() => {});
  }, []);

  // Fetch one page for a set of filters. On a validation error (for example end date before
  // start date) the previous results and previously applied filters stay on screen.
  const fetchPage = useCallback(async (filters, page = 1) => {
    const mine = ++seq.current;
    const q = new URLSearchParams();
    if (filters.search.trim()) q.set('search', filters.search.trim());
    if (filters.cashier !== 'all') q.set('cashier', filters.cashier);
    if (filters.range === 'custom') {
      if (filters.start) q.set('start', filters.start);
      if (filters.end) q.set('end', filters.end);
    } else if (filters.range !== 'all') {
      q.set('range', filters.range);
    }
    q.set('page', String(page));
    try {
      const r = await api.get(`/api/dashboard/transactions?${q}`);
      if (mine !== seq.current) return;
      setResult(r);
      setApplied(filters);
      setError('');
    } catch (e) {
      if (mine !== seq.current) return;
      setError(e.message);
    }
  }, []);

  // Re-query whenever a filter changes. An incomplete custom range waits until both dates exist.
  useEffect(() => {
    const f = { ...draft, search };
    if (f.range === 'custom' && (!f.start || !f.end)) return;
    fetchPage(f, 1);
  }, [search, draft.cashier, draft.range, draft.start, draft.end]); // eslint-disable-line react-hooks/exhaustive-deps

  const set = (k) => (e) => setDraft({ ...draft, [k]: e.target.value });
  const goto = (p) => fetchPage(applied, p);

  return (
    <section className={`${card} space-y-4`} aria-labelledby="log-h">
      <h2 id="log-h" className="text-lg font-bold">Transaction log</h2>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <Field id="tsearch" label="Receipt number">
          <input id="tsearch" className={inputCls} value={draft.search} onChange={set('search')} placeholder="e.g. R0000012" maxLength={50} />
        </Field>
        <Field id="tcashier" label="Cashier">
          <select id="tcashier" className={inputCls} value={draft.cashier} onChange={set('cashier')}>
            <option value="all">All Cashiers</option>
            {cashiers.map((c) => <option key={c.id} value={c.id}>{c.username}</option>)}
          </select>
        </Field>
        <Field id="trange" label="Period">
          <select id="trange" className={inputCls} value={draft.range} onChange={set('range')}>
            <option value="all">All time</option>
            <option value="today">Today</option>
            <option value="7d">Past 7 Days</option>
            <option value="30d">Past 30 Days</option>
            <option value="custom">Custom range</option>
          </select>
        </Field>
        {draft.range === 'custom' && (
          <>
            <Field id="tstart" label="Start date"><input id="tstart" type="date" className={inputCls} value={draft.start} onChange={set('start')} /></Field>
            <Field id="tend" label="End date"><input id="tend" type="date" className={inputCls} value={draft.end} onChange={set('end')} /></Field>
          </>
        )}
      </div>
      {error && <Alert>{error}</Alert>}

      {result && result.total === 0 && <p className="rounded-lg bg-slate-100 p-4 text-slate-700">No transactions were found.</p>}
      {result && result.total > 0 && (
        <>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <caption className="sr-only">Past receipts</caption>
              <thead>
                <tr className="border-b text-left">
                  <th scope="col" className="py-2">Receipt</th>
                  <th scope="col" className="py-2">Date and time</th>
                  <th scope="col" className="py-2 text-right">Total</th>
                  <th scope="col" className="py-2">Cashier</th>
                  <th scope="col" className="py-2 text-right"><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody>
                {result.rows.map((r) => (
                  <tr key={r.id} className="border-b last:border-0">
                    <td className="py-2 font-medium">{r.receiptNumber}</td>
                    <td className="py-2">{r.createdAt}</td>
                    <td className="py-2 text-right">{money(r.total)}</td>
                    <td className="py-2">{r.cashierName}</td>
                    <td className="py-2 text-right"><button className={btnSecondary} onClick={() => setOpenId(r.id)} aria-label={`View receipt ${r.receiptNumber}`}>View</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <nav aria-label="Pagination" className="flex flex-wrap items-center justify-between gap-2 text-sm">
            <span>{result.total} transactions · page {result.page} of {result.pages}</span>
            {result.pages > 1 && (
              <span className="flex flex-wrap items-center gap-2">
                <button className={btnSecondary} disabled={result.page <= 1} onClick={() => goto(result.page - 1)}>Previous</button>
                {Array.from({ length: result.pages }, (_, i) => i + 1).slice(0, 12).map((p) => (
                  <button key={p} className={p === result.page ? btnPrimary : btnSecondary} aria-current={p === result.page ? 'page' : undefined} onClick={() => goto(p)}>{p}</button>
                ))}
                <button className={btnSecondary} disabled={result.page >= result.pages} onClick={() => goto(result.page + 1)}>Next</button>
              </span>
            )}
          </nav>
        </>
      )}
      {openId && <ReceiptDetail id={openId} onClose={() => setOpenId(null)} />}
    </section>
  );
}

export default function Dashboard() {
  const [range, setRange] = useState('today');
  const [summary, setSummary] = useState(null);
  const [fatal, setFatal] = useState('');

  const load = useCallback(async (kind) => {
    try {
      setSummary(await api.get(`/api/dashboard/summary?range=${kind}`));
      setFatal('');
    } catch (e) {
      setFatal(e.message);
    }
  }, []);
  useEffect(() => {
    load(range);
  }, [range, load]);

  return (
    <div className="space-y-5">
      <PageHeader title="Dashboard">
        <div role="group" aria-label="Date filter" className="flex gap-2">
          {FILTERS.map((f) => (
            <button key={f.key} type="button" aria-pressed={range === f.key} onClick={() => (range === f.key ? load(f.key) : setRange(f.key))}
              className={range === f.key ? btnPrimary : btnSecondary}>
              {f.label}
            </button>
          ))}
        </div>
      </PageHeader>
      {fatal && <Alert>{fatal}</Alert>}
      {summary && (
        <>
          <Cards part={summary.overview} />
          <div className="grid gap-5 xl:grid-cols-[1fr_1.2fr]">
            <TopDishes part={summary.topDishes} />
            <SalesChart part={summary.chart} />
          </div>
        </>
      )}
      {!summary && !fatal && <p className="text-slate-600">Loading…</p>}
      <TransactionLog />
    </div>
  );
}
