// Local data layer — Postgres-backed (see lib/db.js). Per-location
// quantities, status, and the transfer/order/receiving history live here —
// never written back to the Smartsheet inventory catalog, which stays a
// read-only source. (A separate, dedicated Smartsheet audit-log sheet IS
// written to, best-effort, from the API route layer — see
// lib/smartsheetLog.js — but that never touches the catalog and never blocks
// or fails these writes.) Manually-added catalog items (see addManualItem)
// are also local-only, for the same reason: they exist so an invoice line
// with no catalog SKU can still be ordered/tracked, without ever touching
// the read-only Smartsheet sheet. SERVER-ONLY.
//
// Was a single JSON file (data/store.json) written with node:fs — moved to
// Postgres because Vercel's serverless functions run on a read-only
// filesystem, so that approach only ever worked for local dev.

import { randomUUID } from 'node:crypto';
import { sql } from './db.js';
import { canTransfer, computeEstimatedTotal, deriveOrderStatus } from './inventory.js';

function toItem(row) {
  return {
    qtyS755: Number(row.qty_s755) || 0,
    qtyS821: Number(row.qty_s821) || 0,
    qtyTls: Number(row.qty_tls) || 0,
    status: row.status,
  };
}

function toManualItem(row) {
  return {
    rowId: row.row_id,
    sku: row.sku,
    name: row.name,
    category: row.category,
    minimum: Number(row.minimum) || 0,
    vendor: row.vendor,
    orderLink: row.order_link,
    createdAt: row.created_at,
  };
}

function toTransfer(row) {
  return {
    id: row.id,
    date: row.date,
    rowId: row.row_id,
    item: row.item,
    itemNumber: row.item_number,
    quantity: Number(row.quantity) || 0,
    source: row.source,
    destination: row.destination,
    person: row.person,
  };
}

function toOrder(row, deliveries = []) {
  return {
    id: row.id,
    rowId: row.row_id,
    itemName: row.item_name,
    itemNumber: row.item_number,
    quantityOrdered: Number(row.quantity_ordered) || 0,
    orderDate: row.order_date,
    orderedBy: row.ordered_by,
    vendor: row.vendor,
    link: row.link,
    unitPrice: Number(row.unit_price) || 0,
    estimatedTotal: Number(row.estimated_total) || 0,
    status: row.status,
    quantityReceived: Number(row.quantity_received) || 0,
    dateReceived: row.date_received,
    notes: row.notes,
    deliveries,
    invoiceId: row.invoice_id,
    invoiceFileId: row.invoice_file_id,
  };
}

function toTransaction(row) {
  return {
    id: row.id,
    date: row.date,
    type: row.type,
    rowId: row.row_id,
    item: row.item,
    quantity: Number(row.quantity) || 0,
    source: row.source,
    destination: row.destination,
    person: row.person,
    orderId: row.order_id,
  };
}

function toInvoice(row) {
  return {
    id: row.id,
    fileId: row.file_id,
    originalFilename: row.original_filename,
    uploadedAt: row.uploaded_at,
    vendor: row.vendor,
    referenceNumber: row.reference_number,
    orderDate: row.order_date,
    invoiceDate: row.invoice_date,
  };
}

/**
 * Merge fresh Smartsheet catalog items (plus any locally-created "manual add"
 * catalog items — see addManualItem) with local quantity/status state. New
 * items are seeded locally (Qty S755 = current Qty On-Hand, others 0, or all
 * zero for a manual item with no Smartsheet quantity) and persisted; existing
 * local state is never overwritten.
 */
export async function mergeAndSync(sheetItems) {
  const manualRows = await sql`SELECT * FROM manual_items`;
  const catalogItems = [...sheetItems, ...manualRows.map(toManualItem)];

  const existingRows = await sql`SELECT * FROM items`;
  const existingById = new Map(existingRows.map((r) => [r.row_id, toItem(r)]));

  const merged = [];
  for (const sheetItem of catalogItems) {
    const rowId = String(sheetItem.rowId);
    let local = existingById.get(rowId);
    if (!local) {
      local = {
        qtyS755: Number(sheetItem.quantity) || 0,
        qtyS821: 0,
        qtyTls: 0,
        status: sheetItem.status ?? null,
      };
      await sql`
        INSERT INTO items (row_id, qty_s755, qty_s821, qty_tls, status)
        VALUES (${rowId}, ${local.qtyS755}, ${local.qtyS821}, ${local.qtyTls}, ${local.status})
        ON CONFLICT (row_id) DO NOTHING
      `;
    }
    merged.push({ ...sheetItem, ...local });
  }
  return merged;
}

