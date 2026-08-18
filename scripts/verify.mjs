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
  deriveItemStatus,
  filterItems,
  fieldsToCells,
  summarize,
} from '../lib/inventory.js';
import { parseInvoiceText, matchLineItemToCatalog } from '../lib/invoiceParser.js';
import {
  extendedTotalFor,
  isMissingPrice,
  monthKey,
  buildSpendRecords,
  filterRecords,
  summarize as summarizeSpend,
  summarizeItem,
  buildMonthlySeries,
  buildCategoryTotals,
  rankItemsBySpend,
} from '../lib/costAnalysis.js';

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

// Simulate the local merge: Coffee is low (total 2 < min 5), Pens is not (40 > 10).
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
assert.equal(isLowStock({ qtyS755: 5, minimum: 5 }), false, 'exactly at minimum is OK, not low');
assert.equal(isLowStock({ qtyS755: 4, minimum: 5 }), true, 'just below minimum is low');
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

// deriveItemStatus
assert.equal(deriveItemStatus(items[0], false), 'Low', 'low stock, no pending order');
assert.equal(deriveItemStatus(items[1], false), 'OK', 'sufficient stock, no pending order');
assert.equal(deriveItemStatus(items[1], true), 'Ordered', 'pending order overrides OK');
assert.equal(deriveItemStatus(items[0], true), 'Ordered', 'pending order overrides Low too');

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

// Real Amazon "Final Details for Order" text (pasted by the user from the
// app's troubleshooting panel). Unlike Gateway/Tejas, there is NO SKU
// anywhere in the text at all — only "N of: <product title>" and a single
// unit price per line, no separate extended total.
const amazonFixture = `
Final Details for Order #114-2841024-9625015
Order Placed: July 9, 2026
Amazon.com order number: 114-2841024-9625015
Order Total: $37.90
Shipped on July 10, 2026
Items Ordered Price
2 of: OXO Good Grips POP Container - Airtight Food Storage - Big Square Short 2.8 Qt Ideal for 5 lbs of sugar, cookies or crac
kers
Sold by and invoiced on behalf of: Amazon (seller profile)
Business Price
Condition: New
$18.95
Shipping Address:
Nancy Butler
1st Street
UHD Mailroom Suite N101
Houston, TX 77002
United States
Shipping Speed:
FREE Prime Delivery
Item(s) Subtotal: $37.90
Shipping & Handling: $0.00
-----
Total before tax: $37.90
Sales Tax: $0.00
-----
Total for This Shipment: $37.90
-----
Payment information
Payment Method:
MasterCard | Last digits: 6282
Billing address
Kimberley Solomon
1 MAIN ST
HOUSTON, TX 77002-1014
United States
Item(s) Subtotal: $37.90
Shipping & Handling: $0.00
-----
Total before tax: $37.90
Estimated Tax: $0.00
-----
Grand Total: $37.90
Credit Card transactions
MasterCard ending in 6282: July 10, 2026: $37.90
To view the status of your order, return to Order Summary .
Conditions of Use | Privacy Notice © 1996-2020, Amazon.com, Inc.
`;
const amazonParse = parseInvoiceText(amazonFixture);
assert.equal(amazonParse.vendor, 'Amazon');
assert.equal(amazonParse.referenceNumber, '114-2841024-9625015', 'falls back to the Amazon order number label');
assert.equal(amazonParse.orderDate, 'July 9, 2026', 'falls back to "Order Placed" label');
assert.equal(amazonParse.lineItems.length, 1, 'should find the one line item with no SKU at all');

const [oxo] = amazonParse.lineItems;
assert.equal(oxo.sku, null, 'Amazon prints no SKU — matching must fall back to name');
assert.equal(oxo.quantity, 2);
assert.equal(oxo.unitPrice, 18.95);
assert.equal(oxo.extendedPrice, 37.90, 'qty x unit price, since Amazon never prints a per-line extended total');
assert.ok(
  oxo.description.startsWith('OXO Good Grips POP Container'),
  'description should be the product title, not the Sold by/Condition boilerplate'
);
assert.ok(!/Sold by|Condition/.test(oxo.description), 'boilerplate after the title should be stripped');

