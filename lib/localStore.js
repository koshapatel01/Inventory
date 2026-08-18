// Local-only persistence. Per-location quantities, status, and the transfer
// log live here — never written back to the Smartsheet inventory catalog,
// which stays a read-only source. (A separate, dedicated Smartsheet audit-log
// sheet IS written to, best-effort, from the API route layer — see
// lib/smartsheetLog.js — but that never touches the catalog and never blocks
// or fails these local writes.) Manually-added catalog items (see
// addManualItem) are also local-only, for the same reason: they exist so an
// invoice line with no catalog SKU can still be ordered/tracked, without ever
// touching the read-only Smartsheet sheet. SERVER-ONLY (uses node:fs).

import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { canTransfer, computeEstimatedTotal, deriveOrderStatus } from './inventory.js';

const DATA_DIR = path.join(process.cwd(), 'data');
const STORE_PATH = path.join(DATA_DIR, 'store.json');

function emptyStore() {
  return { items: {}, transfers: [], orders: [], transactions: [], invoices: [], logSheetId: null, manualItems: [] };
}

export function readStore() {
  if (!existsSync(STORE_PATH)) return emptyStore();
  const raw = readFileSync(STORE_PATH, 'utf8').replace(/^﻿/, '');
  if (!raw.trim()) return emptyStore();
  const parsed = JSON.parse(raw);
  return {
    items: parsed.items || {},
    transfers: parsed.transfers || [],
    orders: parsed.orders || [],
    transactions: parsed.transactions || [],
    invoices: parsed.invoices || [],
    logSheetId: parsed.logSheetId || null,
    manualItems: parsed.manualItems || [],
  };
}

export function writeStore(store) {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(STORE_PATH, JSON.stringify(store, null, 2), 'utf8');
}

/**
 * Merge fresh Smartsheet catalog items (plus any locally-created "manual add"
 * catalog items — see addManualItem) with local quantity/status state. New
 * items are seeded locally (Qty S755 = current Qty On-Hand, others 0, or all
 * zero for a manual item with no Smartsheet quantity) and persisted; existing
 * local state is never overwritten.
 */
export function mergeAndSync(sheetItems) {
  const store = readStore();
  let changed = false;

  const catalogItems = [...sheetItems, ...store.manualItems];
  const merged = catalogItems.map((sheetItem) => {
    const rowId = String(sheetItem.rowId);
    let local = store.items[rowId];
    if (!local) {
      local = {
        qtyS755: Number(sheetItem.quantity) || 0,
        qtyS821: 0,
        qtyTls: 0,
        status: sheetItem.status ?? null,
      };
      store.items[rowId] = local;
      changed = true;
    }
    return { ...sheetItem, ...local };
  });

  if (changed) writeStore(store);
  return merged;
}

/** Apply a manual quantity/status correction to a single item. */
export function updateLocalItem(rowId, patch) {
  const store = readStore();
  const key = String(rowId);
  const existing = store.items[key] || { qtyS755: 0, qtyS821: 0, qtyTls: 0, status: null };
  store.items[key] = { ...existing, ...patch };
  writeStore(store);
  return store.items[key];
}

const DEST_FIELD = { S821: 'qtyS821', TLS: 'qtyTls' };

/** Move stock from S755 to a destination breakroom and log the transfer. */
export function transferStock({ rowId, itemName, quantity, destination, person }) {
  const destField = DEST_FIELD[destination];
  if (!destField) throw new Error(`Invalid destination: ${destination}`);

  const store = readStore();
  const key = String(rowId);
  const item = store.items[key];
  if (!item) throw new Error('Item not found in local store.');

  if (!canTransfer(item.qtyS755, quantity)) {
    throw new Error(`Not enough stock at S755 (${item.qtyS755 ?? 0} available).`);
  }

  const qty = Number(quantity);
  item.qtyS755 -= qty;
  item[destField] = (Number(item[destField]) || 0) + qty;

  store.transfers.unshift({
    id: randomUUID(),
    date: new Date().toISOString().slice(0, 10),
    rowId: key,
    item: itemName,
    quantity: qty,
    source: 'S755',
    destination,
    person,
  });

  writeStore(store);
  return { qtyS755: item.qtyS755, [destField]: item[destField] };
}

