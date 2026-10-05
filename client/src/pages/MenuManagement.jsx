import React, { useState } from 'react';
import { api } from '../api.js';
import { usePolling } from '../hooks.js';
import {
  Alert, Badge, Field, Modal, PageHeader, btnDanger, btnPrimary, btnSecondary, card, fieldErrors, inputCls, useMoney,
} from '../ui.jsx';

function TaxForm({ tax, onSaved }) {
  const [value, setValue] = useState(null);
  const [error, setError] = useState(null);
  const [ok, setOk] = useState('');
  const shown = value ?? tax.taxRate;
  async function save(e) {
    e.preventDefault();
    setError(null);
    setOk('');
    try {
      const r = await api.put('/api/menu/tax', { taxRate: shown });
      setValue(null);
      setOk(`Tax rate saved: ${r.taxRate}%`);
      onSaved();
    } catch (err) {
      setError(err);
    }
  }
  const fe = fieldErrors(error);
  return (
    <form onSubmit={save} noValidate className={`${card} space-y-3`}>
      <h2 className="text-lg font-bold">Tax rate</h2>
      <p className="text-sm text-slate-600">Applied to the subtotal at checkout. 0 means no tax.</p>
      <Field id="taxRate" label="Tax rate (%)" error={fe.taxRate || (error && !error.fields ? error.message : '')}>
        <input id="taxRate" className={inputCls} inputMode="decimal" value={shown} onChange={(e) => setValue(e.target.value)} aria-invalid={!!error} />
      </Field>
      <button className={btnPrimary} type="submit">Save tax rate</button>
      {ok && <Alert kind="ok">{ok}</Alert>}
    </form>
  );
}