// Real bug report: the same Tejas invoice as above, but with its first item
// (AJMCP9AJCWWH1CT) NOT in the catalog yet. Tejas's column header row reads
// "...Unit Price Unit Total" — the word "Total" in that header was wrongly
// read as the start of the totals/payments block, cutting the generic-SKU
// fallback's search window off before a single item row was reached, so the
// uncataloged first item vanished (and only it — the other 3 rows, already
// matched by known SKU, showed up fine) with the parsed total short by
// exactly its $54.24 price.
const tejasKnownSkusMissingFirst = ['MEA06074', 'GJO21040', 'BTC10348']; // AJMCP9AJCWWH1CT deliberately excluded
const tejasPartialParse = parseInvoiceText(tejasFixture, tejasKnownSkusMissingFirst);
assert.equal(
  tejasPartialParse.lineItems.length,
  4,
  'all 4 Tejas rows should be parsed even though the first SKU is not in the catalog'
);
assert.equal(tejasPartialParse.lineItems[0].sku, 'AJMCP9AJCWWH1CT', 'uncataloged first item should still surface via the generic fallback');
assert.equal(tejasPartialParse.lineItems[0].quantity, 1);
assert.equal(tejasPartialParse.lineItems[0].unitPrice, 54.24);
assert.equal(tejasPartialParse.lineItems[0].extendedPrice, 54.24);
const tejasPartialSum = tejasPartialParse.lineItems.reduce((s, l) => s + l.extendedPrice, 0);
assert.ok(Math.abs(tejasPartialSum - 196.89) < 0.001, `Tejas parsed line items should sum to the invoice total (got ${tejasPartialSum})`);

// Real Gateway invoice text (pasted by the user) where several line items'
// SKUs aren't in the Smartsheet catalog yet (Post-it notes, a wastebasket, a
// promo cracker box) — before the generic-SKU fallback, these vanished
// entirely instead of surfacing as "no catalog match" rows, so the parsed
// total silently came up short of the invoice's real total with no
// indication why.
const partiallyCatalogedFixture = `
# SKU Description And Comments Qty Unit Price Extended
1
MMM62218SSMIACP
Post-it&reg Super Sticky Notes - Supernova Neons Color Collection - 2" Flag/Note Width x 2" Flag/Note Length - Square - 90 Sheets per Pad - Aqua Splash, Acid Lime, Guava, Iris Infusion - Paper - Super Sticky, Adhesive, Recyclable, Residue-free - 1620 / Pac
1
Pack
$17.27
$17.27
2
FOL06430
Folgers&reg Fraction Pack Classic Roast Coffee - Regular - Medium - 1.5 oz Per Bag - Fraction Pack - 42 / Carton
3
Carton
$45.27
$135.81
3
OFD566143
Highmark&#8482 Rectangular Plastic Wastebasket - 6.5 Gallons - 15"H x 10"W x 14-1/4"D - Black - Open Top - 6.50 gal Capacity - Rectangular - 15" Height x 10" Width x 14.2" Depth - Plastic - Black - 1 Each
1
Each
$8.26
$8.26
4
NES31831CT
Coffee mate Hazelnut Liquid Concentrate Coffee Creamer - Pump Bottle - Hazelnut Flavor - 50.70 fl oz (1.50 L) - 600 Serving - 2 / Carton
1
Carton
$60.85
$60.85
5
NES55882
Coffee mate Original Powdered Coffee Creamer Canister - Original Flavor - 0.69 lb (11 oz) - 155 Serving - 1 Each
1
Each
$6.81
$6.81
6
KEB31533
CRACKER,CHEDDR,WHT,CHEEZIT
1
Box
FREE
FREE
Promotion Used: 300
Items: $229.00
`;
const gatewayKnownSkus = ['FOL06430', 'NES31831CT', 'NES55882']; // only these 3 are in the catalog
const partialParse = parseInvoiceText(partiallyCatalogedFixture, gatewayKnownSkus);
assert.equal(
  partialParse.lineItems.length,
  6,
  'all 6 rows should be parsed, not just the 3 already in the catalog — uncataloged SKUs must surface, not vanish'
);
assert.deepEqual(
  partialParse.lineItems.map((l) => l.sku),
  ['MMM62218SSMIACP', 'FOL06430', 'OFD566143', 'NES31831CT', 'NES55882', 'KEB31533']
);
const parsedSum = partialParse.lineItems.reduce((s, l) => s + l.extendedPrice, 0);
assert.ok(Math.abs(parsedSum - 229.0) < 0.001, `parsed line items should sum to the invoice total (got ${parsedSum})`);
assert.equal(partialParse.invoiceTotal, 229.0, 'should extract the "Items: $229.00" total for reconciliation');

