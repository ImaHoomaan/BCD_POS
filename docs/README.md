# BCD Restaurant POS

A standalone, fully offline restaurant point-of-sale app for Windows. One desktop app (Electron) runs an embedded Express server on `127.0.0.1` and keeps all data in a single SQLite file. There is no cloud service, CDN, or web font: once installed it never needs the internet.

Two roles are enforced on the server:

- **Cashier** sees only the POS Terminal and the Available Menu List.
- **Owner** sees everything: Menu Management, Ingredient Stock Manager, Recipe and Pricing Linker, and the Dashboard.

## Seeded accounts (demo data)

| Username    | Role    | Password       |
|-------------|---------|----------------|
| `Owner`     | Owner   | `Owner@123`    |
| `Cashier 1` | Cashier | `Cashier1@123` |
| `Cashier 2` | Cashier | `Cashier2@123` |
| `Cashier 3` | Cashier | `Cashier3@123` |

These are demo credentials. The app has no password-change screen yet, so change the seed values in `server/db/seed_data.js` (and re-create the database) before real use.

Five failed sign-ins for one username lock it for 5 minutes. A session ends after 30 minutes without activity.

The demo data also includes 4 categories, 12 dishes (one hidden, two out of stock on purpose), 19 ingredients, and 60 sample sales over the past 30 days by all three cashiers.

## For end users: one-click install

1. Double-click `BCD Restaurant POS Setup 1.0.0.exe`.
2. Wait a few seconds. There are no questions to answer. The app installs for the current Windows user (no administrator rights), adds Desktop and Start Menu shortcuts, and starts.
3. Sign in with one of the accounts above.

On first launch the app creates its database and loads the demo data. Data lives in `%APPDATA%\BCD Restaurant POS\pos.db`. Uninstalling keeps this file, so sales history is not lost by reinstalling or updating.

## For developers

### Prerequisites

- Windows 10 or later
- Node.js 22 or newer (tested with 22.x) and npm 10 or newer

### Setup

1. `npm install` (needs internet once, to download packages).
2. `npm run init-db` creates the database at `data/pos.db` (override with `POS_DB_PATH`).
3. `npm run seed-db` loads the demo data. Running it again changes nothing.
4. `npm run build` builds the React app into `client-dist/`.
5. `npm run start:server` starts the server at <http://127.0.0.1:5000>.

Developing the UI with hot reload: run `npm run dev` (API on port 5000, Vite on <http://localhost:5173>) after steps 1 to 3.

### Commands

| Command                | What it does |
|------------------------|--------------|
| `npm run init-db`      | Create all tables and constraints. Safe to repeat. |
| `npm run seed-db`      | Load the demo data in one transaction. Safe to repeat. |
| `npm run start:server` | Run the server in a browser-accessible dev mode. Exits with code 2 and prints the path and reason if the database cannot be opened. |
| `npm run dev`          | Server plus Vite dev server. |
| `npm run build`        | Build the React app. |
| `npm start`            | Build and run the desktop app (Electron). |
| `npm run dist`         | Build the one-click Windows installer into `release/`. |
| `npm test`             | Run all automated tests (exit code 0 only if all pass). |

`npm start` and `npm run dist` rebuild the native SQLite module for Electron and then rebuild it for Node again, so `npm test` keeps working. If tests fail with a "NODE_MODULE_VERSION" error, run `npm rebuild better-sqlite3`.

### Project layout

```
server/
  lib/        money, clock, errors, validation (shared, no business rules)
  db/         schema.sql, connection, init, seed, repositories (all SQL)
  auth/       login, sessions, passwords, RBAC matrix
  terminal/   draft order, checkout math, order submission
  inventory/  ingredients, recipes, costing, availability
  menu/       categories, dishes, tax rate, available menu list
  dashboard/  date ranges, overview, top dishes, chart, transaction log
  http/       session, CSRF and error middleware
client/       React + Vite + Tailwind + Recharts
electron/     desktop shell
tests/        unit and integration tests (Vitest + fast-check)
```

### How the important rules are enforced

- **Permissions**: every service calls `authorize()` and every route uses `requires()`. Screens are checked on the server before any app content is sent. Hiding links is cosmetic only.
- **Exact money**: cents, milli-units and basis points as integers, with BigInt where products can exceed 2^53. No floats in money or stock.
- **Orders**: submission runs in one `BEGIN IMMEDIATE` transaction (duplicate check, stock check, sale record, stock deduction). Overlapping sales are serialized, so stock cannot go below zero. A repeated submission ID returns the original receipt.
- **Availability**: computed on every read from recipes and stock, never stored.
- **History**: order lines snapshot the dish name, price and serving cost, and each sale stores the tax rate used.
- **Gross Sales** is price times quantity (tax excluded), following acceptance criterion 15.6. The one place to change this is `grossOfTransaction` in `server/dashboard/overview.js` plus the SQL in `server/db/repos/sales.js`.

### Known limits

- The seeded passwords cannot be changed from the UI yet.
- Unit costs are stored in whole cents per unit, so the cheapest cost per gram or ml is 0.01.
- The installer is unsigned, so Windows SmartScreen may show a warning the first time. Code signing needs a certificate.
- Full accessibility conformance needs manual testing with assistive technologies. The UI uses labels, roles, live regions and text alternatives, but has not been audited.
