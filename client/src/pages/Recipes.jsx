import React, { useCallback, useEffect, useState } from 'react';
import { api } from '../api.js';
import { usePolling } from '../hooks.js';
import { Alert, Badge, Field, PageHeader, btnDanger, btnPrimary, btnSecondary, card, fieldErrors, inputCls, useMoney } from '../ui.jsx';
import { DishForm } from './MenuManagement.jsx';

function RecipeRow({ item, onSave, onRemove, resetNonce }) {
  const money = useMoney();
  const [text, setText] = useState(item.qty);
  useEffect(() => setText(item.qty), [item.qty, resetNonce]);
  const commit = () => text.trim() !== item.qty && onSave(item, text);
  return (
    <tr className="border-b last:border-0">
      <td className="py-2 font-medium">{item.ingredientName}</td>
      <td className="py-2">
        <label htmlFor={`q-${item.ingredientId}`} className="sr-only">Quantity of {item.ingredientName} per serving</label>
        <input
          id={`q-${item.ingredientId}`}
          className="w-28 rounded-lg border border-slate-300 px-2 py-1.5 text-right"
          inputMode="decimal"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
        />
      </td>
      <td className="py-2">{item.unit}</td>
      <td className="py-2 text-right">{money(item.unitCost)}</td>
      <td className="py-2 text-right">{money((item.lineCostCents / 100).toFixed(2))}</td>
      <td className="py-2 text-right">
        <button className={btnDanger} onClick={() => onRemove(item)} aria-label={`Remove ${item.ingredientName}`}>Remove</button>
      </td>
    </tr>
  );
}

function Editor({ dishId, ingredients, onChanged }) {
  const money = useMoney();
  const [view, setView] = useState(null);
  const [error, setError] = useState(null);
  const [pricing, setPricing] = useState(null);
  const [add, setAdd] = useState({ ingredientId: '', quantity: '' });
  const [addError, setAddError] = useState(null);
  const [resetNonce, setResetNonce] = useState(0);

  const load = useCallback(async () => {
    try {
      const v = await api.get(`/api/recipes/${dishId}`);
      setView(v);
      setPricing({ sellingPrice: v.dish.sellingPrice, targetCost: v.dish.targetCost });
    } catch (e) {
      setError(e.message);
    }
  }, [dishId]);
  useEffect(() => {
    setView(null);
    setError(null);
    setAdd({ ingredientId: '', quantity: '' });
    load();
  }, [load]);

  const apply = (v) => {
    setView(v);
    setPricing({ sellingPrice: v.dish.sellingPrice, targetCost: v.dish.targetCost });
    onChanged();
  };

  async function savePricing(e) {
    e.preventDefault();
    setError(null);
    try {
      apply(await api.put(`/api/recipes/${dishId}/pricing`, pricing));
    } catch (err) {
      setError(err);
    }
  }
  async function addItem(e) {
    e.preventDefault();
    setAddError(null);
    try {
      apply(await api.post(`/api/recipes/${dishId}/items`, { ingredientId: Number(add.ingredientId), quantity: add.quantity }));
      setAdd({ ingredientId: '', quantity: '' });
    } catch (err) {
      setAddError(err);
    }
  }
  async function saveQty(item, quantity) {
    setError(null);
    try {
      apply(await api.put(`/api/recipes/${dishId}/items/${item.ingredientId}`, { quantity }));
    } catch (err) {
      setError(err);
      setResetNonce((n) => n + 1);
    }
  }
  async function removeItem(item) {
    setError(null);
    try {
      apply(await api.del(`/api/recipes/${dishId}/items/${item.ingredientId}`));
    } catch (err) {
      setError(err);
    }
  }

  if (!view || !pricing) return <p className="text-slate-600">{error && typeof error === 'string' ? error : 'Loading…'}</p>;
  const pe = fieldErrors(error);
  const ae = fieldErrors(addError);
  const used = new Set(view.items.map((i) => i.ingredientId));
  const choices = ingredients.filter((i) => !used.has(i.id));
  const chosen = ingredients.find((i) => String(i.id) === add.ingredientId);

  return (
    <div className="space-y-5">
      <div className={`${card} space-y-3`}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-xl font-bold">{view.dish.name}</h2>
          <span className="flex gap-2">
            {view.available ? <Badge tone="green">Available</Badge> : <Badge tone="red">Unavailable</Badge>}
            {!view.dish.visible && <Badge>Hidden</Badge>}
          </span>
        </div>
        {error && (typeof error === 'string' || !error.fields) && <Alert>{typeof error === 'string' ? error : error.message}</Alert>}
        {view.negativeMargin && (
          <Alert kind="warn">Negative margin: the serving cost ({money(view.servingCost)}) is higher than the selling price ({money(view.dish.sellingPrice)}).</Alert>
        )}
        <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
          <div><dt className="text-slate-500">Serving cost</dt><dd className="text-lg font-bold">{money(view.servingCost)}</dd></div>
          <div><dt className="text-slate-500">Target cost</dt><dd className="text-lg font-bold">{money(view.dish.targetCost)}</dd></div>
          <div><dt className="text-slate-500">Serving cost − target</dt><dd className="text-lg font-bold">{money(view.diffToTarget)}</dd></div>
          <div><dt className="text-slate-500">Servings in stock</dt><dd className="text-lg font-bold">{view.maxServings}</dd></div>
        </dl>
        <form onSubmit={savePricing} noValidate className="grid items-end gap-3 sm:grid-cols-3">
          <Field id="pprice" label="Selling price" error={pe.sellingPrice}>
            <input id="pprice" className={inputCls} inputMode="decimal" value={pricing.sellingPrice} onChange={(e) => setPricing({ ...pricing, sellingPrice: e.target.value })} aria-invalid={!!pe.sellingPrice} />
          </Field>
          <Field id="ptarget" label="Target price/cost per serving" error={pe.targetCost}>
            <input id="ptarget" className={inputCls} inputMode="decimal" value={pricing.targetCost} onChange={(e) => setPricing({ ...pricing, targetCost: e.target.value })} aria-invalid={!!pe.targetCost} />
          </Field>
          <button className={btnPrimary} type="submit">Save pricing</button>
        </form>
      </div>

      <div className={`${card} overflow-x-auto`}>
        <h3 className="mb-3 text-lg font-bold">Recipe (per serving)</h3>
        <table className="w-full text-sm">
          <caption className="sr-only">Ingredients required per serving</caption>
          <thead>
            <tr className="border-b text-left">
              <th scope="col" className="py-2">Ingredient</th>
              <th scope="col" className="py-2">Quantity</th>
              <th scope="col" className="py-2">Unit</th>
              <th scope="col" className="py-2 text-right">Unit cost</th>
              <th scope="col" className="py-2 text-right">Cost</th>
              <th scope="col" className="py-2 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {view.items.map((i) => (
              <RecipeRow key={i.ingredientId} item={i} onSave={saveQty} onRemove={removeItem} resetNonce={resetNonce} />
            ))}
            {view.items.length === 0 && (
              <tr><td colSpan={6} className="py-4 text-slate-600">No ingredients yet, so this dish is unavailable. Add ingredients below.</td></tr>
            )}
          </tbody>
        </table>

        <form onSubmit={addItem} noValidate className="mt-4 grid items-start gap-3 border-t pt-4 sm:grid-cols-[1fr_160px_auto]">
          <Field id="aing" label="Add ingredient" error={ae.ingredientId}>
            <select id="aing" className={inputCls} value={add.ingredientId} onChange={(e) => setAdd({ ...add, ingredientId: e.target.value })}>
              <option value="">Select an ingredient</option>
              {choices.map((i) => <option key={i.id} value={i.id}>{i.name} ({i.unit})</option>)}
            </select>
          </Field>
          <Field id="aqty" label={`Quantity${chosen ? ` (${chosen.unit})` : ''}`} error={ae.quantity}>
            <input id="aqty" className={inputCls} inputMode="decimal" value={add.quantity} onChange={(e) => setAdd({ ...add, quantity: e.target.value })} aria-invalid={!!ae.quantity} />
          </Field>
          <button className={`${btnPrimary} sm:mt-6`} type="submit" disabled={!add.ingredientId}>Add</button>
          {addError && !addError.fields && <div className="sm:col-span-3"><Alert>{addError.message}</Alert></div>}
        </form>
      </div>
    </div>
  );
}

