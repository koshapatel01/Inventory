// Removes only the example/demo data seeded by scripts/reset-demo-data.mjs
// (the 6 "[Example] ..." items and their walkthrough activity, all keyed
// under row_id "demo-0001".."demo-0006") — leaves every real Smartsheet
// catalog item, its quantities, and any real order/transfer/receiving
// history completely untouched. Never touches the Smartsheet inventory
// catalog or the audit-log sheet — Smartsheet already has the mirrored
// example events from when they were created; this only removes them from
// the local app, same as clearing history has always worked here.
//
// Defaults to a dry run. Run with: npm run db:remove-demo -- --yes

import { sql } from '../lib/db.js';

const CONFIRMED = process.argv.includes('--yes');
const DEMO_ROW_IDS = ['demo-0001', 'demo-0002', 'demo-0003', 'demo-0004', 'demo-0005', 'demo-0006'];

const demoOrders = await sql`SELECT id, item_name FROM orders WHERE row_id = ANY(${DEMO_ROW_IDS})`;
const demoTransfers = await sql`SELECT id, item FROM transfers WHERE row_id = ANY(${DEMO_ROW_IDS})`;
const demoTransactions = await sql`SELECT id, item FROM transactions WHERE row_id = ANY(${DEMO_ROW_IDS})`;
const demoManualItems = await sql`SELECT row_id, name FROM manual_items WHERE row_id = ANY(${DEMO_ROW_IDS})`;
const demoItemRows = await sql`SELECT row_id FROM items WHERE row_id = ANY(${DEMO_ROW_IDS})`;

console.log(`Found: ${demoManualItems.length} example items, ${demoOrders.length} example orders, ${demoTransfers.length} example transfers, ${demoTransactions.length} example receiving-log entries, ${demoItemRows.length} example item quantity rows.`);
for (const m of demoManualItems) console.log(' -', m.row_id, m.name);

if (demoManualItems.length === 0) {
  console.log('\nNothing to remove — no example data found.');
  process.exit(0);
}

if (!CONFIRMED) {
  console.log('\nDry run only — nothing changed. Re-run with --yes to remove this example data.');
  process.exit(0);
}

const orderIds = demoOrders.map((o) => o.id);
await sql`DELETE FROM order_deliveries WHERE order_id = ANY(${orderIds})`;
await sql`DELETE FROM orders WHERE row_id = ANY(${DEMO_ROW_IDS})`;
await sql`DELETE FROM transfers WHERE row_id = ANY(${DEMO_ROW_IDS})`;
await sql`DELETE FROM transactions WHERE row_id = ANY(${DEMO_ROW_IDS})`;
await sql`DELETE FROM manual_items WHERE row_id = ANY(${DEMO_ROW_IDS})`;
await sql`DELETE FROM items WHERE row_id = ANY(${DEMO_ROW_IDS})`;

console.log('\nRemoved all example/demo data. Real catalog items and their quantities were not touched.');
