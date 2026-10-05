'use strict';

// Role-Based Access Control. This file is the single source of truth for who may do what.
// The UI builds its navigation from NAV_ITEMS, but link visibility is cosmetic: every
// service calls authorize() and every route uses requires(), independent of the UI.

const { Unauthenticated, PermissionDenied } = require('../lib/errors');

const Role = Object.freeze({ OWNER: 'owner', CASHIER: 'cashier' });

const Permission = Object.freeze({
  VIEW_TERMINAL: 'VIEW_TERMINAL',
  BUILD_ORDER: 'BUILD_ORDER',
  SUBMIT_ORDER: 'SUBMIT_ORDER',
  VIEW_AVAILABLE_MENU: 'VIEW_AVAILABLE_MENU',
  VIEW_MENU_MANAGEMENT: 'VIEW_MENU_MANAGEMENT',
  MANAGE_CATEGORIES: 'MANAGE_CATEGORIES',
  MANAGE_DISHES: 'MANAGE_DISHES',
  MANAGE_TAX_RATE: 'MANAGE_TAX_RATE',
  VIEW_INGREDIENTS: 'VIEW_INGREDIENTS',
  MANAGE_INGREDIENTS: 'MANAGE_INGREDIENTS',
  VIEW_RECIPES: 'VIEW_RECIPES',
  MANAGE_RECIPES: 'MANAGE_RECIPES',
  VIEW_DASHBOARD: 'VIEW_DASHBOARD',
  VIEW_TRANSACTION_LOG: 'VIEW_TRANSACTION_LOG',
});

const ALL_PERMISSIONS = Object.values(Permission);

const ROLE_PERMISSIONS = Object.freeze({
  [Role.CASHIER]: new Set([
    Permission.VIEW_TERMINAL,
    Permission.BUILD_ORDER,
    Permission.SUBMIT_ORDER,
    Permission.VIEW_AVAILABLE_MENU,
  ]),
  [Role.OWNER]: new Set(ALL_PERMISSIONS),
});

// Screens (client routes). Cashier sees exactly two; Owner sees all six (Req 4.1, 4.2).
const NAV_ITEMS = Object.freeze([
  { key: 'terminal', label: 'POS Terminal', path: '/terminal', permission: Permission.VIEW_TERMINAL },
  { key: 'menu', label: 'Available Menu List', path: '/menu', permission: Permission.VIEW_AVAILABLE_MENU },
  { key: 'menu-management', label: 'Menu Management', path: '/menu-management', permission: Permission.VIEW_MENU_MANAGEMENT },
  { key: 'ingredients', label: 'Ingredient Stock Manager', path: '/ingredients', permission: Permission.VIEW_INGREDIENTS },
  { key: 'recipes', label: 'Recipe and Pricing Linker', path: '/recipes', permission: Permission.VIEW_RECIPES },
  { key: 'dashboard', label: 'Dashboard', path: '/dashboard', permission: Permission.VIEW_DASHBOARD },
]);

function can(actor, permission) {
  if (!actor) return false;
  const set = ROLE_PERMISSIONS[actor.role];
  return !!set && set.has(permission);
}

// Fail closed: an unknown permission name is a programming error, never an allowance.
function authorize(actor, permission) {
  if (!ALL_PERMISSIONS.includes(permission)) throw new Error(`Unknown permission: ${permission}`);
  if (!actor) throw new Unauthenticated();
  if (!can(actor, permission)) throw new PermissionDenied();
}

function navFor(role) {
  const set = ROLE_PERMISSIONS[role];
  return NAV_ITEMS.filter((n) => set && set.has(n.permission)).map(({ key, label, path }) => ({ key, label, path }));
}

function homePathFor(role) {
  return role === Role.OWNER ? '/dashboard' : '/terminal';
}

module.exports = { Role, Permission, ALL_PERMISSIONS, ROLE_PERMISSIONS, NAV_ITEMS, can, authorize, navFor, homePathFor };
