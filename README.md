# UHD IT PMO — Supply Inventory & Purchasing-Status Tracker

A small Next.js web app that puts a clean, operator-friendly screen on top of your
Smartsheet inventory sheet. Data stays in **Smartsheet** (the source of truth); this
app reads and writes to it via the Smartsheet API. Low-stock email alerts are handled
by **Smartsheet's own alert rules** — see `UHD-Inventory-Architecture-and-Build-Plan.md`.

## Prerequisites
- Node.js 18+ and npm
- A Smartsheet API access token — Smartsheet → account icon → Personal Settings → API Access
- Your inventory Sheet ID — Smartsheet → File → Properties → Sheet ID
- A Postgres database (e.g. via Vercel's Storage tab → Create Database) — the catalog
  itself stays in Smartsheet, but everything else this app tracks (quantities, orders,
  transfers, receiving log, uploaded invoices, manually-added items) lives in Postgres,
  not on local disk, since a normal file write doesn't survive on Vercel.

## Setup
1. Install dependencies:
   ```bash
   npm install
   ```
2. Create your local secrets file and fill it in:
   ```bash
   cp .env.example .env.local
   ```
   Set `DATABASE_URL`, `SMARTSHEET_API_TOKEN`, and `SMARTSHEET_SHEET_ID`.
3. Set up the database schema, then (optional) bring in any existing local data:
   ```bash
   npm run db:migrate
   npm run db:import
   ```
4. Match your columns: open `lib/config.js` and edit the `COLUMN_MAP` values so they
   equal your Smartsheet column titles exactly (case-sensitive). Adjust `LOCATIONS` and
   `CATEGORIES` if yours differ. (Status is automatic — see below — not a config option.)
5. Run locally:
   ```bash
   npm run dev
   ```
   Open http://localhost:3000 — you should see your live Smartsheet rows.

## Verify the core logic (no network needed)
```bash
npm run verify
```

## Deploy (GitHub → Vercel)
1. Push this folder to a new GitHub repository.
2. In Vercel: **Add New → Project → Import** the repo.
3. In the project's **Storage** tab, create a Postgres database and connect it — this
   auto-populates `DATABASE_URL` in the project's environment variables.
4. Add the remaining Environment Variables (`SMARTSHEET_API_TOKEN`, `SMARTSHEET_SHEET_ID`)
   in the Vercel project settings.
5. **Deploy.** Vercel gives you a live URL; every push to GitHub redeploys automatically.

## Project layout
```
app/
  page.jsx                         Dashboard (loads Smartsheet, renders the table)
  layout.jsx, globals.css          App shell & styles
  api/inventory/route.js           GET   — list items
  api/inventory/[rowId]/route.js   PATCH — update quantity/status
components/
  InventoryClient.jsx              Table, filters, inline editing
lib/
  config.js                        Column mapping, locations, statuses   ← edit me
  inventory.js                     Pure helpers (normalize, low-stock, filter)
  smartsheet.js                    Smartsheet REST client (server-only; holds token)
scripts/
  verify.mjs                       Node tests for the pure logic
```

## Notes
- The app stores no data of its own — everything lives in Smartsheet.
- Edits save straight back to Smartsheet; if a save fails, the change rolls back and a
  message appears. Reload to resync from Smartsheet.
- The API token is read from environment variables server-side and is never sent to the browser.
