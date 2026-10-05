'use strict';

const express = require('express');
const { Permission } = require('../auth/rbac');
const { toId } = require('../http/middleware');
const ingredients = require('./ingredients');
const recipes = require('./recipes');

// Mounted at /api; defines /ingredients and /recipes.
module.exports = function inventoryRoutes({ db, http }) {
  const r = express.Router();
  const { requires } = http;

  r.get('/ingredients', requires(Permission.VIEW_INGREDIENTS), (req, res) => {
    res.json({ ingredients: ingredients.listIngredients(db, req.principal) });
  });
  r.post('/ingredients', requires(Permission.MANAGE_INGREDIENTS), (req, res) => {
    res.status(201).json(ingredients.createIngredient(db, req.principal, req.body));
  });
  r.put('/ingredients/:id', requires(Permission.MANAGE_INGREDIENTS), (req, res) => {
    res.json(ingredients.updateIngredient(db, req.principal, toId(req.params.id), req.body));
  });
  r.delete('/ingredients/:id', requires(Permission.MANAGE_INGREDIENTS), (req, res) => {
    res.json(ingredients.deleteIngredient(db, req.principal, toId(req.params.id)));
  });

  r.get('/recipes', requires(Permission.VIEW_RECIPES), (req, res) => {
    res.json(recipes.listRecipes(db, req.principal));
  });
  r.get('/recipes/:dishId', requires(Permission.VIEW_RECIPES), (req, res) => {
    res.json(recipes.getRecipe(db, req.principal, toId(req.params.dishId)));
  });
  r.put('/recipes/:dishId/pricing', requires(Permission.MANAGE_RECIPES), (req, res) => {
    res.json(recipes.setPricing(db, req.principal, toId(req.params.dishId), req.body || {}));
  });
  r.post('/recipes/:dishId/items', requires(Permission.MANAGE_RECIPES), (req, res) => {
    const body = req.body || {};
    res.status(201).json(recipes.addRecipeItem(db, req.principal, toId(req.params.dishId), { ingredientId: Number(body.ingredientId), quantity: body.quantity }));
  });
  r.put('/recipes/:dishId/items/:ingredientId', requires(Permission.MANAGE_RECIPES), (req, res) => {
    res.json(recipes.updateRecipeItem(db, req.principal, toId(req.params.dishId), toId(req.params.ingredientId), req.body || {}));
  });
  r.delete('/recipes/:dishId/items/:ingredientId', requires(Permission.MANAGE_RECIPES), (req, res) => {
    res.json(recipes.removeRecipeItem(db, req.principal, toId(req.params.dishId), toId(req.params.ingredientId)));
  });

  return r;
};
