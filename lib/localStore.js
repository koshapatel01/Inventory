// Local-only persistence. Per-location quantities, status, and the transfer
// log live here — never written back to Smartsheet, which stays a read-only
// catalog source. SERVER-ONLY (uses node:fs).

import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { canTransfer } from './inventory.js';

const DATA_DIR = path.join(process.cwd(), 'data');
const STORE_PATH = path.join(DATA_DIR, 'store.json');

function emptyStore() {
  return { items: {}, transfers: [] };
}

export function readStore() {
  if (!existsSync(STORE_PATH)) return emptyStore();
  const raw = readFileSync(STORE_PATH, 'utf8').replace(/^﻿/, '');
  if (!raw.trim()) return emptyStore();
  const parsed = JSON.parse(raw);
  return { items: parsed.items || {}, transfers: parsed.transfers || [] };
}

export function writeStore(store) {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(STORE_PATH, JSON.stringify(store, null, 2), 'utf8');
}

/**
 * Merge fresh Smartsheet catalog items with local quantity/status state.
 * New items are seeded locally (Qty S755 = current Qty On-Hand, others 0)
 * and persisted; existing local state is never overwritten.
 */
export function mergeAndSync(sheetItems) {
  const store = readStore();
  let changed = false;

  const merged = sheetItems.map((sheetItem) => {
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