/** Apply a manual quantity/status correction to a single item. */
export async function updateLocalItem(rowId, patch) {
  const key = String(rowId);
  const existingRows = await sql`SELECT * FROM items WHERE row_id = ${key}`;
  const existing = existingRows[0] ? toItem(existingRows[0]) : { qtyS755: 0, qtyS821: 0, qtyTls: 0, status: null };
  const updated = { ...existing, ...patch };
  await sql`
    INSERT INTO items (row_id, qty_s755, qty_s821, qty_tls, status)
    VALUES (${key}, ${updated.qtyS755}, ${updated.qtyS821}, ${updated.qtyTls}, ${updated.status})
    ON CONFLICT (row_id) DO UPDATE SET
      qty_s755 = EXCLUDED.qty_s755, qty_s821 = EXCLUDED.qty_s821,
      qty_tls = EXCLUDED.qty_tls, status = EXCLUDED.status
  `;
  return updated;
}

const DEST_FIELD = { S821: 'qtyS821', TLS: 'qtyTls' };

/** Move stock from S755 to a destination breakroom and log the transfer. */
export async function transferStock({ rowId, itemName, itemNumber, quantity, destination, person }) {
  const destField = DEST_FIELD[destination];
  if (!destField) throw new Error(`Invalid destination: ${destination}`);

  const key = String(rowId);
  const rows = await sql`SELECT * FROM items WHERE row_id = ${key}`;
  if (!rows[0]) throw new Error('Item not found in local store.');
  const item = toItem(rows[0]);

  if (!canTransfer(item.qtyS755, quantity)) {
    throw new Error(`Not enough stock at S755 (${item.qtyS755 ?? 0} available).`);
  }

  const qty = Number(quantity);
  const newS755 = item.qtyS755 - qty;
  const newDest = (Number(item[destField]) || 0) + qty;

  if (destination === 'S821') {
    await sql`UPDATE items SET qty_s755 = ${newS755}, qty_s821 = ${newDest} WHERE row_id = ${key}`;
  } else {
    await sql`UPDATE items SET qty_s755 = ${newS755}, qty_tls = ${newDest} WHERE row_id = ${key}`;
  }

  await sql`
    INSERT INTO transfers (id, date, row_id, item, item_number, quantity, source, destination, person)
    VALUES (
      ${randomUUID()}, ${new Date().toISOString().slice(0, 10)}, ${key}, ${itemName}, ${itemNumber || null},
      ${qty}, 'S755', ${destination}, ${person}
    )
  `;

  return { qtyS755: newS755, [destField]: newDest };
}

export async function getTransfers() {
  const rows = await sql`SELECT * FROM transfers ORDER BY created_at DESC`;
  return rows.map(toTransfer);
}

/** Record a new purchase order. Does not touch item quantities — stock only changes on receipt. */
export async function placeOrder({
  rowId, itemName, itemNumber, quantity, orderedBy, vendor, link, unitPrice, notes,
  invoiceId, invoiceFileId,
}) {
  const qty = Number(quantity);
  const price = Number(unitPrice);
  const order = {
    id: randomUUID(),
    rowId: String(rowId),
    itemName,
    itemNumber: itemNumber || '',
    quantityOrdered: qty,
    orderDate: new Date().toISOString().slice(0, 10),
    orderedBy,
    vendor,
    link: link || '',
    unitPrice: price,
    estimatedTotal: computeEstimatedTotal(qty, price),
    status: 'Ordered',
    quantityReceived: 0,
    dateReceived: null,
    notes: notes || '',
    deliveries: [],
    invoiceId: invoiceId || null,
    invoiceFileId: invoiceFileId || null,
  };

  await sql`
    INSERT INTO orders (
      id, row_id, item_name, item_number, quantity_ordered, order_date, ordered_by,
      vendor, link, unit_price, estimated_total, status, quantity_received,
      date_received, notes, invoice_id, invoice_file_id
    ) VALUES (
      ${order.id}, ${order.rowId}, ${order.itemName}, ${order.itemNumber}, ${order.quantityOrdered},
      ${order.orderDate}, ${order.orderedBy}, ${order.vendor}, ${order.link}, ${order.unitPrice},
      ${order.estimatedTotal}, ${order.status}, ${order.quantityReceived}, ${order.dateReceived},
      ${order.notes}, ${order.invoiceId}, ${order.invoiceFileId}
    )
  `;

  return order;
}

