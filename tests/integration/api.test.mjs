import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import request from 'supertest';
import fc from 'fast-check';

const require = createRequire(import.meta.url);
const { createApp } = require('../../server/app');
const { makeDb, makeClock, actorFor } = require('../helpers');
const { dumpDatabase } = require('../../server/db/connection');
const { ROLE_PERMISSIONS, Permission, NAV_ITEMS } = require('../../server/auth/rbac');
const { PermissionDenied, Unauthenticated } = require('../../server/lib/errors');

const categories = require('../../server/menu/categories');
const dishes = require('../../server/menu/dishes');
const settings = require('../../server/menu/settings');
const ingredients = require('../../server/inventory/ingredients');
const recipes = require('../../server/inventory/recipes');
const dashboardSummary = require('../../server/dashboard/summary');
const txlog = require('../../server/dashboard/txlog');
const terminalCatalog = require('../../server/terminal/catalog');
const available = require('../../server/menu/available');

const PASSWORDS = { Owner: 'Owner@123', 'Cashier 1': 'Cashier1@123', 'Cashier 2': 'Cashier2@123', 'Cashier 3': 'Cashier3@123' };

let clientDir;
beforeAll(() => {
  clientDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pos-client-'));
  fs.writeFileSync(path.join(clientDir, 'index.html'), '<!doctype html><title>APP SHELL</title>');
});
afterAll(() => fs.rmSync(clientDir, { recursive: true, force: true }));

function boot() {
  const db = makeDb({ seed: true });
  const clock = makeClock();
  const app = createApp({ db, clock, clientDir });
  return { db, clock, app };
}

async function signIn(app, username) {
  const agent = request.agent(app);
  const res = await agent.post('/api/auth/login').send({ username, password: PASSWORDS[username] });
  expect(res.status).toBe(200);
  return { agent, csrf: res.body.csrfToken, body: res.body };
}
const send = (s, method, url, body) => {
  const r = s.agent[method](url).set('X-CSRF-Token', s.csrf);
  return body === undefined ? r : r.send(body);
};

describe('authentication and routing', () => {
  it('routes by role and shows exactly the allowed navigation', async () => {
    const { app } = boot();
    const owner = await signIn(app, 'Owner');
    expect(owner.body.home).toBe('/dashboard');
    expect(owner.body.nav.map((n) => n.path)).toEqual(NAV_ITEMS.map((n) => n.path)); // all six
    expect(owner.body.nav).toHaveLength(6);

    const cashier = await signIn(app, 'Cashier 2');
    expect(cashier.body.home).toBe('/terminal');
    expect(cashier.body.nav.map((n) => n.path)).toEqual(['/terminal', '/menu']);
  });

  it('gives one generic message for an unknown user and a wrong password', async () => {
    const { app } = boot();
    const a = await request(app).post('/api/auth/login').send({ username: 'ghost', password: 'nope' });
    const b = await request(app).post('/api/auth/login').send({ username: 'Owner', password: 'nope' });
    expect(a.status).toBe(401);
    expect(b.status).toBe(401);
    expect(a.body.error.message).toBe(b.body.error.message);
    expect(a.headers['set-cookie']).toBeUndefined();
  });

  it('locks a username after 5 failures, even for the correct password', async () => {
    const { app } = boot();
    for (let i = 0; i < 5; i++) await request(app).post('/api/auth/login').send({ username: 'Cashier 3', password: 'bad' });
    const res = await request(app).post('/api/auth/login').send({ username: 'Cashier 3', password: PASSWORDS['Cashier 3'] });
    expect(res.status).toBe(429);
  });

  it('requires a CSRF token for state changes inside a session', async () => {
    const { app } = boot();
    const s = await signIn(app, 'Cashier 1');
    const res = await s.agent.post('/api/terminal/order/clear').send({});
    expect(res.status).toBe(403);
  });

  it('expires after 30 idle minutes but polling does not keep it alive', async () => {
    const { app, clock } = boot();
    const s = await signIn(app, 'Cashier 1');
    clock.advance(20 * 60_000);
    expect((await s.agent.get('/api/terminal/catalog').set('X-Background', '1')).status).toBe(200);
    clock.advance(11 * 60_000); // 31 minutes since the last real activity
    const res = await s.agent.get('/api/terminal/catalog');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('session_expired');
  });

  it('user activity extends the session', async () => {
    const { app, clock } = boot();
    const s = await signIn(app, 'Cashier 1');
    clock.advance(25 * 60_000);
    expect((await send(s, 'post', '/api/auth/activity', {})).status).toBe(204);
    clock.advance(25 * 60_000);
    expect((await s.agent.get('/api/terminal/catalog')).status).toBe(200);
  });

  it('logout ends the session', async () => {
    const { app } = boot();
    const s = await signIn(app, 'Owner');
    expect((await send(s, 'post', '/api/auth/logout', {})).status).toBe(204);
    expect((await s.agent.get('/api/auth/me')).status).toBe(401);
  });
});

