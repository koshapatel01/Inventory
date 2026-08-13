// Standalone Node tests for the pure inventory logic. No network, no deps.
// Run with:  npm run verify   (or  node scripts/verify.mjs)

import assert from 'node:assert/strict';
import {
  rowsToItems,
  columnIndex,
  totalQuantity,
  isLowStock,
  canTransfer,
  computeEstimatedTotal,
  deriveOrderStatus,
  filterItems,
  fieldsToCells,
  summarize,
} from '../lib/inventory.js';
import { parseInvoiceText } from '../lib/invoiceParser.js';

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

// computeEstimatedTotal
assert.equal(computeEstimatedTotal(10, 2.5), 25);
assert.equal(computeEstimatedTotal('x', 2.5), 0, 'non-numeric quantity yields 0');
assert.equal(computeEstimatedTotal(10, undefined), 0, 'missing price yields 0');

// deriveOrderStatus
assert.equal(deriveOrderStatus(50, 0), 'Ordered');
assert.equal(deriveOrderStatus(50, 20), 'Partially Received');
assert.equal(deriveOrderStatus(50, 50), 'Received');
assert.equal(deriveOrderStatus(50, 60), 'Received', 'over-received still counts as fully received');

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

// parseInvoiceText — fixture approximates the flat text a PDF text-extractor
// would produce for the sample Gateway invoice (table structure lost, one
// "cell" per line, but no consistent column alignment to rely on).
const invoiceFixture = `
Invoice
Status: Processed
Reference Number: 5747741-0
Order Date: 7/27/2026
Invoice Date: 7/28/2026
Account Number: UH5015: UH-D INFORMATION TECHNOLOGY
Submitted By: Project Office
GATEWAY
315 South Closner
Edinburg, TX 78539
Phone: (210) 650-3995 Fax: (210) 650-5506 GatewayP.com
Bill To:
UH-D INFORMATION TECHNOLOGY
Ship To:
UH-D INFORMATION TECHNOLOGY
# SKU Description And Comments Qty Unit Price Extended
1
TWG09180
Twinings of London Lemon & Ginger Herbal Tea Bag - 1.3 oz - Decaffeinated - 25 / Box
1
Box
$8.21
$8.21
2
DCC12J12
Dart J Cup 12 oz Insulated Foam Cups - White - Foam - 25/Bag - 40 / Carton
1
Carton
$51.47
$51.47
3
FOL06430
Folgers&reg Fraction Pack Classic Roast Coffee - Regular - Medium - 42 / Carton
3
Carton
$45.27
$135.81
4
GJO0010430
Genuine Joe Medium-Heavyweight Plastic Forks - Disposable - White - 100 / Box
2
Box
$4.41
$8.82
5
KND41936
KIND DARK CHOCOLATE COCOA PROT
1
Box
FREE
FREE
Promotion Used: 200
Items: $204.31
Shipping: $0.00
Subtotal: $204.31
Tax: $0.00
Total: $204.31
Thank you.
`;

// In the real app these come from the Smartsheet catalog (see app/api/invoices/route.js).
const knownSkus = ['TWG09180', 'DCC12J12', 'FOL06430', 'GJO0010430', 'KND41936'];
const parsedInvoice = parseInvoiceText(invoiceFixture, knownSkus);
assert.equal(parsedInvoice.vendor, 'Gateway');
assert.equal(parsedInvoice.referenceNumber, '5747741-0');
assert.equal(parsedInvoice.orderDate, '7/27/2026');
assert.equal(parsedInvoice.invoiceDate, '7/28/2026');
assert.equal(parsedInvoice.lineItems.length, 5, 'should find all 5 line items');

const [tea, cups, coffee, forks, bar] = parsedInvoice.lineItems;
assert.equal(tea.sku, 'TWG09180');
assert.equal(tea.quantity, 1);
assert.equal(tea.unitPrice, 8.21);
assert.equal(tea.extendedPrice, 8.21);

assert.equal(cups.sku, 'DCC12J12');
assert.equal(cups.quantity, 1, 'quantity should be 1, not the 40-per-carton pack size from the description');
assert.equal(cups.unitPrice, 51.47);

assert.equal(coffee.sku, 'FOL06430');
assert.equal(coffee.quantity, 3, 'quantity should be 3, not the 42-per-carton pack size from the description');
assert.equal(coffee.unitPrice, 45.27);
assert.equal(coffee.extendedPrice, 135.81);

assert.equal(forks.sku, 'GJO0010430');
assert.equal(forks.quantity, 2, 'quantity should be 2, not the 100-per-box pack size from the description');

assert.equal(bar.sku, 'KND41936');
assert.equal(bar.unitPrice, 0, '"FREE" should parse as $0.00');
assert.equal(bar.extendedPrice, 0);

// An invoice with no recognizable vendor/table still parses without throwing.
const emptyParse = parseInvoiceText('Just some random unrelated text.');
assert.equal(emptyParse.vendor, null);
assert.deepEqual(emptyParse.lineItems, []);

// Real PDF text extractors often glue same-row table cells together with NO
// separator at all (only a line break on vertical-position change) — e.g.
// "1TWG09180Twinings of London...25 / Box1Box$8.21$8.21". The parser must
// still find the SKU and the right quantity/price in that case.
const gluedFixture =
  '1TWG09180Twinings of London Lemon and Ginger Herbal Tea Bag - 1.3 oz - 25 / Box1Box$8.21$8.21' +
  '2DCC12J12Dart J Cup 12 oz Insulated Foam Cups - 25/Bag - 40 / Carton1Carton$51.47$51.47' +
  '3FOL06430Folgers Fraction Pack Classic Roast Coffee - 42 / Carton3Carton$45.27$135.81' +
  'Items: $238.55';