// The generic-fallback SKUs correctly report no catalog match (they're not
// in fakeCatalogGateway below) rather than crashing or false-matching.
const fakeCatalogGateway = [
  { rowId: 10, sku: 'FOL06430', name: 'Folgers Coffee', minimum: 2, vendor: 'Gateway' },
  { rowId: 11, sku: 'NES31831CT', name: 'Hazelnut Liquid Pumps', minimum: 1, vendor: 'Gateway' },
  { rowId: 12, sku: 'NES55882', name: 'Original Creamer Powder', minimum: 1, vendor: 'Gateway' },
];
const postIt = partialParse.lineItems.find((l) => l.sku === 'MMM62218SSMIACP');
assert.equal(matchLineItemToCatalog(postIt, fakeCatalogGateway), null, 'uncataloged item should report no match, not a wrong guess');
const coffee2 = partialParse.lineItems.find((l) => l.sku === 'FOL06430');
assert.equal(matchLineItemToCatalog(coffee2, fakeCatalogGateway)?.rowId, 10, 'cataloged item should still match exactly as before');

// extractInvoiceTotal via parseInvoiceText: Tejas has no "Items:" line, so it
// should fall back to "Sub-Total" (no $ sign, matches PLAIN_PRICE_LINE style).
assert.equal(tejasParse.invoiceTotal, 196.89, 'should extract the Tejas "Sub-Total 196.89" for reconciliation');

// matchLineItemToCatalog: SKU lines match exactly as before; no-SKU lines
// (Amazon) fall back to a fuzzy name match against the catalog.
const fakeCatalog = [
  { rowId: 1, sku: 'OXO-POP', name: 'OXO POP Container', minimum: 2, vendor: 'Amazon' },
  { rowId: 2, sku: 'TWG09180', name: 'Lemon & Ginger Tea', minimum: 5, vendor: 'Gateway' },
];
assert.equal(
  matchLineItemToCatalog(oxo, fakeCatalog)?.rowId,
  1,
  'fuzzy word-overlap match should find the OXO container even though "OXO POP Container" never appears ' +
    'as one contiguous phrase in the padded marketing title'
);
assert.equal(matchLineItemToCatalog({ sku: 'TWG09180', description: '' }, fakeCatalog)?.rowId, 2, 'exact SKU match still takes priority');
assert.equal(matchLineItemToCatalog({ sku: null, description: 'totally unrelated text' }, fakeCatalog), null, 'no match found is null, not a crash');

// ── Cost analysis dashboard ──────────────────────────────────────────
// Order Placed records shaped like lib/localStore.js's toOrder(), covering:
// two Office items, one Breakroom item, a cancelled order (still counted —
// cancelling doesn't undo the fact that an order was placed), and one with
// a missing ($0) unit price that should be flagged, not silently dropped.
const costOrders = [
  { id: 'o1', rowId: '1', itemName: 'Pens', itemNumber: 'PEN1', quantityOrdered: 10, unitPrice: 2, estimatedTotal: 20, orderDate: '2026-01-15', vendor: 'Gateway', status: 'Received' },
  { id: 'o2', rowId: '1', itemName: 'Pens', itemNumber: 'PEN1', quantityOrdered: 5, unitPrice: 2, estimatedTotal: 10, orderDate: '2026-02-10', vendor: 'Gateway', status: 'Ordered' },
  { id: 'o3', rowId: '2', itemName: 'Coffee', itemNumber: 'COF1', quantityOrdered: 4, unitPrice: 12.5, estimatedTotal: 50, orderDate: '2026-02-20', vendor: 'Tejas', status: 'Received' },
  { id: 'o4', rowId: '3', itemName: 'Staples', itemNumber: 'STA1', quantityOrdered: 3, unitPrice: 4, estimatedTotal: 12, orderDate: '2026-03-01', vendor: 'Amazon', status: 'Cancelled' },
  { id: 'o5', rowId: '2', itemName: 'Coffee', itemNumber: 'COF1', quantityOrdered: 2, unitPrice: 0, estimatedTotal: 0, orderDate: '2026-03-05', vendor: 'Tejas', status: 'Received' },
];
const costCategoryByRowId = new Map([
  ['1', 'Office Supplies'],
  ['2', 'Breakroom Supplies'],
  ['3', 'Office Supplies'],
]);