describe('screen protection on the server (direct URL access)', () => {
  const html = { Accept: 'text/html' };

  it('redirects to login without a session', async () => {
    const { app } = boot();
    for (const n of NAV_ITEMS) {
      const res = await request(app).get(n.path).set(html);
      expect(res.status, n.path).toBe(302);
      expect(res.headers.location).toBe('/login');
    }
  });

  it('denies cashiers every owner screen without sending any app content', async () => {
    const { app } = boot();
    const s = await signIn(app, 'Cashier 1');
    for (const p of ['/menu-management', '/ingredients', '/recipes', '/dashboard']) {
      const res = await s.agent.get(p).set(html);
      expect(res.status, p).toBe(403);
      expect(res.text).toContain('Access denied');
      expect(res.text).not.toContain('APP SHELL');
    }
    for (const p of ['/terminal', '/menu']) {
      const res = await s.agent.get(p).set(html);
      expect(res.status, p).toBe(200);
      expect(res.text).toContain('APP SHELL');
    }
    expect((await s.agent.get('/api/auth/me')).status).toBe(200); // session still active
  });

  it('lets the owner open everything', async () => {
    const { app } = boot();
    const s = await signIn(app, 'Owner');
    for (const n of NAV_ITEMS) expect((await s.agent.get(n.path).set(html)).status, n.path).toBe(200);
  });
});

// ---- Property 17: permission matrix ----------------------------------------------------------
const ROUTES = [
  // [method, url, body, permission]
  ['get', '/api/terminal/catalog', undefined, Permission.VIEW_TERMINAL],
  ['get', '/api/terminal/order', undefined, Permission.VIEW_TERMINAL],
  ['post', '/api/terminal/order/clear', {}, Permission.BUILD_ORDER],
  ['get', '/api/menu/available', undefined, Permission.VIEW_AVAILABLE_MENU],
  ['get', '/api/menu/management', undefined, Permission.VIEW_MENU_MANAGEMENT],
  ['post', '/api/menu/categories', { name: 'Hacked' }, Permission.MANAGE_CATEGORIES],
  ['put', '/api/menu/categories/1', { name: 'Hacked' }, Permission.MANAGE_CATEGORIES],
  ['delete', '/api/menu/categories/1', undefined, Permission.MANAGE_CATEGORIES],
  ['post', '/api/menu/dishes', { name: 'X', categoryId: 1, sellingPrice: '1.00' }, Permission.MANAGE_DISHES],
  ['put', '/api/menu/dishes/1', { name: 'X', categoryId: 1, sellingPrice: '0.01' }, Permission.MANAGE_DISHES],
  ['post', '/api/menu/dishes/1/visibility', { visible: false }, Permission.MANAGE_DISHES],
  ['post', '/api/menu/dishes/1/delete', { confirmed: true }, Permission.MANAGE_DISHES],
  ['put', '/api/menu/tax', { taxRate: '50' }, Permission.MANAGE_TAX_RATE],
  ['get', '/api/ingredients', undefined, Permission.VIEW_INGREDIENTS],
  ['post', '/api/ingredients', { name: 'Evil', unit: 'grams', unitCost: '1.00', stock: '1' }, Permission.MANAGE_INGREDIENTS],
  ['put', '/api/ingredients/1', { name: 'Evil', unit: 'grams', unitCost: '1.00', stock: '1' }, Permission.MANAGE_INGREDIENTS],
  ['delete', '/api/ingredients/1', undefined, Permission.MANAGE_INGREDIENTS],
  ['get', '/api/recipes', undefined, Permission.VIEW_RECIPES],
  ['get', '/api/recipes/1', undefined, Permission.VIEW_RECIPES],
  ['put', '/api/recipes/1/pricing', { sellingPrice: '0.01', targetCost: '0.00' }, Permission.MANAGE_RECIPES],
  ['post', '/api/recipes/1/items', { ingredientId: 1, quantity: '1' }, Permission.MANAGE_RECIPES],
  ['put', '/api/recipes/1/items/1', { quantity: '1' }, Permission.MANAGE_RECIPES],
  ['delete', '/api/recipes/1/items/1', undefined, Permission.MANAGE_RECIPES],
  ['get', '/api/dashboard/summary', undefined, Permission.VIEW_DASHBOARD],
  ['get', '/api/dashboard/cashiers', undefined, Permission.VIEW_TRANSACTION_LOG],
  ['get', '/api/dashboard/transactions', undefined, Permission.VIEW_TRANSACTION_LOG],
  ['get', '/api/dashboard/transactions/1', undefined, Permission.VIEW_TRANSACTION_LOG],
];