export function getTransfers() {
  return readStore().transfers;
}

/** Record a new purchase order. Does not touch item quantities — stock only changes on receipt. */
export function placeOrder({
  rowId, itemName, itemNumber, quantity, orderedBy, vendor, link, unitPrice, notes,
  invoiceId, invoiceFileId,
}) {
  const store = readStore();
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
  store.orders.unshift(order);
  writeStore(store);
  return order;
}

/** Log a delivery (full or partial) against an order, bump S755 stock, and record the transaction. */
export function receiveOrder({ orderId, quantity, date, notes }) {
  const store = readStore();
  const order = store.orders.find((o) => o.id === orderId);
  if (!order) throw new Error('Order not found.');
  if (order.status === 'Cancelled') throw new Error('This order is cancelled.');

  const remaining = order.quantityOrdered - order.quantityReceived;
  if (!canTransfer(remaining, quantity)) {
    throw new Error(`Cannot receive more than the remaining quantity (${remaining}).`);
  }

  const qty = Number(quantity);
  const deliveryDate = date || new Date().toISOString().slice(0, 10);

  order.deliveries.push({ id: randomUUID(), date: deliveryDate, quantity: qty });
  order.quantityReceived += qty;
  order.dateReceived = deliveryDate;
  order.status = deriveOrderStatus(order.quantityOrdered, order.quantityReceived);
  if (notes) order.notes = order.notes ? `${order.notes}\n${notes}` : notes;

  const key = order.rowId;
  const item = store.items[key] || { qtyS755: 0, qtyS821: 0, qtyTls: 0, status: null };
  item.qtyS755 = (Number(item.qtyS755) || 0) + qty;
  store.items[key] = item;

  store.transactions.unshift({
    id: randomUUID(),
    date: deliveryDate,
    type: 'Receipt',
    rowId: key,
    item: order.itemName,
    quantity: qty,
    source: order.vendor || 'Vendor',
    destination: 'S755',
    person: order.orderedBy,
    orderId: order.id,
  });

  writeStore(store);
  return { order, item };
}

/** Cancel an order. Blocked once it's already fully received. */
export function cancelOrder({ orderId }) {
  const store = readStore();
  const order = store.orders.find((o) => o.id === orderId);
  if (!order) throw new Error('Order not found.');
  if (order.status === 'Received') throw new Error('Cannot cancel a fully received order.');
  order.status = 'Cancelled';
  writeStore(store);
  return order;
}

export function getOrders({ rowId } = {}) {
  const { orders } = readStore();
  return rowId ? orders.filter((o) => o.rowId === String(rowId)) : orders;
}

export function getTransactions() {
  return readStore().transactions;
}

/** Record metadata for an uploaded, parsed invoice/PO. The PDF itself lives in data/invoices/. */
export function saveInvoiceRecord({ fileId, originalFilename, vendor, referenceNumber, orderDate, invoiceDate }) {
  const store = readStore();
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
  store.invoices.unshift(invoice);
  writeStore(store);
  return invoice;
}

export function getInvoices() {
  return readStore().invoices;
}

export function getManualCatalogItems() {
  return readStore().manualItems;
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
export function addManualItem({ sku, name, vendor }, existingCatalog = []) {
  const trimmedSku = String(sku || '').trim();
  const trimmedName = String(name || '').trim();
  if (!trimmedSku) throw new Error('SKU is required.');
  if (!trimmedName) throw new Error('Item name is required.');

  const store = readStore();

  // Re-adding the same SKU just returns the item that already exists for it
  // (e.g. re-uploading the same invoice) rather than creating a duplicate.
  const existingForSku = store.manualItems.find((i) => i.sku === trimmedSku);
  if (existingForSku) return existingForSku;

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
  store.manualItems.push(item);
  writeStore(store);
  return item;
}

/** Cached Smartsheet sheet ID for the audit log, created on first use by lib/smartsheetLog.js. */
export function getLogSheetId() {
  return readStore().logSheetId;
}

export function setLogSheetId(id) {
  const store = readStore();
  store.logSheetId = id;
  writeStore(store);
}
