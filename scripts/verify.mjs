// Standalone Node tests for the pure inventory logic. No network, no deps.
// Run with:  npm run verify   (or  node scripts/verify.mjs)

import assert from 'node:assert/strict';
import {
  rowsToItems,
  columnIndex,
  totalQuantity,
  isLowStock,
  canTransfer,
  filterItems,
  fieldsToCells,
  summarize,
} from '../lib/inventory.js';

const COLUMN_MAP = {
  sku: 'SKU', name: 'Item Name', category: 'Category',
  minimum: 'Minimum', notes: 'Notes',
};

// A fake Smartsheet sheet payload shaped like the real API response. Location
// quantities and status are local-only, so they're merged in after rowsToItems
// (mirroring what lib/localStore.js's mergeAndSync does), not read from Smartsheet.
const sheet = {
  columns: [
    { id: 101, title: 'SKU' },
    { id: 102, title: 'Item Name' },
    { id: 103, title: 'Category' },
    { id: 106, title: 'Minimum' },
    { id: 108, title: 'Notes' },
  ],
  rows: [
    { id: 1, cells: [
      { columnId: 101, value: 'UHDITFO10' }, { columnId: 102, value: 'Coffee' },
      { columnId: 103, value: 'Breakroom' }, { columnId: 106, value: 5 },
    ] },
    { id: 2, cells: [
      { columnId: 101, value: 'UHDITOF20' }, { columnId: 102, value: 'Pens' },
      { columnId: 103, value: 'Office' }, { columnId: 106, value: 10 },
    ] },
  ],
};

// rowsToItems
const rawItems = rowsToItems(sheet, COLUMN_MAP);
assert.equal(rawItems.length, 2, 'should parse 2 rows');
assert.equal(rawItems[0].sku, 'UHDITFO10');
assert.equal(rawItems[0].rowId, 1);
assert.equal(rawItems[1].name, 'Pens');

// Simulate the local merge: Coffee is low (total 2 <= min 5), Pens is not (40 > 10).
const items = [
  { ...rawItems[0], qtyS755: 2, qtyS821: 0, qtyTls: 0, status: 'Low' },
  { ...rawItems[1], qtyS755: 30, qtyS821: 10, qtyTls: 0, status: 'OK' },
];

// totalQuantity
assert.equal(totalQuantity(items[0]), 2);
assert.equal(totalQuantity(items[1]), 40);
assert.equal(totalQuantity({ qtyS755: 1, qtyTls: 'x' }), 1, 'non-numeric fields count as 0');

// isLowStock
assert.equal(isLowStock(items[0]), true, '2 <= 5 is low');
assert.equal(isLowStock(items[1]), false, '40 <= 10 is not low');
assert.equal(isLowStock({ qtyS755: 5, minimum: 5 }), true, 'boundary is low');
assert.equal(isLowStock({ qtyS755: 5, minimum: '' }), false, 'missing minimum is unknown, not low');

// canTransfer
assert.equal(canTransfer(10, 5), true);
assert.equal(canTransfer(10, 10), true, 'boundary is allowed');
assert.equal(canTransfer(10, 11), false, 'over-transfer blocked');
assert.equal(canTransfer(10, 0), false, 'zero quantity blocked');
assert.equal(canTransfer(10, -1), false, 'negative quantity blocked');
assert.equal(canTransfer(undefined, 5), false, 'missing available blocked');

// filterItems
assert.equal(filterItems(items, { category: 'Office' }).length, 1);
assert.equal(filterItems(items, { lowOnly: true }).length, 1);
assert.equal(filterItems(items, { query: 'pen' }).length, 1);
assert.equal(filterItems(items, { query: 'UHDITFO' }).length, 1);
assert.equal(filterItems(items, { query: 'zzz' }).length, 0);
assert.equal(filterItems(items, {}).length, 2, 'no filters returns all');

// summarize
assert.deepEqual(summarize(items), { total: 2, low: 1, ok: 1 });

// fieldsToCells (still used for the read-only Smartsheet catalog mapping)
const titleToId = columnIndex(sheet.columns);
const cells = fieldsToCells({ name: 'Coffee Beans', minimum: 8 }, COLUMN_MAP, titleToId);
assert.equal(cells.length, 2);
assert.deepEqual(cells.find((c) => c.columnId === 102), { columnId: 102, value: 'Coffee Beans' });
assert.deepEqual(cells.find((c) => c.columnId === 106), { columnId: 106, value: 8 });
assert.equal(fieldsToCells({ bogus: 1 }, COLUMN_MAP, titleToId).length, 0, 'unknown field skipped');

console.log('All inventory-logic checks passed ✓');
