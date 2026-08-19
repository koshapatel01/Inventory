// Wipes all local order/transfer/receiving/invoice history back to a blank
// canvas, then reseeds a small set of clearly-labeled example items and
// activity that demonstrate every workflow and status the app supports —
// so a new user can see what each log actually looks like before any real
// activity exists. Every example item is named "[Example] ..." with a
// DEMO-xxxx SKU and "Example (Demo Data)" as the person, so nothing here
// can be mistaken for a real order or a real staff member's activity later.
//
// Reuses the exact same functions the app itself calls (placeOrder,
// receiveOrder, cancelOrder, transferStock, logEvent) rather than hand-built
// SQL, so the seeded data is structurally identical to what a real user
// action produces, and is mirrored to the Smartsheet audit-log sheet exactly
// like a real action would be — keeping the local database and that sheet in
// sync instead of a special-cased shortcut.
//
// DESTRUCTIVE: deletes every row in orders, order_deliveries, transfers,
// transactions, invoices, and invoice_files; deletes every manual catalog
// item; and resets every item's quantity to 0. The Smartsheet inventory
// catalog itself (lib/smartsheet.js) is never written to, and existing rows
// already on the Smartsheet audit-log sheet are never deleted — only new
// rows get appended there, for the example activity below.
//
// Defaults to a dry run (prints what's currently there, changes nothing).
// Run with:  npm run db:reset-demo -- --yes

import { sql } from '../lib/db.js';
import { placeOrder, receiveOrder, cancelOrder, transferStock } from '../lib/localStore.js';
import { logEvent } from '../lib/smartsheetLog.js';

const CONFIRMED = process.argv.includes('--yes');
const DEMO_PERSON = 'Example (Demo Data)';

const TABLES = ['items', 'manual_items', 'orders', 'order_deliveries', 'transfers', 'transactions', 'invoices', 'invoice_files'];

const before = {};
for (const t of TABLES) {
  const rows = await sql.query(`SELECT COUNT(*)::int AS n FROM ${t}`);
  before[t] = rows[0].n;
}
console.log('Current row counts:', before);

if (!CONFIRMED) {
  console.log('\nDry run only — nothing changed. Re-run with --yes to wipe history and reseed example data.');
  process.exit(0);
}

console.log('\nClearing local history (Smartsheet catalog and audit-log sheet are not touched)...');
await sql`DELETE FROM order_deliveries`;
await sql`DELETE FROM orders`;
await sql`DELETE FROM transfers`;
await sql`DELETE FROM transactions`;
await sql`DELETE FROM invoices`;
await sql`DELETE FROM invoice_files`;
await sql`DELETE FROM manual_items`;
await sql`UPDATE items SET qty_s755 = 0, qty_s821 = 0, qty_tls = 0, status = NULL`;
console.log('Cleared.');

async function seedItem({ rowId, sku, name, category, minimum, vendor, qtyS755 }) {
  await sql`
    INSERT INTO manual_items (row_id, sku, name, category, minimum, vendor, order_link, created_at)
    VALUES (${rowId}, ${sku}, ${name}, ${category}, ${minimum}, ${vendor}, NULL, now())
  `;
  await sql`
    INSERT INTO items (row_id, qty_s755, qty_s821, qty_tls, status)
    VALUES (${rowId}, ${qtyS755}, 0, 0, NULL)
    ON CONFLICT (row_id) DO UPDATE SET qty_s755 = EXCLUDED.qty_s755
  `;
}

function logOrderPlaced(order) {
  return logEvent({
    timestamp: new Date().toISOString(),
    eventType: 'Order Placed',
    item: order.itemName,
    itemNumber: order.itemNumber,
    quantity: order.quantityOrdered,
    unitPrice: order.unitPrice,
    extendedTotal: order.estimatedTotal,
    vendor: order.vendor,
    person: order.orderedBy,
    orderId: order.id,
    notes: order.notes,
  });
}

console.log('\nSeeding example items and walkthrough activity...');

// 1. OK status, plus a Transfer History example.
await seedItem({ rowId: 'demo-0001', sku: 'DEMO-0001', name: '[Example] Copy Paper', category: 'Office Supplies', minimum: 20, vendor: 'Gateway', qtyS755: 30 });
await transferStock({ rowId: 'demo-0001', itemName: '[Example] Copy Paper', itemNumber: 'DEMO-0001', quantity: 10, destination: 'S821', person: DEMO_PERSON });
await logEvent({ timestamp: new Date().toISOString(), eventType: 'Transfer', item: '[Example] Copy Paper', itemNumber: 'DEMO-0001', quantity: 10, source: 'S755', destination: 'S821', person: DEMO_PERSON });

// 2. Low status, nothing on order yet — the plain "needs reordering" case.
await seedItem({ rowId: 'demo-0002', sku: 'DEMO-0002', name: '[Example] Coffee Pods', category: 'Breakroom Supplies', minimum: 15, vendor: 'Tejas', qtyS755: 4 });

