// Syncs each real Smartsheet catalog item's local Qty S755 to match its
// current "Qty On-Hand" value on the Smartsheet — e.g. to restore real
// starting stock after a blank-canvas reset (see scripts/reset-demo-data.mjs),
// or any time Smartsheet's on-hand counts get updated and should be pulled
// into the app. Only touches qty_s755 (S821/TLS are local-only breakroom
// quantities Smartsheet has no equivalent for) and only for rows the
// Smartsheet catalog actually has — locally-owned items (manual-add or
// demo items) are left untouched, since they have no Smartsheet Qty
// On-Hand to sync from.
//
// Defaults to a dry run (prints what would change). Run with:
// npm run db:sync-qty -- --yes

import { sql } from '../lib/db.js';
import { getInventory } from '../lib/smartsheet.js';

const CONFIRMED = process.argv.includes('--yes');

const { items } = await getInventory();
const existing = await sql`SELECT row_id, qty_s755 FROM items`;
const existingByRowId = new Map(existing.map((r) => [String(r.row_id), Number(r.qty_s755) || 0]));

const changes = [];
let untracked = 0;
for (const item of items) {
  const rowId = String(item.rowId);
  const sheetQty = Number(item.quantity) || 0;
  const currentQty = existingByRowId.get(rowId);
  if (currentQty === undefined) {
    untracked++;
    continue; // Not locally tracked yet — mergeAndSync seeds these correctly on the next page load.
  }
  if (currentQty !== sheetQty) {
    changes.push({ rowId, name: item.name, sku: item.sku, from: currentQty, to: sheetQty });
  }
}

console.log(`${items.length} Smartsheet catalog items checked (${untracked} not yet locally tracked, skipped).`);
console.log(`${changes.length} item(s) need a Qty S755 update:`);
for (const c of changes) console.log(` - ${c.sku || c.rowId} ${c.name}: ${c.from} -> ${c.to}`);

if (!CONFIRMED) {
  console.log('\nDry run only — nothing changed. Re-run with --yes to apply.');
  process.exit(0);
}

for (const c of changes) {
  await sql`UPDATE items SET qty_s755 = ${c.to} WHERE row_id = ${c.rowId}`;
}
console.log(`\nUpdated Qty S755 for ${changes.length} item(s).`);