/** Log a delivery (full or partial) against an order, bump S755 stock, and record the transaction. */
export async function receiveOrder({ orderId, quantity, date, notes }) {
  const rows = await sql`SELECT * FROM orders WHERE id = ${orderId}`;
  if (!rows[0]) throw new Error('Order not found.');
  const order = toOrder(rows[0]);
  if (order.status === 'Cancelled') throw new Error('This order is cancelled.');

  const remaining = order.quantityOrdered - order.quantityReceived;
  if (!canTransfer(remaining, quantity)) {
    throw new Error(`Cannot receive more than the remaining quantity (${remaining}).`);
  }

  const qty = Number(quantity);
  const deliveryDate = date || new Date().toISOString().slice(0, 10);

  await sql`
    INSERT INTO order_deliveries (id, order_id, date, quantity)
    VALUES (${randomUUID()}, ${orderId}, ${deliveryDate}, ${qty})
  `;

  const quantityReceived = order.quantityReceived + qty;
  const status = deriveOrderStatus(order.quantityOrdered, quantityReceived);
  const combinedNotes = notes ? (order.notes ? `${order.notes}\n${notes}` : notes) : order.notes;

  await sql`
    UPDATE orders
    SET quantity_received = ${quantityReceived}, date_received = ${deliveryDate},
        status = ${status}, notes = ${combinedNotes}
    WHERE id = ${orderId}
  `;

  const itemRows = await sql`SELECT * FROM items WHERE row_id = ${order.rowId}`;
  const existingItem = itemRows[0] ? toItem(itemRows[0]) : { qtyS755: 0, qtyS821: 0, qtyTls: 0, status: null };
  const newQtyS755 = (Number(existingItem.qtyS755) || 0) + qty;
  await sql`
    INSERT INTO items (row_id, qty_s755, qty_s821, qty_tls, status)
    VALUES (${order.rowId}, ${newQtyS755}, ${existingItem.qtyS821}, ${existingItem.qtyTls}, ${existingItem.status})
    ON CONFLICT (row_id) DO UPDATE SET qty_s755 = EXCLUDED.qty_s755
  `;
  const item = { ...existingItem, qtyS755: newQtyS755 };

  await sql`
    INSERT INTO transactions (id, date, type, row_id, item, quantity, source, destination, person, order_id)
    VALUES (
      ${randomUUID()}, ${deliveryDate}, 'Receipt', ${order.rowId}, ${order.itemName}, ${qty},
      ${order.vendor || 'Vendor'}, 'S755', ${order.orderedBy}, ${order.id}
    )
  `;

  const deliveryRows = await sql`SELECT * FROM order_deliveries WHERE order_id = ${orderId} ORDER BY date`;
  const updatedOrder = {
    ...order,
    quantityReceived,
    dateReceived: deliveryDate,
    status,
    notes: combinedNotes,
    deliveries: deliveryRows.map((d) => ({ id: d.id, date: d.date, quantity: Number(d.quantity) || 0 })),
  };

  return { order: updatedOrder, item };
}

/** Cancel an order. Blocked once it's already fully received. */
export async function cancelOrder({ orderId }) {
  const rows = await sql`SELECT * FROM orders WHERE id = ${orderId}`;
  if (!rows[0]) throw new Error('Order not found.');
  const order = toOrder(rows[0]);
  if (order.status === 'Received') throw new Error('Cannot cancel a fully received order.');
  await sql`UPDATE orders SET status = 'Cancelled' WHERE id = ${orderId}`;
  return { ...order, status: 'Cancelled' };
}

export async function getOrders({ rowId } = {}) {
  const rows = rowId
    ? await sql`SELECT * FROM orders WHERE row_id = ${String(rowId)} ORDER BY created_at DESC`
    : await sql`SELECT * FROM orders ORDER BY created_at DESC`;

  const orders = [];
  for (const row of rows) {
    const deliveryRows = await sql`SELECT * FROM order_deliveries WHERE order_id = ${row.id} ORDER BY date`;
    orders.push(toOrder(row, deliveryRows.map((d) => ({ id: d.id, date: d.date, quantity: Number(d.quantity) || 0 }))));
  }
  return orders;
}

