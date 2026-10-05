'use strict';

// Demo Seed_Data. Every record has a natural key (username, name, submission id) so the
// seed script is idempotent: running it any number of times leaves one copy of each record.

// Documented in docs/README.md. Change these before real use.
const USERS = [
  { username: 'Owner', role: 'owner', password: 'Owner@123' },
  { username: 'Cashier 1', role: 'cashier', password: 'Cashier1@123' },
  { username: 'Cashier 2', role: 'cashier', password: 'Cashier2@123' },
  { username: 'Cashier 3', role: 'cashier', password: 'Cashier3@123' },
];

const CATEGORIES = ['Starters', 'Mains', 'Drinks', 'Desserts'];

// unitCost is money per ONE unit (per gram, per ml or per piece), in dollars-and-cents text.
// stock is a quantity text in the ingredient's unit.
const INGREDIENTS = [
  { name: 'Chicken Breast', unit: 'grams', unitCost: '0.03', stock: '12000' },
  { name: 'Beef Patty', unit: 'pcs', unitCost: '1.50', stock: '40' },
  { name: 'Pork Belly', unit: 'grams', unitCost: '0.03', stock: '8000' },
  { name: 'White Rice', unit: 'grams', unitCost: '0.01', stock: '30000' },
  { name: 'Spaghetti', unit: 'grams', unitCost: '0.01', stock: '15000' },
  { name: 'Tomato Sauce', unit: 'ml', unitCost: '0.01', stock: '9000' },
  { name: 'Cooking Oil', unit: 'ml', unitCost: '0.01', stock: '10000' },
  { name: 'Burger Bun', unit: 'pcs', unitCost: '0.50', stock: '60' },
  { name: 'Cheddar Slice', unit: 'pcs', unitCost: '0.40', stock: '80' },
  { name: 'Lettuce', unit: 'grams', unitCost: '0.01', stock: '3000' },
  { name: 'Potato', unit: 'grams', unitCost: '0.01', stock: '20000' },
  { name: 'Egg', unit: 'pcs', unitCost: '0.20', stock: '120' },
  { name: 'Flour', unit: 'grams', unitCost: '0.01', stock: '25000' },
  { name: 'Sugar', unit: 'grams', unitCost: '0.01', stock: '10000' },
  { name: 'Milk', unit: 'ml', unitCost: '0.01', stock: '20000' },
  { name: 'Coffee Beans', unit: 'grams', unitCost: '0.05', stock: '4000' },
  // Low stock on purpose: Iced Cola needs 60 ml per serving, so it seeds as unavailable.
  { name: 'Cola Syrup', unit: 'ml', unitCost: '0.01', stock: '20' },
  { name: 'Chocolate', unit: 'grams', unitCost: '0.04', stock: '3000' },
  // Out of stock on purpose: Fresh Lemonade seeds as unavailable.
  { name: 'Lemon', unit: 'pcs', unitCost: '0.30', stock: '0' },
];

const DISHES = [
  { name: 'French Fries', category: 'Starters', price: '5.50', target: '2.50', visible: true,
    recipe: [['Potato', '200'], ['Cooking Oil', '30']] },
  { name: 'Chicken Wings', category: 'Starters', price: '9.00', target: '4.50', visible: true,
    recipe: [['Chicken Breast', '150'], ['Cooking Oil', '20']] },
  { name: 'Classic Burger', category: 'Mains', price: '9.50', target: '3.00', visible: true,
    recipe: [['Beef Patty', '1'], ['Burger Bun', '1'], ['Cheddar Slice', '1'], ['Lettuce', '20']] },
  { name: 'Chicken Rice Bowl', category: 'Mains', price: '11.00', target: '7.00', visible: true,
    recipe: [['Chicken Breast', '150'], ['White Rice', '200'], ['Cooking Oil', '10']] },
  { name: 'Spaghetti Pomodoro', category: 'Mains', price: '10.00', target: '3.00', visible: true,
    recipe: [['Spaghetti', '150'], ['Tomato Sauce', '120'], ['Cooking Oil', '10']] },
  { name: 'Pork Belly Plate', category: 'Mains', price: '13.50', target: '8.00', visible: true,
    recipe: [['Pork Belly', '200'], ['White Rice', '200']] },
  { name: 'Egg Fried Rice', category: 'Mains', price: '7.00', target: '2.50', visible: true,
    recipe: [['White Rice', '200'], ['Egg', '2'], ['Cooking Oil', '15']] },
  { name: 'Iced Cola', category: 'Drinks', price: '2.50', target: '0.70', visible: true,
    recipe: [['Cola Syrup', '60']] },
  { name: 'Fresh Lemonade', category: 'Drinks', price: '3.50', target: '0.60', visible: true,
    recipe: [['Lemon', '1'], ['Sugar', '20']] },
  { name: 'Latte', category: 'Drinks', price: '4.50', target: '2.00', visible: true,
    recipe: [['Coffee Beans', '18'], ['Milk', '150']] },
  { name: 'Chocolate Pancakes', category: 'Desserts', price: '6.50', target: '3.50', visible: true,
    recipe: [['Flour', '100'], ['Egg', '1'], ['Milk', '100'], ['Chocolate', '30']] },
  // Hidden on purpose, to demonstrate the manual visibility toggle.
  { name: "Chef's Special", category: 'Mains', price: '15.00', target: '7.00', visible: false,
    recipe: [['Pork Belly', '150'], ['White Rice', '150']] },
];

const SEED_TRANSACTION_COUNT = 60;
const SEED_RNG_SEED = 20260401;

module.exports = { USERS, CATEGORIES, INGREDIENTS, DISHES, SEED_TRANSACTION_COUNT, SEED_RNG_SEED };
