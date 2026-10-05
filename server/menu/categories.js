'use strict';

const catalog = require('../db/repos/catalog');
const { write } = require('../db/connection');
const { authorize, Permission } = require('../auth/rbac');
const { Conflict, NotFound, ValidationError } = require('../lib/errors');

function cleanName(input) {
  const name = typeof input === 'string' ? input.trim() : '';
  if (name.length === 0) throw new ValidationError({ name: 'Category name is required (empty).' });
  if ([...name].length > 50) throw new ValidationError({ name: 'Category name is too long (50 characters maximum).' });
  return name;
}

function listCategories(db, actor) {
  authorize(actor, Permission.VIEW_MENU_MANAGEMENT);
  return catalog.listCategoriesWithCounts(db);
}

function createCategory(db, actor, { name }) {
  authorize(actor, Permission.MANAGE_CATEGORIES);
  const clean = cleanName(name);
  return write(db, () => {
    if (catalog.findCategoryByName(db, clean)) {
      throw new ValidationError({ name: 'A category with this name already exists (duplicate).' });
    }
    const id = catalog.insertCategory(db, clean);
    return { id, name: clean, dishCount: 0 };
  });
}

function renameCategory(db, actor, id, { name }) {
  authorize(actor, Permission.MANAGE_CATEGORIES);
  const clean = cleanName(name);
  return write(db, () => {
    if (!catalog.getCategory(db, id)) throw new NotFound('Category not found.');
    if (catalog.findCategoryByName(db, clean, id)) {
      throw new ValidationError({ name: 'A category with this name already exists (duplicate).' });
    }
    catalog.renameCategory(db, id, clean);
    return { id, name: clean, dishCount: catalog.countDishesInCategory(db, id) };
  });
}

function deleteCategory(db, actor, id) {
  authorize(actor, Permission.MANAGE_CATEGORIES);
  return write(db, () => {
    if (!catalog.getCategory(db, id)) throw new NotFound('Category not found.');
    const count = catalog.countDishesInCategory(db, id);
    if (count > 0) {
      throw new Conflict('category_not_empty', `This category contains ${count} dish${count === 1 ? '' : 'es'} and cannot be deleted.`, { count });
    }
    catalog.deleteCategory(db, id);
    return { deleted: true };
  });
}

module.exports = { listCategories, createCategory, renameCategory, deleteCategory };
