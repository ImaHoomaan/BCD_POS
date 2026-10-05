'use strict';

// SQL for categories, dishes, ingredients, recipes and settings.

// ---- categories -----------------------------------------------------------------------
function listCategoriesWithCounts(db) {
  return db
    .prepare(
      `SELECT c.id, c.name, COUNT(d.id) AS dishCount
         FROM categories c LEFT JOIN dishes d ON d.category_id = c.id
        GROUP BY c.id ORDER BY c.name COLLATE NOCASE`
    )
    .all();
}
function getCategory(db, id) {
  return db.prepare('SELECT id, name FROM categories WHERE id = ?').get(id);
}
function findCategoryByName(db, name, excludeId = 0) {
  return db.prepare('SELECT id, name FROM categories WHERE name = ? AND id <> ?').get(name, excludeId);
}
function insertCategory(db, name) {
  return Number(db.prepare('INSERT INTO categories (name) VALUES (?)').run(name).lastInsertRowid);
}
function renameCategory(db, id, name) {
  db.prepare('UPDATE categories SET name = ? WHERE id = ?').run(name, id);
}
function deleteCategory(db, id) {
  db.prepare('DELETE FROM categories WHERE id = ?').run(id);
}
function countDishesInCategory(db, id) {
  return db.prepare('SELECT COUNT(*) AS n FROM dishes WHERE category_id = ?').get(id).n;
}

// ---- dishes ---------------------------------------------------------------------------
const DISH_COLUMNS = `d.id, d.name, d.category_id AS categoryId, c.name AS categoryName,
  d.selling_price_cents AS sellingPriceCents, d.target_cost_cents AS targetCostCents, d.visible`;

function listDishes(db) {
  return db
    .prepare(
      `SELECT ${DISH_COLUMNS} FROM dishes d JOIN categories c ON c.id = d.category_id
        ORDER BY c.name COLLATE NOCASE, d.name COLLATE NOCASE`
    )
    .all()
    .map((r) => ({ ...r, visible: r.visible === 1 }));
}
function getDish(db, id) {
  const r = db.prepare(`SELECT ${DISH_COLUMNS} FROM dishes d JOIN categories c ON c.id = d.category_id WHERE d.id = ?`).get(id);
  return r ? { ...r, visible: r.visible === 1 } : undefined;
}
function insertDish(db, { name, categoryId, sellingPriceCents, targetCostCents }) {
  return Number(
    db
      .prepare('INSERT INTO dishes (name, category_id, selling_price_cents, target_cost_cents, visible) VALUES (?, ?, ?, ?, 1)')
      .run(name, categoryId, sellingPriceCents, targetCostCents).lastInsertRowid
  );
}
function updateDish(db, id, { name, categoryId, sellingPriceCents, targetCostCents }) {
  db.prepare('UPDATE dishes SET name = ?, category_id = ?, selling_price_cents = ?, target_cost_cents = ? WHERE id = ?').run(
    name,
    categoryId,
    sellingPriceCents,
    targetCostCents,
    id
  );
}
function updatePricing(db, id, sellingPriceCents, targetCostCents) {
  db.prepare('UPDATE dishes SET selling_price_cents = ?, target_cost_cents = ? WHERE id = ?').run(sellingPriceCents, targetCostCents, id);
}
function setDishVisible(db, id, visible) {
  db.prepare('UPDATE dishes SET visible = ? WHERE id = ?').run(visible ? 1 : 0, id);
}
function deleteDish(db, id) {
  db.prepare('DELETE FROM dishes WHERE id = ?').run(id); // recipe_items cascade
}

