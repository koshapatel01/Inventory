// One-time (and idempotent — safe to re-run) schema setup for the Postgres
// database that replaced data/store.json's local-file storage (that storage
// model doesn't work on Vercel, whose serverless functions have a read-only
// filesystem — see lib/db.js). Run with:  npm run db:migrate
//
// Date-like fields (order dates, invoice dates, delivery dates) are stored as
// TEXT, not DATE/TIMESTAMP: several of them come straight from parsed PDF
// text ("7/9/2026") rather than a validated ISO date, so a stricter column
// type would risk insert failures on real invoices.

import { sql } from '../lib/db.js';

const statements = [
  `CREATE TABLE IF NOT EXISTS items (
    row_id TEXT PRIMARY KEY,
    qty_s755 NUMERIC NOT NULL DEFAULT 0,
    qty_s821 NUMERIC NOT NULL DEFAULT 0,
    qty_tls NUMERIC NOT NULL DEFAULT 0,
    status TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS manual_items (
    row_id TEXT PRIMARY KEY,
    sku TEXT NOT NULL,
    name TEXT NOT NULL,
    category TEXT NOT NULL DEFAULT 'Manual Add',
    minimum NUMERIC NOT NULL DEFAULT 0,
    vendor TEXT,
    order_link TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`,
  `CREATE TABLE IF NOT EXISTS transfers (
    id TEXT PRIMARY KEY,
    date TEXT NOT NULL,
    row_id TEXT NOT NULL,
    item TEXT,
    quantity NUMERIC NOT NULL,
    source TEXT,
    destination TEXT,
    person TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`,
  `CREATE TABLE IF NOT EXISTS orders (
    id TEXT PRIMARY KEY,
    row_id TEXT NOT NULL,
    item_name TEXT,
    item_number TEXT,
    quantity_ordered NUMERIC NOT NULL,
    order_date TEXT,
    ordered_by TEXT,
    vendor TEXT,
    link TEXT,
    unit_price NUMERIC NOT NULL DEFAULT 0,
    estimated_total NUMERIC NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'Ordered',
    quantity_received NUMERIC NOT NULL DEFAULT 0,
    date_received TEXT,
    notes TEXT,
    invoice_id TEXT,
    invoice_file_id TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`,
  `CREATE TABLE IF NOT EXISTS order_deliveries (
    id TEXT PRIMARY KEY,
    order_id TEXT NOT NULL REFERENCES orders(id),
    date TEXT,
    quantity NUMERIC NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS transactions (
    id TEXT PRIMARY KEY,
    date TEXT,
    type TEXT,
    row_id TEXT,
    item TEXT,
    quantity NUMERIC,
    source TEXT,
    destination TEXT,
    person TEXT,
    order_id TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`,
  `CREATE TABLE IF NOT EXISTS invoices (
    id TEXT PRIMARY KEY,
    file_id TEXT,
    original_filename TEXT,
    uploaded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    vendor TEXT,
    reference_number TEXT,
    order_date TEXT,
    invoice_date TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS invoice_files (
    id TEXT PRIMARY KEY,
    filename TEXT,
    content BYTEA NOT NULL,
    uploaded_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`,
  `CREATE TABLE IF NOT EXISTS app_meta (
    key TEXT PRIMARY KEY,
    value TEXT
  )`,
];

for (const statement of statements) {
  await sql.query(statement);
  const tableName = statement.match(/EXISTS (\w+)/)[1];
  console.log(`✓ ${tableName}`);
}

console.log('Schema up to date.');