// extendedTotalFor / isMissingPrice / monthKey
assert.equal(extendedTotalFor({ estimatedTotal: 20 }), 20);
assert.equal(extendedTotalFor({ estimatedTotal: NaN, quantityOrdered: 3, unitPrice: 4 }), 12, 'falls back to qty x price if estimatedTotal is not a number');
assert.equal(isMissingPrice({ unitPrice: 0 }), true);
assert.equal(isMissingPrice({ unitPrice: 2 }), false);
assert.equal(monthKey('2026-03-05'), '2026-03');
assert.equal(monthKey(null), null, 'missing date does not throw');

// buildSpendRecords
const records = buildSpendRecords(costOrders, costCategoryByRowId);
assert.equal(records.length, 5, 'one record per placed order, cancelled order included');
assert.equal(records[3].category, 'Office Supplies');
assert.equal(records[4].missingPrice, true, '$0 unit price is flagged');
assert.equal(records[0].missingPrice, false);
const orphanRecord = buildSpendRecords([{ id: 'o6', rowId: '999', itemName: 'Ghost', quantityOrdered: 1, unitPrice: 5, estimatedTotal: 5, orderDate: '2026-01-01' }], costCategoryByRowId);
assert.equal(orphanRecord[0].category, 'Uncategorized', 'item with no catalog match is Uncategorized, not dropped');

// filterRecords
assert.equal(filterRecords(records, {}).length, 5, 'no filters returns everything');
assert.equal(filterRecords(records, { category: 'Office Supplies' }).length, 3);
assert.equal(filterRecords(records, { rowId: '2' }).length, 2, 'coffee ordered twice');
assert.equal(filterRecords(records, { from: '2026-02-01' }).length, 4, 'excludes the January order');
assert.equal(filterRecords(records, { to: '2026-02-28' }).length, 3, 'excludes March orders');
assert.equal(filterRecords(records, { from: '2026-02-01', to: '2026-02-28' }).length, 2, 'Feb-only window');

// summarize
const officeAndBreakroom = summarizeSpend(records);
assert.equal(officeAndBreakroom.totalSpend, 92, '20+10+50+12+0');
assert.equal(officeAndBreakroom.totalOrders, 5);
assert.equal(officeAndBreakroom.flaggedCount, 1);
assert.deepEqual(officeAndBreakroom.byCategory, { 'Office Supplies': 42, 'Breakroom Supplies': 50 });

// summarizeItem (Coffee: two orders, 6 units total, $50 spend — the $0 order pulls the average down)
const coffeeDetail = summarizeItem(filterRecords(records, { rowId: '2' }));
assert.equal(coffeeDetail.totalSpent, 50);
assert.equal(coffeeDetail.totalQuantity, 6);
assert.equal(coffeeDetail.timesOrdered, 2);
assert.equal(coffeeDetail.avgUnitPrice, 50 / 6);
assert.equal(coffeeDetail.avgCostPerOrder, 25);
assert.deepEqual(summarizeItem([]), { totalSpent: 0, totalQuantity: 0, timesOrdered: 0, avgUnitPrice: 0, avgCostPerOrder: 0 }, 'no orders yields zeros, not NaN/division errors');

// buildMonthlySeries — chronological, one bucket per month
const months = buildMonthlySeries(records);
assert.deepEqual(months.map((m) => m.month), ['2026-01', '2026-02', '2026-03']);
assert.equal(months[1].spend, 60, 'Feb: Pens $10 + Coffee $50');
assert.equal(months[1].orders, 2);
assert.equal(months[2].spend, 12, 'Mar: Staples $12 + Coffee $0');
assert.equal(months[2].orders, 2);

// buildCategoryTotals — sorted by spend descending
const catTotals = buildCategoryTotals(records);
assert.deepEqual(catTotals, [
  { category: 'Breakroom Supplies', spend: 50 },
  { category: 'Office Supplies', spend: 42 },
]);

// rankItemsBySpend — sorted by spend descending, per-item rollup
const ranked = rankItemsBySpend(records);
assert.equal(ranked.length, 3, 'Pens, Coffee, Staples');
assert.equal(ranked[0].item, 'Coffee', 'Coffee ($50) outranks Pens ($30) and Staples ($12)');
assert.equal(ranked[0].totalQuantity, 6);
assert.equal(ranked[0].timesOrdered, 2);
assert.equal(ranked[0].flaggedCount, 1);
assert.equal(ranked[1].item, 'Pens');
assert.equal(ranked[1].totalSpent, 30);
assert.equal(ranked[1].timesOrdered, 2);
assert.equal(ranked[2].item, 'Staples');
assert.equal(ranked[2].flaggedCount, 0);

console.log('All inventory-logic checks passed ✓');