function CategoryPanel({ categories, onChanged }) {
  const [name, setName] = useState('');
  const [editing, setEditing] = useState(null); // { id, name }
  const [error, setError] = useState(null);

  async function run(fn) {
    setError(null);
    try {
      await fn();
      onChanged();
      return true;
    } catch (e) {
      setError(e);
      return false;
    }
  }
  const create = async (e) => {
    e.preventDefault();
    if (await run(() => api.post('/api/menu/categories', { name }))) setName('');
  };
  const rename = async (e) => {
    e.preventDefault();
    if (await run(() => api.put(`/api/menu/categories/${editing.id}`, { name: editing.name }))) setEditing(null);
  };
  const fe = fieldErrors(error);

  return (
    <section className={`${card} space-y-3`} aria-labelledby="cat-h">
      <h2 id="cat-h" className="text-lg font-bold">Categories</h2>
      {error && !error.fields && <Alert>{error.message}</Alert>}
      <form onSubmit={create} noValidate className="flex items-start gap-2">
        <div className="flex-1">
          <label htmlFor="newCat" className="sr-only">New category name</label>
          <input id="newCat" className={inputCls} placeholder="New category name" value={name} onChange={(e) => setName(e.target.value)} aria-invalid={!!fe.name && !editing} />
          {fe.name && !editing && <p role="alert" className="mt-1 text-xs font-medium text-red-700">{fe.name}</p>}
        </div>
        <button className={btnPrimary} type="submit">Add</button>
      </form>
      <table className="w-full text-sm">
        <caption className="sr-only">Categories and dish counts</caption>
        <thead><tr className="border-b text-left"><th scope="col" className="py-2">Name</th><th scope="col" className="py-2">Dishes</th><th scope="col" className="py-2 text-right">Actions</th></tr></thead>
        <tbody>
          {categories.map((c) => (
            <tr key={c.id} className="border-b last:border-0">
              <td className="py-2">
                {editing?.id === c.id ? (
                  <form onSubmit={rename} noValidate className="flex items-start gap-2">
                    <div>
                      <label htmlFor={`rn-${c.id}`} className="sr-only">Category name</label>
                      <input id={`rn-${c.id}`} className={inputCls} value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} autoFocus />
                      {fe.name && <p role="alert" className="mt-1 text-xs font-medium text-red-700">{fe.name}</p>}
                    </div>
                    <button className={btnPrimary} type="submit">Save</button>
                    <button className={btnSecondary} type="button" onClick={() => { setEditing(null); setError(null); }}>Cancel</button>
                  </form>
                ) : c.name}
              </td>
              <td className="py-2">{c.dishCount}</td>
              <td className="py-2 text-right">
                {editing?.id !== c.id && (
                  <span className="inline-flex gap-2">
                    <button className={btnSecondary} onClick={() => setEditing({ id: c.id, name: c.name })} aria-label={`Rename ${c.name}`}>Rename</button>
                    <button className={btnDanger} onClick={() => run(() => api.del(`/api/menu/categories/${c.id}`))} aria-label={`Delete ${c.name}`}>Delete</button>
                  </span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

const emptyDish = { name: '', categoryId: '', sellingPrice: '', targetCost: '' };

export function DishForm({ dish, categories, onClose, onSaved }) {
  const [form, setForm] = useState(
    dish ? { name: dish.name, categoryId: String(dish.categoryId), sellingPrice: dish.sellingPrice, targetCost: dish.targetCost } : { ...emptyDish, categoryId: categories[0] ? String(categories[0].id) : '' }
  );
  const [error, setError] = useState(null);
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  async function save(e) {
    e.preventDefault();
    setError(null);
    const body = {
      name: form.name,
      categoryId: form.categoryId === '' ? null : Number(form.categoryId),
      sellingPrice: form.sellingPrice,
      ...(dish || form.targetCost !== '' ? { targetCost: form.targetCost } : {}),
    };
    try {
      if (dish) await api.put(`/api/menu/dishes/${dish.id}`, body);
      else await api.post('/api/menu/dishes', body);
      onSaved();
      onClose();
    } catch (err) {
      setError(err);
    }
  }
  const fe = fieldErrors(error);
  return (
    <Modal title={dish ? `Edit ${dish.name}` : 'New dish'} onClose={onClose}>
      <form onSubmit={save} noValidate className="space-y-3">
        {error && !error.fields && <Alert>{error.message}</Alert>}
        <Field id="dname" label="Dish name" error={fe.name}>
          <input id="dname" className={inputCls} value={form.name} onChange={set('name')} autoFocus aria-invalid={!!fe.name} />
        </Field>
        <Field id="dcat" label="Category" error={fe.categoryId}>
          <select id="dcat" className={inputCls} value={form.categoryId} onChange={set('categoryId')} aria-invalid={!!fe.categoryId}>
            <option value="">Select a category</option>
            {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </Field>
        <Field id="dprice" label="Selling price" error={fe.sellingPrice}>
          <input id="dprice" className={inputCls} inputMode="decimal" value={form.sellingPrice} onChange={set('sellingPrice')} aria-invalid={!!fe.sellingPrice} />
        </Field>
        <Field id="dtarget" label="Target cost per serving (optional)" error={fe.targetCost} hint="The recipe is set in the Recipe and Pricing Linker.">
          <input id="dtarget" className={inputCls} inputMode="decimal" value={form.targetCost} onChange={set('targetCost')} aria-invalid={!!fe.targetCost} />
        </Field>
        <div className="flex gap-3">
          <button className={btnPrimary} type="submit">Save dish</button>
          <button className={btnSecondary} type="button" onClick={onClose}>Cancel</button>
        </div>
      </form>
    </Modal>
  );
}

export default function MenuManagement() {
  const money = useMoney();
  // Polled so that out-of-stock indicators follow stock changes without a reload (Req 11.8).
  const { data, refresh, loaded } = usePolling((o) => api.get('/api/menu/management', o), { interval: 2000 });
  const [editing, setEditing] = useState(null); // dish | 'new'
  const [confirm, setConfirm] = useState(null);
  const [error, setError] = useState(null);

  async function toggle(d) {
    setError(null);
    try {
      await api.post(`/api/menu/dishes/${d.id}/visibility`, { visible: !d.visible });
      refresh();
    } catch (e) {
      setError(e.message);
    }
  }
  async function doDelete() {
    try {
      await api.post(`/api/menu/dishes/${confirm.id}/delete`, { confirmed: true });
      setConfirm(null);
      refresh();
    } catch (e) {
      setError(e.message);
      setConfirm(null);
    }
  }

  if (!loaded || !data) return <p className="text-slate-600">Loading…</p>;
  return (
    <div className="space-y-5">
      <PageHeader title="Menu Management">
        <button className={btnPrimary} onClick={() => setEditing('new')} disabled={data.categories.length === 0}>New dish</button>
      </PageHeader>
      {error && <Alert>{error}</Alert>}
      {data.availabilityError && <Alert kind="warn">Availability could not be updated.</Alert>}
      <div className="grid gap-5 lg:grid-cols-[1fr_320px]">
        <CategoryPanel categories={data.categories} onChanged={refresh} />
        <TaxForm key={data.tax.taxRate} tax={data.tax} onSaved={refresh} />
      </div>

      <section className={`${card} overflow-x-auto`} aria-labelledby="dish-h">
        <h2 id="dish-h" className="mb-3 text-lg font-bold">Dishes</h2>
        <table className="w-full text-sm">
          <caption className="sr-only">All dishes including hidden ones</caption>
          <thead>
            <tr className="border-b text-left">
              <th scope="col" className="py-2">Dish</th>
              <th scope="col" className="py-2">Category</th>
              <th scope="col" className="py-2 text-right">Price</th>
              <th scope="col" className="py-2">Visibility</th>
              <th scope="col" className="py-2">Stock</th>
              <th scope="col" className="py-2 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {data.dishes.map((d) => (
              <tr key={d.id} className="border-b last:border-0">
                <td className="py-2 font-medium">{d.name}</td>
                <td className="py-2">{d.categoryName}</td>
                <td className="py-2 text-right">{money(d.sellingPrice)}</td>
                <td className="py-2">
                  <button type="button" role="switch" aria-checked={d.visible} onClick={() => toggle(d)} className={`${btnSecondary} !py-1.5`} aria-label={`${d.name} visibility`}>
                    {d.visible ? 'Visible' : 'Hidden'}
                  </button>
                </td>
                <td className="py-2">{d.outOfStock ? <Badge tone="red">Out of stock</Badge> : <Badge tone="green">In stock</Badge>}</td>
                <td className="py-2 text-right">
                  <span className="inline-flex gap-2">
                    <button className={btnSecondary} onClick={() => setEditing(d)} aria-label={`Edit ${d.name}`}>Edit</button>
                    <button className={btnDanger} onClick={() => setConfirm(d)} aria-label={`Delete ${d.name}`}>Delete</button>
                  </span>
                </td>
              </tr>
            ))}
            {data.dishes.length === 0 && <tr><td colSpan={6} className="py-4 text-slate-600">No dishes yet.</td></tr>}
          </tbody>
        </table>
      </section>

      {editing && (
        <DishForm dish={editing === 'new' ? null : editing} categories={data.categories} onClose={() => setEditing(null)} onSaved={refresh} />
      )}
      {confirm && (
        <Modal title="Delete dish?" onClose={() => setConfirm(null)}>
          <p className="text-sm">Delete <strong>{confirm.name}</strong> and its recipe? Past sales keep their recorded details.</p>
          <div className="mt-4 flex gap-3">
            <button className={btnDanger} onClick={doDelete}>Delete dish</button>
            <button className={btnSecondary} onClick={() => setConfirm(null)} autoFocus>Cancel</button>
          </div>
        </Modal>
      )}
    </div>
  );
}
