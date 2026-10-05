import React, { useEffect, useRef } from 'react';
import { useAuth } from './auth.jsx';

export const btn =
  'inline-flex items-center justify-center rounded-lg px-4 py-2.5 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-50';
export const btnPrimary = `${btn} bg-blue-700 text-white hover:bg-blue-800`;
export const btnSecondary = `${btn} border border-slate-300 bg-white text-slate-800 hover:bg-slate-100`;
export const btnDanger = `${btn} bg-red-700 text-white hover:bg-red-800`;
export const inputCls =
  'block w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 placeholder-slate-400 aria-[invalid=true]:border-red-600';
export const card = 'rounded-xl border border-slate-200 bg-white p-5 shadow-sm';

// Money strings come from the server with exactly two decimals; only the symbol is added here.
export function useMoney() {
  const { session } = useAuth();
  const cur = session?.config?.currency ?? '$';
  return (s) => (s === undefined || s === null ? '' : s.startsWith('-') ? `-${cur}${s.slice(1)}` : `${cur}${s}`);
}

export function Alert({ kind = 'error', children }) {
  if (!children) return null;
  const tone =
    kind === 'error'
      ? 'border-red-300 bg-red-50 text-red-900'
      : kind === 'warn'
        ? 'border-amber-300 bg-amber-50 text-amber-900'
        : 'border-emerald-300 bg-emerald-50 text-emerald-900';
  return (
    <div role={kind === 'error' ? 'alert' : 'status'} className={`rounded-lg border px-4 py-3 text-sm ${tone}`}>
      {children}
    </div>
  );
}

// Label + control + inline error, wired together for screen readers.
export function Field({ id, label, error, hint, children }) {
  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-sm font-medium text-slate-700">
        {label}
      </label>
      {children}
      {hint && !error && <p className="mt-1 text-xs text-slate-500">{hint}</p>}
      {error && (
        <p id={`${id}-error`} role="alert" className="mt-1 text-xs font-medium text-red-700">
          {error}
        </p>
      )}
    </div>
  );
}

export function Badge({ tone = 'slate', children }) {
  const tones = {
    slate: 'bg-slate-100 text-slate-700',
    green: 'bg-emerald-100 text-emerald-800',
    red: 'bg-red-100 text-red-800',
    amber: 'bg-amber-100 text-amber-900',
    blue: 'bg-blue-100 text-blue-800',
  };
  return <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-semibold ${tones[tone]}`}>{children}</span>;
}

export function Modal({ title, onClose, children, wide = false }) {
  const ref = useRef(null);
  useEffect(() => {
    const previous = document.activeElement;
    ref.current?.focus();
    const onKey = (e) => e.key === 'Escape' && onClose?.();
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      previous?.focus?.();
    };
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
      <div
        ref={ref}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={`max-h-[92vh] w-full overflow-y-auto rounded-xl bg-white p-6 shadow-xl ${wide ? 'max-w-3xl' : 'max-w-md'}`}
      >
        <div className="mb-4 flex items-start justify-between gap-4">
          <h2 className="text-lg font-bold">{title}</h2>
          {onClose && (
            <button type="button" onClick={onClose} className={`${btnSecondary} no-print !px-3 !py-1`} aria-label="Close dialog">
              Close
            </button>
          )}
        </div>
        {children}
      </div>
    </div>
  );
}

export function PageHeader({ title, children }) {
  return (
    <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
      <h1 className="text-2xl font-bold">{title}</h1>
      {children}
    </div>
  );
}

// Reads per-field messages from an ApiError (validation errors).
export const fieldErrors = (err) => (err && err.fields ? err.fields : {});