describe('permission matrix', () => {
  // Feature: restaurant-pos-system, Property 17: Permission matrix enforcement
  it('every route: allowed iff the role holds the permission; denials change nothing', async () => {
    const { app, db } = boot();
    const sessions = { none: null, owner: await signIn(app, 'Owner'), cashier: await signIn(app, 'Cashier 1') };
    const cases = ROUTES.flatMap((r) => ['none', 'owner', 'cashier'].map((who) => [r, who]));
    const business = () => dumpDatabase(db, { exclude: ['sessions', 'login_attempts'] });

    // The domain is small and fully enumerable; fast-check draws every combination in random order.
    const samples = fc.sample(fc.constantFrom(...cases), { numRuns: cases.length * 4, seed: 7 });
    const seen = new Set(samples.map((c) => `${c[0][1]}|${c[1]}`));
    for (const c of cases) if (!seen.has(`${c[0][1]}|${c[1]}`)) samples.push(c);

    for (const [[method, url, body, permission], who] of samples) {
      const before = business();
      let res;
      if (who === 'none') {
        res = await (body === undefined ? request(app)[method](url) : request(app)[method](url).send(body));
      } else {
        res = await send(sessions[who], method, url, body);
      }
      const allowed = who !== 'none' && ROLE_PERMISSIONS[who].has(permission);
      const label = `${who} ${method.toUpperCase()} ${url}`;
      if (allowed) {
        expect([401, 403], label).not.toContain(res.status);
      } else {
        expect(res.status, label).toBe(who === 'none' ? 401 : 403);
        expect(business(), label).toBe(before); // stored data unchanged
        expect(JSON.stringify(res.body), label).not.toMatch(/"(groups|dishes|ingredients|transactions|gross)"/); // no content leaked
      }
    }
    // a denied cashier is still signed in
    expect((await sessions.cashier.agent.get('/api/auth/me')).status).toBe(200);
  });

  it('services refuse direct calls from a cashier and leave data unchanged', () => {
    const db = makeDb({ seed: true });
    const cashier = actorFor(db, 'Cashier 1');
    const owner = actorFor(db, 'Owner');
    const calls = [
      () => categories.createCategory(db, cashier, { name: 'Nope' }),
      () => categories.deleteCategory(db, cashier, 1),
      () => dishes.saveDish(db, cashier, 1, { name: 'x', categoryId: 1, sellingPrice: '1.00' }),
      () => dishes.setVisibility(db, cashier, 1, false),
      () => dishes.deleteDish(db, cashier, 1, true),
      () => settings.setTaxRate(db, cashier, { taxRate: '10' }),
      () => ingredients.createIngredient(db, cashier, { name: 'N', unit: 'ml', unitCost: '1', stock: '1' }),
      () => ingredients.updateIngredient(db, cashier, 1, { name: 'N', unit: 'ml', unitCost: '1', stock: '1' }),
      () => ingredients.deleteIngredient(db, cashier, 1),
      () => recipes.setPricing(db, cashier, 1, { sellingPrice: '1', targetCost: '1' }),
      () => recipes.addRecipeItem(db, cashier, 1, { ingredientId: 1, quantity: '1' }),
      () => dashboardSummary.dashboardSummary(db, cashier, 'today', new Date()),
      () => txlog.searchTransactions(db, cashier, { page: 1 }),
      () => dishes.listDishes(db, cashier),
    ];
    const before = dumpDatabase(db);
    for (const call of calls) expect(call).toThrow(PermissionDenied);
    expect(dumpDatabase(db)).toBe(before);

    // No actor at all is "unauthenticated", not "forbidden".
    expect(() => categories.createCategory(db, null, { name: 'x' })).toThrow(Unauthenticated);
    expect(() => terminalCatalog.terminalCatalog(db, null)).toThrow(Unauthenticated);

    // Cashiers keep the two screens they are allowed.
    expect(() => terminalCatalog.terminalCatalog(db, cashier)).not.toThrow();
    expect(() => available.availableMenuList(db, cashier)).not.toThrow();
    // The owner is never denied.
    expect(() => dishes.listDishes(db, owner)).not.toThrow();
    expect(() => txlog.searchTransactions(db, owner, { page: 1 })).not.toThrow();
    db.close();
  });
});

