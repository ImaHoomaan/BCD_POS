-- Restaurant POS schema (SQLite). Every statement is idempotent (IF NOT EXISTS) so
-- running init-db against an initialized database changes nothing (Req 1.5).
--
-- Scaled integers are used everywhere, never floats:
--   *_cents  money in cents            *_milli  quantities x1000      *_bp  basis points

CREATE TABLE IF NOT EXISTS schema_meta (
  version INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  username      TEXT NOT NULL UNIQUE COLLATE NOCASE,
  role          TEXT NOT NULL CHECK (role IN ('owner', 'cashier')),
  password_hash TEXT NOT NULL CHECK (length(password_hash) > 0)
);

CREATE TABLE IF NOT EXISTS sessions (
  token         TEXT PRIMARY KEY,
  user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at    TEXT NOT NULL,
  last_activity TEXT NOT NULL,
  csrf_token    TEXT NOT NULL,
  draft_json    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS login_attempts (
  username_key TEXT PRIMARY KEY,
  failed_count INTEGER NOT NULL DEFAULT 0,
  locked_until TEXT
);

CREATE TABLE IF NOT EXISTS categories (
  id   INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE COLLATE NOCASE CHECK (length(name) BETWEEN 1 AND 50)
);

CREATE TABLE IF NOT EXISTS dishes (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  name                TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 100),
  category_id         INTEGER NOT NULL REFERENCES categories(id) ON DELETE RESTRICT,
  selling_price_cents INTEGER NOT NULL CHECK (selling_price_cents BETWEEN 1 AND 99999999),
  target_cost_cents   INTEGER NOT NULL DEFAULT 0 CHECK (target_cost_cents BETWEEN 0 AND 99999999),
  visible             INTEGER NOT NULL DEFAULT 1 CHECK (visible IN (0, 1))
);

CREATE TABLE IF NOT EXISTS ingredients (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  name            TEXT NOT NULL UNIQUE COLLATE NOCASE CHECK (length(name) BETWEEN 1 AND 100),
  unit            TEXT NOT NULL CHECK (unit IN ('grams', 'ml', 'pcs')),
  unit_cost_cents INTEGER NOT NULL CHECK (unit_cost_cents BETWEEN 0 AND 99999999),
  stock_milli     INTEGER NOT NULL CHECK (stock_milli BETWEEN 0 AND 999999990)
);

CREATE TABLE IF NOT EXISTS recipe_items (
  dish_id       INTEGER NOT NULL REFERENCES dishes(id) ON DELETE CASCADE,
  ingredient_id INTEGER NOT NULL REFERENCES ingredients(id) ON DELETE RESTRICT,
  qty_milli     INTEGER NOT NULL CHECK (qty_milli BETWEEN 1 AND 999999999),
  PRIMARY KEY (dish_id, ingredient_id)
);

-- Backstop for the 50-item recipe limit (the service checks it first).
CREATE TRIGGER IF NOT EXISTS trg_recipe_item_limit
BEFORE INSERT ON recipe_items
WHEN (SELECT COUNT(*) FROM recipe_items WHERE dish_id = NEW.dish_id) >= 50
BEGIN
  SELECT RAISE(ABORT, 'recipe item limit of 50 reached');
END;

CREATE TABLE IF NOT EXISTS transactions (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  receipt_number      TEXT NOT NULL UNIQUE,
  submission_id       TEXT NOT NULL UNIQUE,
  created_at          TEXT NOT NULL,
  cashier_id          INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  subtotal_cents      INTEGER NOT NULL,
  tax_rate_bp         INTEGER NOT NULL,
  tax_cents           INTEGER NOT NULL,
  total_cents         INTEGER NOT NULL,
  cash_tendered_cents INTEGER NOT NULL,
  change_due_cents    INTEGER NOT NULL,
  CHECK (total_cents = subtotal_cents + tax_cents),
  CHECK (change_due_cents = cash_tendered_cents - total_cents),
  CHECK (change_due_cents >= 0)
);

-- dish_ref is a snapshot of dishes.id and deliberately NOT a foreign key, so deleting a
-- dish leaves history intact (Req 13.5, 16.7).
CREATE TABLE IF NOT EXISTS order_lines (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  transaction_id     INTEGER NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
  dish_ref           INTEGER NOT NULL,
  dish_name          TEXT NOT NULL,
  unit_price_cents   INTEGER NOT NULL,
  serving_cost_cents INTEGER NOT NULL,
  quantity           INTEGER NOT NULL CHECK (quantity BETWEEN 1 AND 99),
  line_total_cents   INTEGER NOT NULL CHECK (line_total_cents = unit_price_cents * quantity)
);

CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS ix_tx_created ON transactions(created_at DESC, receipt_number DESC);
CREATE INDEX IF NOT EXISTS ix_tx_cashier ON transactions(cashier_id, created_at);
CREATE INDEX IF NOT EXISTS ix_lines_tx ON order_lines(transaction_id);
CREATE INDEX IF NOT EXISTS ix_dishes_cat ON dishes(category_id);
CREATE INDEX IF NOT EXISTS ix_recipe_ing ON recipe_items(ingredient_id);