export default function Recipes() {
  const money = useMoney();
  const list = usePolling((o) => api.get('/api/recipes', o), { interval: 3000 });
  const [ingredients, setIngredients] = useState([]);
  const [categories, setCategories] = useState([]);
  const [selected, setSelected] = useState(null);
  const [creating, setCreating] = useState(false);

  const loadIngredients = useCallback(() => api.get('/api/ingredients').then((r) => setIngredients(r.ingredients)).catch(() => {}), []);
  useEffect(() => {
    loadIngredients();
    api.get('/api/menu/management').then((m) => setCategories(m.categories)).catch(() => {});
  }, [loadIngredients]);

  const dishes = list.data?.dishes ?? [];
  const currentId = selected ?? dishes[0]?.id ?? null;

  return (
    <div>
      <PageHeader title="Recipe and Pricing Linker">
        <button className={btnPrimary} onClick={() => setCreating(true)} disabled={categories.length === 0}>New dish</button>
      </PageHeader>
      <div className="grid gap-5 lg:grid-cols-[340px_1fr]">
        <nav aria-label="Dishes" className={`${card} h-fit !p-2`}>
          <ul>
            {dishes.map((d) => (
              <li key={d.id}>
                <button
                  type="button"
                  onClick={() => setSelected(d.id)}
                  aria-current={currentId === d.id}
                  className={`flex w-full items-start justify-between gap-2 rounded-lg px-3 py-2 text-left ${currentId === d.id ? 'bg-blue-50 ring-1 ring-blue-300' : 'hover:bg-slate-100'}`}
                >
                  <span>
                    <span className="block font-semibold">{d.name}</span>
                    <span className="block text-xs text-slate-500">{d.categoryName} · cost {money(d.servingCost)} / price {money(d.sellingPrice)}</span>
                  </span>
                  <span className="flex flex-col items-end gap-1">
                    {d.negativeMargin && <Badge tone="amber">Negative margin</Badge>}
                    {!d.available && <Badge tone="red">Unavailable</Badge>}
                  </span>
                </button>
              </li>
            ))}
            {list.loaded && dishes.length === 0 && <li className="p-3 text-slate-600">No dishes yet. Create one.</li>}
          </ul>
        </nav>
        <div>
          {currentId ? (
            <Editor dishId={currentId} ingredients={ingredients} onChanged={() => list.refresh()} />
          ) : (
            <p className="text-slate-600">Select or create a dish.</p>
          )}
        </div>
      </div>
      {creating && (
        <DishForm
          categories={categories}
          onClose={() => setCreating(false)}
          onSaved={() => list.refresh()}
        />
      )}
    </div>
  );
}