export async function getTransactions() {
  const rows = await sql`SELECT * FROM transactions ORDER BY created_at DESC`;
  return rows.map(toTransaction);
}

/** Record metadata for an uploaded, parsed invoice/PO. The PDF itself lives in the invoice_files table. */
export async function saveInvoiceRecord({ fileId, originalFilename, vendor, referenceNumber, orderDate, invoiceDate }) {
  const invoice = {
    id: randomUUID(),
    fileId,
    originalFilename,
    uploadedAt: new Date().toISOString(),
    vendor: vendor || null,
    referenceNumber: referenceNumber || null,
    orderDate: orderDate || null,
    invoiceDate: invoiceDate || null,
  };
  await sql`
    INSERT INTO invoices (id, file_id, original_filename, uploaded_at, vendor, reference_number, order_date, invoice_date)
    VALUES (
      ${invoice.id}, ${invoice.fileId}, ${invoice.originalFilename}, ${invoice.uploadedAt},
      ${invoice.vendor}, ${invoice.referenceNumber}, ${invoice.orderDate}, ${invoice.invoiceDate}
    )
  `;
  return invoice;
}

export async function getInvoices() {
  const rows = await sql`SELECT * FROM invoices ORDER BY uploaded_at DESC`;
  return rows.map(toInvoice);
}

export async function getManualCatalogItems() {
  const rows = await sql`SELECT * FROM manual_items`;
  return rows.map(toManualItem);
}

/**
 * Create a new, locally-owned catalog item — used when an invoice line's SKU
 * isn't in the Smartsheet catalog at all and the user types a name for it
 * instead of picking an existing item. Never written to Smartsheet (that
 * sheet stays read-only); it's merged into the main inventory list the same
 * way Smartsheet rows are (see mergeAndSync), tagged with category
 * 'Manual Add' so it's easy to spot.
 *
 * The SKU is always the one parsed from the invoice — it's the only exact
 * tracking code the vendor gave for this product, so it's never discarded or
 * regenerated here.
 *
 * `existingCatalog` is the full current catalog (Smartsheet + other manual
 * items) supplied by the caller, since this module has no network access to
 * fetch Smartsheet itself — used to block two different products (different
 * SKU) from sharing the same name.
 */
export async function addManualItem({ sku, name, vendor }, existingCatalog = []) {
  const trimmedSku = String(sku || '').trim();
  const trimmedName = String(name || '').trim();
  if (!trimmedSku) throw new Error('SKU is required.');
  if (!trimmedName) throw new Error('Item name is required.');

  // Re-adding the same SKU just returns the item that already exists for it
  // (e.g. re-uploading the same invoice) rather than creating a duplicate.
  const existingRows = await sql`SELECT * FROM manual_items WHERE sku = ${trimmedSku}`;
  if (existingRows[0]) return toManualItem(existingRows[0]);

  const nameConflict = existingCatalog.find(
    (i) => i.sku !== trimmedSku && String(i.name || '').trim().toLowerCase() === trimmedName.toLowerCase()
  );
  if (nameConflict) {
    throw new Error(
      `"${trimmedName}" is already used by a different item (SKU ${nameConflict.sku || 'unknown'}). Use a different name.`
    );
  }

  const item = {
    rowId: `manual-${randomUUID()}`,
    sku: trimmedSku,
    name: trimmedName,
    category: 'Manual Add',
    minimum: 0,
    vendor: vendor || null,
    orderLink: null,
    createdAt: new Date().toISOString(),
  };
  await sql`
    INSERT INTO manual_items (row_id, sku, name, category, minimum, vendor, order_link, created_at)
    VALUES (
      ${item.rowId}, ${item.sku}, ${item.name}, ${item.category}, ${item.minimum},
      ${item.vendor}, ${item.orderLink}, ${item.createdAt}
    )
  `;
  return item;
}

/** Cached Smartsheet sheet ID for the audit log, created on first use by lib/smartsheetLog.js. */
export async function getLogSheetId() {
  const rows = await sql`SELECT value FROM app_meta WHERE key = 'logSheetId'`;
  return rows[0]?.value || null;
}

export async function setLogSheetId(id) {
  await sql`
    INSERT INTO app_meta (key, value) VALUES ('logSheetId', ${id})
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value
  `;
}