const gluedParse = parseInvoiceText(gluedFixture, ['TWG09180', 'DCC12J12', 'FOL06430']);
assert.equal(gluedParse.lineItems.length, 3, 'should find all 3 glued-together line items');
assert.equal(gluedParse.lineItems[0].quantity, 1);
assert.equal(gluedParse.lineItems[0].unitPrice, 8.21);
assert.equal(gluedParse.lineItems[1].quantity, 1);
assert.equal(gluedParse.lineItems[2].quantity, 3, 'quantity 3, not the 42-per-carton pack size, even with no spaces');
assert.equal(gluedParse.lineItems[2].unitPrice, 45.27);
assert.equal(gluedParse.lineItems[2].extendedPrice, 135.81);

// If a line's SKU isn't in the catalog (e.g. an item not yet added to
// Smartsheet, or a promo line), there's no boundary marker for it in the
// text — the previous *matched* item's window must not run past it and
// steal its price as its own.
const unmatchedTrailingFixture = `
TWG09180
Twinings of London Lemon & Ginger Herbal Tea Bag - 1.3 oz - 25 / Box
2
Box
$4.41
$8.82
NEWITEM99
Some New Product Not Yet In The Catalog
1
Box
FREE
FREE
Items: $8.82
`;
const unmatchedTrailingParse = parseInvoiceText(unmatchedTrailingFixture, ['TWG09180']);
assert.equal(unmatchedTrailingParse.lineItems.length, 1, 'only the catalog SKU should produce a line item');
assert.equal(unmatchedTrailingParse.lineItems[0].quantity, 2, 'quantity should be this item\'s own, not stolen from the next uncataloged item');
assert.equal(unmatchedTrailingParse.lineItems[0].unitPrice, 4.41);
assert.equal(unmatchedTrailingParse.lineItems[0].extendedPrice, 8.82);

// Real Tejas invoice text (pasted by the user from the app's "extracted
// text" troubleshooting panel). Unlike Gateway, Tejas prices have no `$`
// sign, and each row has TWO leading integer columns (Qty, Shipped) before
// the UOM code, not one — this is what PLAIN_PRICE_LINE_PATTERN targets.
const tejasFixture = `
INVOICE
1225 West 20th Street
HOUSTON, TX 77008
(713) 864-6004
Fax (713) 864-5562
Nancy Butler
Entered By: Web
NButler - Information Tech Support
Bill To:
Ship To:
University of Houston - Downtown/CC Acct.
One Main St., Rm# S-701
HOUSTON, TX 77002
US
Invoice Number: SI-925015
Page: 1
Invoice Date: 7/2/2026
of 1
Sales Order: 1962412
Purchase Order:
Billing Code:
Salesperson: GC01
Department Number: NButler
Due Date: 7/2/2026
Terms: Receipt
Customer Number: CUS-012204One Main St., Rm# S-701
HOUSTON, TX 77002
US
University of Houston - Downtown/CC Acct.
Ordered By: ITPMO Users
Item Number Description Qty Shipped UOM Unit Price Unit Total
AJMCP9AJCWWH1CT PLATE,PPR,CLAYCOAT,8.75",WE 1 1 CT 54.24 54.24
MEA06074 NOTEBOOK,8X5 20#,BK 9 9 EA 8.25 74.25
GJO21040 TOWEL,MULTIFOLD,NRTL.250/PK 2 2 CT 29.95 59.90
BTC10348 TEA,BIGELOW,EARL GREY 1 1 BX 8.50 8.50
Payments:
Payments:
Date Description Amount
7/2/2026 Credit card payment:6282 196.89
Amount Due 0.00
Sub-Total 196.89
Sales Tax 0.00
Total 196.89
Please Remit To: 1225 W. 20th Street, Houston, Texas 77008-3315
Please visit us at www.tejasoffice.com
`;
const tejasKnownSkus = ['AJMCP9AJCWWH1CT', 'MEA06074', 'GJO21040', 'BTC10348'];
const tejasParse = parseInvoiceText(tejasFixture, tejasKnownSkus);
assert.equal(tejasParse.vendor, 'Tejas');
assert.equal(tejasParse.referenceNumber, 'SI-925015', 'falls back to Invoice Number when there is no Reference Number label');
assert.equal(tejasParse.invoiceDate, '7/2/2026');
assert.equal(tejasParse.lineItems.length, 4, 'should find all 4 line items with no $ signs at all');

const [plate, notebook, towel, tejasTea] = tejasParse.lineItems;
assert.equal(plate.sku, 'AJMCP9AJCWWH1CT');
assert.equal(plate.quantity, 1, 'the 8.75" size in the description must not be mistaken for the price');
assert.equal(plate.unitPrice, 54.24);
assert.equal(plate.extendedPrice, 54.24);

assert.equal(notebook.sku, 'MEA06074');
assert.equal(notebook.quantity, 9);
assert.equal(notebook.unitPrice, 8.25);

assert.equal(towel.sku, 'GJO21040');
assert.equal(towel.quantity, 2);
assert.equal(towel.unitPrice, 29.95);
assert.equal(towel.extendedPrice, 59.90);

assert.equal(tejasTea.sku, 'BTC10348');
assert.equal(tejasTea.quantity, 1, 'the trailing Payments/Sub-Total block (no colons) must not bleed into the last item');
assert.equal(tejasTea.unitPrice, 8.50);
assert.equal(tejasTea.extendedPrice, 8.50);

console.log('All inventory-logic checks passed ✓');