// ---- ingredients ------------------------------------------------------------------------
const ING_COLUMNS = 'id, name, unit, unit_cost_cents AS unitCostCents, stock_milli AS stockMilli';
function listIngredients(db) {
  return db.prepare(`SELECT ${ING_COLUMNS} FROM ingredients ORDER BY name COLLATE NOCASE`).all();
}
function getIngredient(db, id) {
  return db.prepare(`SELECT ${ING_COLUMNS} FROM ingredients WHERE id = ?`).get(id);
}
function findIngredientByName(db, name, excludeId = 0) {
  return db.prepare('SELECT id, name FROM ingredients WHERE name = ? AND id <> ?').get(name, excludeId);
}
function insertIngredient(db, { name, unit, unitCostCents, stockMilli }) {
  return Number(
    db
      .prepare('INSERT INTO ingredients (name, unit, unit_cost_cents, stock_milli) VALUES (?, ?, ?, ?)')
      .run(name, unit, unitCostCents, stockMilli).lastInsertRowid
  );
}
function updateIngredient(db, id, { name, unit, unitCostCents, stockMilli }) {
  db.prepare('UPDATE ingredients SET name = ?, unit = ?, unit_cost_cents = ?, stock_milli = ? WHERE id = ?').run(
    name,
    unit,
    unitCostCents,
    stockMilli,
    id
  );
}
function deleteIngredient(db, id) {
  db.prepare('DELETE FROM ingredients WHERE id = ?').run(id);
}
function dishesUsingIngredient(db, ingredientId) {
  return db
    .prepare(
      `SELECT DISTINCT d.name FROM recipe_items r JOIN dishes d ON d.id = r.dish_id
        WHERE r.ingredient_id = ? ORDER BY d.name COLLATE NOCASE`
    )
    .all(ingredientId)
    .map((r) => r.name);
}
function recipeItemsForIngredient(db, ingredientId) {
  return db.prepare('SELECT dish_id AS dishId, qty_milli AS qtyMilli FROM recipe_items WHERE ingredient_id = ?').all(ingredientId);
}

// ---- recipes ------------------------------------------------------------------------------
const RECIPE_SELECT = `SELECT r.dish_id AS dishId, r.ingredient_id AS ingredientId, r.qty_milli AS qtyMilli,
  i.name AS ingredientName, i.unit, i.unit_cost_cents AS unitCostCents, i.stock_milli AS stockMilli
  FROM recipe_items r JOIN ingredients i ON i.id = r.ingredient_id`;

function getRecipeRows(db, dishId) {
  return db.prepare(`${RECIPE_SELECT} WHERE r.dish_id = ? ORDER BY i.name COLLATE NOCASE`).all(dishId);
}
function getAllRecipeRows(db) {
  return db.prepare(`${RECIPE_SELECT} ORDER BY r.dish_id`).all();
}
function getRecipeRowsForDishes(db, dishIds) {
  if (dishIds.length === 0) return [];
  const marks = dishIds.map(() => '?').join(',');
  return db.prepare(`${RECIPE_SELECT} WHERE r.dish_id IN (${marks})`).all(...dishIds);
}
function countRecipeItems(db, dishId) {
  return db.prepare('SELECT COUNT(*) AS n FROM recipe_items WHERE dish_id = ?').get(dishId).n;
}
function getRecipeItem(db, dishId, ingredientId) {
  return db.prepare('SELECT dish_id AS dishId, ingredient_id AS ingredientId, qty_milli AS qtyMilli FROM recipe_items WHERE dish_id = ? AND ingredient_id = ?').get(dishId, ingredientId);
}
function insertRecipeItem(db, dishId, ingredientId, qtyMilli) {
  db.prepare('INSERT INTO recipe_items (dish_id, ingredient_id, qty_milli) VALUES (?, ?, ?)').run(dishId, ingredientId, qtyMilli);
}
function updateRecipeItem(db, dishId, ingredientId, qtyMilli) {
  db.prepare('UPDATE recipe_items SET qty_milli = ? WHERE dish_id = ? AND ingredient_id = ?').run(qtyMilli, dishId, ingredientId);
}
function deleteRecipeItem(db, dishId, ingredientId) {
  db.prepare('DELETE FROM recipe_items WHERE dish_id = ? AND ingredient_id = ?').run(dishId, ingredientId);
}

// ---- settings -------------------------------------------------------------------------------
function getSetting(db, key) {
  const r = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return r ? r.value : undefined;
}
function setSetting(db, key, value) {
  db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, String(value));
}

module.exports = {
  listCategoriesWithCounts,
  getCategory,
  findCategoryByName,
  insertCategory,
  renameCategory,
  deleteCategory,
  countDishesInCategory,
  listDishes,
  getDish,
  insertDish,
  updateDish,
  updatePricing,
  setDishVisible,
  deleteDish,
  listIngredients,
  getIngredient,
  findIngredientByName,
  insertIngredient,
  updateIngredient,
  deleteIngredient,
  dishesUsingIngredient,
  recipeItemsForIngredient,
  getRecipeRows,
  getAllRecipeRows,
  getRecipeRowsForDishes,
  countRecipeItems,
  getRecipeItem,
  insertRecipeItem,
  updateRecipeItem,
  deleteRecipeItem,
  getSetting,
  setSetting,
};
