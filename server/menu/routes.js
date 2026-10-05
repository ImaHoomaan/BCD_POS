'use strict';

const express = require('express');
const { Permission } = require('../auth/rbac');
const { toId } = require('../http/middleware');
const categories = require('./categories');
const dishes = require('./dishes');
const settings = require('./settings');
const { availableMenuList } = require('./available');

module.exports = function menuRoutes({ db, http }) {
  const r = express.Router();
  const { requires } = http;

  // Read-only list for cashiers and the owner. Polled by the UI.
  r.get('/available', requires(Permission.VIEW_AVAILABLE_MENU), (req, res) => {
    res.json(availableMenuList(db, req.principal));
  });

  // Everything the Menu Management screen needs in one call.
  r.get('/management', requires(Permission.VIEW_MENU_MANAGEMENT), (req, res) => {
    const d = dishes.listDishes(db, req.principal);
    res.json({
      categories: categories.listCategories(db, req.principal),
      dishes: d.dishes,
      availabilityError: d.availabilityError,
      tax: settings.getTaxRate(db, req.principal),
    });
  });

  r.post('/categories', requires(Permission.MANAGE_CATEGORIES), (req, res) => {
    res.status(201).json(categories.createCategory(db, req.principal, req.body || {}));
  });
  r.put('/categories/:id', requires(Permission.MANAGE_CATEGORIES), (req, res) => {
    res.json(categories.renameCategory(db, req.principal, toId(req.params.id), req.body || {}));
  });
  r.delete('/categories/:id', requires(Permission.MANAGE_CATEGORIES), (req, res) => {
    res.json(categories.deleteCategory(db, req.principal, toId(req.params.id)));
  });

  r.post('/dishes', requires(Permission.MANAGE_DISHES), (req, res) => {
    res.status(201).json(dishes.saveDish(db, req.principal, null, req.body));
  });
  r.put('/dishes/:id', requires(Permission.MANAGE_DISHES), (req, res) => {
    res.json(dishes.saveDish(db, req.principal, toId(req.params.id), req.body));
  });
  r.post('/dishes/:id/visibility', requires(Permission.MANAGE_DISHES), (req, res) => {
    res.json(dishes.setVisibility(db, req.principal, toId(req.params.id), req.body?.visible === true));
  });
  r.post('/dishes/:id/delete', requires(Permission.MANAGE_DISHES), (req, res) => {
    res.json(dishes.deleteDish(db, req.principal, toId(req.params.id), req.body?.confirmed === true));
  });

  r.put('/tax', requires(Permission.MANAGE_TAX_RATE), (req, res) => {
    res.json(settings.setTaxRate(db, req.principal, req.body || {}));
  });

  return r;
};
