// One-time migration of the existing data/store.json (and data/invoices/*.pdf)
// into Postgres, so switching storage backends (see lib/db.js) doesn't lose
// the real inventory/order/transfer history already recorded locally. Safe to
// re-run — every insert is ON CONFLICT DO NOTHING, so already-imported rows
// are skipped rather than duplicated. Run with:  npm run db:import

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { sql } from '../lib/db.js';

const DATA_DIR = path.join(process.cwd(), 'data');
const STORE_PATH = path.join(DATA_DIR, 'store.json');
const INVOICES_DIR = path.join(DATA_DIR, 'invoices');

if (!existsSync(STORE_PATH)) {
  console.log('No data/store.json found — nothing to import.');
  process.exit(0);
}

const store = JSON.parse(readFileSync(STORE_PATH, 'utf8').replace(/^﻿/, ''));

let count = 0;

for (const [rowId, item] of Object.entries(store.items || {})) {
  await sql`
    INSERT INTO items (row_id, qty_s755, qty_s821, qty_tls, status)
    VALUES (${rowId}, ${Number(item.qtyS755) || 0}, ${Number(item.qtyS821) || 0}, ${Number(item.qtyTls) || 0}, ${item.status ?? null})
    ON CONFLICT (row_id) DO NOTHING
  `;
  count++;
}
console.log(`✓ items: ${count}`);

count = 0;
for (const item of store.manualItems || []) {
  await sql`
    INSERT INTO manual_items (row_id, sku, name, category, minimum, vendor, order_link, created_at)
    VALUES (${item.rowId}, ${item.sku}, ${item.name}, ${item.category || 'Manual Add'}, ${Number(item.minimum) || 0}, ${item.vendor ?? null}, ${item.orderLink ?? null}, ${item.createdAt || new Date().toISOString()})
    ON CONFLICT (row_id) DO NOTHING
  `;
  count++;
}
console.log(`✓ manual_items: ${count}`);

count = 0;
for (const t of store.transfers || []) {
  await sql`
    INSERT INTO transfers (id, date, row_id, item, quantity, source, destination, person)
    VALUES (${t.id}, ${t.date}, ${t.rowId}, ${t.item ?? null}, ${Number(t.quantity) || 0}, ${t.source ?? null}, ${t.destination ?? null}, ${t.person ?? null})
    ON CONFLICT (id) DO NOTHING
  `;
  count++;
}
console.log(`✓ transfers: ${count}`);

count = 0;
let deliveryCount = 0;
for (const o of store.orders || []) {
  await sql`
    INSERT INTO orders (
      id, row_id, item_name, item_number, quantity_ordered, order_date, ordered_by,
      vendor, link, unit_price, estimated_total, status, quantity_received,
      date_received, notes, invoice_id, invoice_file_id
    )
    VALUES (
      ${o.id}, ${o.rowId}, ${o.itemName ?? null}, ${o.itemNumber ?? null}, ${Number(o.quantityOrdered) || 0},
      ${o.orderDate ?? null}, ${o.orderedBy ?? null}, ${o.vendor ?? null}, ${o.link ?? null},
      ${Number(o.unitPrice) || 0}, ${Number(o.estimatedTotal) || 0}, ${o.status || 'Ordered'},
      ${Number(o.quantityReceived) || 0}, ${o.dateReceived ?? null}, ${o.notes ?? null},
      ${o.invoiceId ?? null}, ${o.invoiceFileId ?? null}
    )
    ON CONFLICT (id) DO NOTHING
  `;
  count++;
  for (const d of o.deliveries || []) {
    await sql`
      INSERT INTO order_deliveries (id, order_id, date, quantity)
      VALUES (${d.id}, ${o.id}, ${d.date}, ${Number(d.quantity) || 0})
      ON CONFLICT (id) DO NOTHING
    `;
    deliveryCount++;
  }
}
console.log(`✓ orders: ${count} (with ${deliveryCount} deliveries)`);

count = 0;
for (const t of store.transactions || []) {
  await sql`
    INSERT INTO transactions (id, date, type, row_id, item, quantity, source, destination, person, order_id)
    VALUES (${t.id}, ${t.date}, ${t.type}, ${t.rowId}, ${t.item ?? null}, ${Number(t.quantity) || 0}, ${t.source ?? null}, ${t.destination ?? null}, ${t.person ?? null}, ${t.orderId ?? null})
    ON CONFLICT (id) DO NOTHING
  `;
  count++;
}
console.log(`✓ transactions: ${count}`);

count = 0;
for (const inv of store.invoices || []) {
  await sql`
    INSERT INTO invoices (id, file_id, original_filename, uploaded_at, vendor, reference_number, order_date, invoice_date)
    VALUES (${inv.id}, ${inv.fileId ?? null}, ${inv.originalFilename ?? null}, ${inv.uploadedAt || new Date().toISOString()}, ${inv.vendor ?? null}, ${inv.referenceNumber ?? null}, ${inv.orderDate ?? null}, ${inv.invoiceDate ?? null})
    ON CONFLICT (id) DO NOTHING
  `;
  count++;
}
console.log(`✓ invoices: ${count}`);

count = 0;
if (existsSync(INVOICES_DIR)) {
  for (const filename of readdirSync(INVOICES_DIR)) {
    const fileId = filename.replace(/\.[^.]+$/, '');
    const content = readFileSync(path.join(INVOICES_DIR, filename));
    await sql`
      INSERT INTO invoice_files (id, filename, content)
      VALUES (${fileId}, ${filename}, ${content})
      ON CONFLICT (id) DO NOTHING
    `;
    count++;
  }
}
console.log(`✓ invoice_files: ${count}`);

if (store.logSheetId) {
  await sql`
    INSERT INTO app_meta (key, value) VALUES ('logSheetId', ${store.logSheetId})
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value
  `;
  console.log('✓ logSheetId');
}

console.log('Import complete.');
