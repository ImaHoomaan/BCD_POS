import React from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import { usePolling } from '../hooks.js';
import { Alert, PageHeader, card, useMoney } from '../ui.jsx';
import { useAuth } from '../auth.jsx';

// Read-only list of dishes that can be ordered right now. Refreshes itself every 2 seconds
// (well inside the 5 second requirement) and, if a refresh fails, keeps the last list on
// screen with a warning and retries every 5 seconds.
export default function AvailableMenu() {
  const money = useMoney();
  const { session } = useAuth();
  const { data, stale, loaded } = usePolling((o) => api.get('/api/menu/available', o), { interval: 2000, retryInterval: 5000 });
  const groups = data?.groups ?? [];

  return (
    <div>
      <PageHeader title="Available Menu List">
        <Link to="/terminal" className="text-sm font-semibold text-blue-700 underline">Back to POS Terminal</Link>
      </PageHeader>
      <div className="space-y-4">
        {stale && <Alert kind="warn">This list may be out of date. Retrying every 5 seconds…</Alert>}
        {data?.availabilityError && <Alert kind="warn">Availability could not be updated.</Alert>}
        {!loaded && <p className="text-slate-600">Loading…</p>}
        {loaded && data && groups.length === 0 && (
          <div className={card}>
            <p className="text-slate-700">No dishes are currently available.</p>
          </div>
        )}
        <div aria-live="polite" className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {groups.map((g) => (
            <section key={g.categoryId} className={card} aria-labelledby={`cat-${g.categoryId}`}>
              <h2 id={`cat-${g.categoryId}`} className="mb-3 text-lg font-bold">{g.name}</h2>
              <ul className="divide-y">
                {g.dishes.map((d) => (
                  <li key={d.id} className="flex items-center justify-between py-2">
                    <span>{d.name}</span>
                    <span className="font-semibold">{money(d.price)}</span>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
        <p className="text-xs text-slate-500">Signed in as {session.user.username}. This screen is read-only.</p>
      </div>
    </div>
  );
}
