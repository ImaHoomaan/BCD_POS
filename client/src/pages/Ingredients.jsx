import React, { useCallback, useEffect, useState } from 'react';
import { api } from '../api.js';
import { Alert, Field, Modal, PageHeader, btnDanger, btnPrimary, btnSecondary, card, fieldErrors, inputCls, useMoney } from '../ui.jsx';

const UNITS = ['grams', 'ml', 'pcs'];

function IngredientForm({ item, onClose, onSaved }) {
  const [form, setForm] = useState(
    item
      ? { name: item.name, unit: item.unit, unitCost: item.unitCost, stock: item.stock }
      : { name: '', unit: 'grams', unitCost: '', stock: '' }
  );
  const [error, setError] = useState(null);
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  async function save(e) {
    e.preventDefault();
    setError(null);
    try {
      if (item) await api.put(`/api/ingredients/${item.id}`, form);
      else await api.post('/api/ingredients', form);
      onSaved();
      onClose();
    } catch (err) {
      setError(err);
    }
  }
  const fe = fieldErrors(error);
  return (
    <Modal title={item ? `Edit ${item.name}` : 'Add ingredient'} onClose={onClose}>
      <form onSubmit={save} noValidate className="space-y-3">
        {error && !error.fields && <Alert>{error.message}</Alert>}
        <Field id="iname" label="Name" error={fe.name}>
          <input id="iname" className={inputCls} value={form.name} onChange={set('name')} autoFocus aria-invalid={!!fe.name} />
        </Field>
        <Field id="iunit" label="Unit of measurement" error={fe.unit}>
          <select id="iunit" className={inputCls} value={form.unit} onChange={set('unit')}>
            {UNITS.map((u) => <option key={u} value={u}>{u}</option>)}
          </select>
        </Field>
        <Field id="icost" label={`Unit cost (per ${form.unit === 'pcs' ? 'piece' : form.unit === 'ml' ? 'ml' : 'gram'})`} error={fe.unitCost}>
          <input id="icost" className={inputCls} inputMode="decimal" value={form.unitCost} onChange={set('unitCost')} aria-invalid={!!fe.unitCost} />
        </Field>
        <Field id="istock" label="Current stock" error={fe.stock} hint={form.unit === 'pcs' ? 'Whole numbers only for pcs.' : undefined}>
          <input id="istock" className={inputCls} inputMode="decimal" value={form.stock} onChange={set('stock')} aria-invalid={!!fe.stock} />
        </Field>
        <div className="flex gap-3">
          <button className={btnPrimary} type="submit">Save ingredient</button>
          <button className={btnSecondary} type="button" onClick={onClose}>Cancel</button>
        </div>
      </form>
    </Modal>
  );
}

export default function Ingredients() {
  const money = useMoney();
  const [items, setItems] = useState(null);
  const [editing, setEditing] = useState(null); // item | 'new'
  const [error, setError] = useState(null);

  const load = useCallback(() => {
    api.get('/api/ingredients').then((r) => setItems(r.ingredients)).catch((e) => setError(e.message));
  }, []);
  useEffect(load, [load]);

  async function remove(item) {
    setError(null);
    try {
      await api.del(`/api/ingredients/${item.id}`);
      load();
    } catch (e) {
      setError(e.message); // names the dishes that still use the ingredient
    }
  }

  return (
    <div className="space-y-5">
      <PageHeader title="Ingredient Stock Manager">
        <button className={btnPrimary} onClick={() => setEditing('new')}>Add ingredient</button>
      </PageHeader>
      {error && <Alert>{error}</Alert>}
      <section className={`${card} overflow-x-auto`}>
        <table className="w-full text-sm">
          <caption className="sr-only">Ingredients and current stock</caption>
          <thead>
            <tr className="border-b text-left">
              <th scope="col" className="py-2">Ingredient</th>
              <th scope="col" className="py-2">Unit</th>
              <th scope="col" className="py-2 text-right">Unit cost</th>
              <th scope="col" className="py-2 text-right">Stock</th>
              <th scope="col" className="py-2 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {items?.map((i) => (
              <tr key={i.id} className="border-b last:border-0">
                <td className="py-2 font-medium">{i.name}</td>
                <td className="py-2">{i.unit}</td>
                <td className="py-2 text-right">{money(i.unitCost)}</td>
                <td className="py-2 text-right">{i.stock}</td>
                <td className="py-2 text-right">
                  <span className="inline-flex gap-2">
                    <button className={btnSecondary} onClick={() => setEditing(i)} aria-label={`Edit ${i.name}`}>Edit</button>
                    <button className={btnDanger} onClick={() => remove(i)} aria-label={`Delete ${i.name}`}>Delete</button>
                  </span>
                </td>
              </tr>
            ))}
            {items && items.length === 0 && <tr><td colSpan={5} className="py-4 text-slate-600">No ingredients yet. Add your first one.</td></tr>}
          </tbody>
        </table>
        {!items && <p className="text-slate-600">Loading…</p>}
      </section>
      {editing && <IngredientForm item={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onSaved={load} />}
    </div>
  );
}