// 3. Ordered (pending, not yet received) — status shows "Ordered", overriding Low.
await seedItem({ rowId: 'demo-0003', sku: 'DEMO-0003', name: '[Example] Legal Pads', category: 'Office Supplies', minimum: 10, vendor: 'Gateway', qtyS755: 3 });
const order3 = await placeOrder({ rowId: 'demo-0003', itemName: '[Example] Legal Pads', itemNumber: 'DEMO-0003', quantity: 20, orderedBy: DEMO_PERSON, vendor: 'Gateway', unitPrice: 4.5, notes: '[Example] order — not yet received' });
await logOrderPlaced(order3);

// 4. Full lifecycle: placed, then fully received — Order History "Received" + a Receiving Log entry + restocked.
await seedItem({ rowId: 'demo-0004', sku: 'DEMO-0004', name: '[Example] Hand Soap Refills', category: 'Breakroom Supplies', minimum: 12, vendor: 'Tejas', qtyS755: 2 });
const order4 = await placeOrder({ rowId: 'demo-0004', itemName: '[Example] Hand Soap Refills', itemNumber: 'DEMO-0004', quantity: 24, orderedBy: DEMO_PERSON, vendor: 'Tejas', unitPrice: 3.25, notes: '[Example] order' });
await logOrderPlaced(order4);
const receipt4 = await receiveOrder({ orderId: order4.id, quantity: 24, notes: '[Example] delivery received in full' });
await logEvent({
  timestamp: new Date().toISOString(), eventType: 'Order Received', item: receipt4.order.itemName, itemNumber: receipt4.order.itemNumber,
  quantity: 24, unitPrice: receipt4.order.unitPrice, extendedTotal: 24 * receipt4.order.unitPrice, vendor: receipt4.order.vendor,
  source: receipt4.order.vendor, destination: 'S755', person: receipt4.order.orderedBy, orderId: receipt4.order.id, notes: '[Example] delivery received in full',
});

// 5. Partial receipt — order shows "Partially Received"; the item itself still shows "Ordered" (pending), not OK, even though enough arrived to clear its minimum.
await seedItem({ rowId: 'demo-0005', sku: 'DEMO-0005', name: '[Example] Sticky Notes', category: 'Office Supplies', minimum: 10, vendor: 'Amazon', qtyS755: 1 });
const order5 = await placeOrder({ rowId: 'demo-0005', itemName: '[Example] Sticky Notes', itemNumber: 'DEMO-0005', quantity: 30, orderedBy: DEMO_PERSON, vendor: 'Amazon', unitPrice: 2.1, notes: '[Example] order — partially delivered' });
await logOrderPlaced(order5);
const receipt5 = await receiveOrder({ orderId: order5.id, quantity: 15, notes: '[Example] partial delivery — 15 of 30' });
await logEvent({
  timestamp: new Date().toISOString(), eventType: 'Order Received', item: receipt5.order.itemName, itemNumber: receipt5.order.itemNumber,
  quantity: 15, unitPrice: receipt5.order.unitPrice, extendedTotal: 15 * receipt5.order.unitPrice, vendor: receipt5.order.vendor,
  source: receipt5.order.vendor, destination: 'S755', person: receipt5.order.orderedBy, orderId: receipt5.order.id, notes: '[Example] partial delivery — 15 of 30',
});

// 6. Cancelled order — item stays Low (a cancellation doesn't clear the pending-order override the way a receipt does), and still counts toward Cost Analysis spend, matching how the app treats cancellations elsewhere.
await seedItem({ rowId: 'demo-0006', sku: 'DEMO-0006', name: '[Example] Dry Erase Markers', category: 'Office Supplies', minimum: 8, vendor: 'Gateway', qtyS755: 2 });
const order6 = await placeOrder({ rowId: 'demo-0006', itemName: '[Example] Dry Erase Markers', itemNumber: 'DEMO-0006', quantity: 16, orderedBy: DEMO_PERSON, vendor: 'Gateway', unitPrice: 5, notes: '[Example] order — later cancelled' });
await logOrderPlaced(order6);
await cancelOrder({ orderId: order6.id });
await logEvent({
  timestamp: new Date().toISOString(), eventType: 'Order Cancelled', item: order6.itemName, itemNumber: order6.itemNumber,
  quantity: order6.quantityOrdered, unitPrice: order6.unitPrice, extendedTotal: order6.estimatedTotal, vendor: order6.vendor,
  person: order6.orderedBy, orderId: order6.id,
});

const after = {};
for (const t of TABLES) {
  const rows = await sql.query(`SELECT COUNT(*)::int AS n FROM ${t}`);
  after[t] = rows[0].n;
}
console.log('\nDone. Row counts now:', after);
console.log(
  '\nSeeded 6 example items covering every status and log:\n' +
    '  DEMO-0001 [Example] Copy Paper          — OK, with a Transfer History entry\n' +
    '  DEMO-0002 [Example] Coffee Pods          — Low, nothing on order\n' +
    '  DEMO-0003 [Example] Legal Pads           — Ordered (pending)\n' +
    '  DEMO-0004 [Example] Hand Soap Refills    — Received in full (Order History + Receiving Log)\n' +
    '  DEMO-0005 [Example] Sticky Notes         — Partially received\n' +
    '  DEMO-0006 [Example] Dry Erase Markers    — Order placed, then cancelled\n'
);