describe('cashier sale, end to end over HTTP', () => {
  it('builds an order, checks out, deducts stock, and replays a repeated submission', async () => {
    const { app, db } = boot();
    const s = await signIn(app, 'Cashier 1');
    const stockBefore = db.prepare("SELECT stock_milli s FROM ingredients WHERE name = 'Potato'").get().s;

    const fries = (await s.agent.get('/api/terminal/catalog')).body.categories.flatMap((c) => c.dishes).find((d) => d.name === 'French Fries');
    let o = (await send(s, 'post', '/api/terminal/order/add', { dishId: fries.id })).body;
    o = (await send(s, 'post', '/api/terminal/order/add', { dishId: fries.id })).body;
    expect(o.lines[0].quantity).toBe(2);
    expect(o.subtotal).toBe('11.00');

    // invalid quantity keeps the previous one and explains why
    const bad = await send(s, 'post', '/api/terminal/order/quantity', { dishId: fries.id, quantity: '100' });
    expect(bad.status).toBe(422);
    expect((await s.agent.get('/api/terminal/order')).body.lines[0].quantity).toBe(2);

    // the Owner sets 10% tax; the cashier's checkout picks it up
    const owner = await signIn(app, 'Owner');
    expect((await send(owner, 'put', '/api/menu/tax', { taxRate: '10' })).status).toBe(200);

    const co = (await send(s, 'post', '/api/terminal/checkout', {})).body;
    expect(co.totals).toMatchObject({ subtotal: '11.00', tax: '1.10', total: '12.10' });
    expect((await send(s, 'post', '/api/terminal/tender', { cashTendered: '12.00' })).body).toMatchObject({ kind: 'short', remaining: '0.10' });
    expect((await send(s, 'post', '/api/terminal/tender', { cashTendered: '20' })).body).toMatchObject({ kind: 'sufficient', change: '7.90' });
    expect((await send(s, 'post', '/api/terminal/tender', { cashTendered: '' })).body.kind).toBe('invalid');

    const tooLittle = await send(s, 'post', '/api/terminal/submit', { submissionId: co.submissionId, cashTendered: '5.00' });
    expect(tooLittle.status).toBe(422);
    expect(tooLittle.body.error.detail.rule).toBe('cash_below_total');
    expect((await s.agent.get('/api/terminal/order')).body.lines).toHaveLength(1); // order kept

    const done = await send(s, 'post', '/api/terminal/submit', { submissionId: co.submissionId, cashTendered: '20.00' });
    expect(done.status).toBe(200);
    expect(done.body.receipt).toMatchObject({ subtotal: '11.00', tax: '1.10', total: '12.10', cashTendered: '20.00', changeDue: '7.90', cashierName: 'Cashier 1' });
    expect(done.body.order.isEmpty).toBe(true); // new empty order

    const stockAfter = db.prepare("SELECT stock_milli s FROM ingredients WHERE name = 'Potato'").get().s;
    expect(stockBefore - stockAfter).toBe(2 * 200 * 1000); // 2 servings x 200 g

    const again = await send(s, 'post', '/api/terminal/submit', { submissionId: co.submissionId, cashTendered: '20.00' });
    expect(again.body.replayed).toBe(true);
    expect(again.body.receipt.receiptNumber).toBe(done.body.receipt.receiptNumber);
    expect(db.prepare("SELECT stock_milli s FROM ingredients WHERE name = 'Potato'").get().s).toBe(stockAfter);

    // the owner sees it in the transaction log
    const log = (await owner.agent.get('/api/dashboard/transactions').query({ search: done.body.receipt.receiptNumber.toLowerCase() })).body;
    expect(log.total).toBe(1);
    expect(log.rows[0].cashierName).toBe('Cashier 1');
  });

  it('refuses to open checkout for an empty order', async () => {
    const { app } = boot();
    const s = await signIn(app, 'Cashier 1');
    const res = await send(s, 'post', '/api/terminal/checkout', {});
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('order_empty');
  });

  it('keeps the order across visits to the Available Menu List', async () => {
    const { app } = boot();
    const s = await signIn(app, 'Cashier 1');
    const dish = (await s.agent.get('/api/terminal/catalog')).body.categories[0].dishes.find((d) => d.available);
    await send(s, 'post', '/api/terminal/order/add', { dishId: dish.id });
    expect((await s.agent.get('/api/menu/available')).status).toBe(200);
    expect((await s.agent.get('/api/terminal/order')).body.lines).toHaveLength(1);
  });
});
