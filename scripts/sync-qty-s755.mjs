// Syncs local stock to match Smartsheet's current "Qty On-Hand" column.
//
// Smartsheet tracks ONE number per item — the total on hand everywhere — while
// this app splits that total across S755, S821 and TLS. So the sync makes the
// app's TOTAL equal Smartsheet's number, by adjusting S755 (the central
// storage location, and the only one purchases arrive into) and leaving the
// breakroom counts alone:
//
//     new S755 = Smartsheet Qty On-Hand − (S821 + TLS)
//
// Setting S755 to the Smartsheet number directly would double-count anything
// already transferred out to a breakroom — e.g. AA batteries at 210/40/100
// (total 350, matching Smartsheet) would become 350/40/100, a total of 490.
//
// Only items the Smartsheet catalog actually has are touched; locally-owned
// manual-add items are left alone, since they have no Smartsheet quantity to
// sync from.
//
// Defaults to a dry run. Run with: npm run db:sync-qty -- --yes

import { sql } from '../lib/db.js';
import { getInventory } from '../lib/smartsheet.js';

const CONFIRMED = process.argv.includes('--yes');

const { items } = await getInventory();
const existing = await sql`SELECT row_id, qty_s755, qty_s821, qty_tls FROM items`;
const existingByRowId = new Map(existing.map((r) => [String(r.row_id), r]));

const changes = [];
const shortfalls = [];
let untracked = 0;

for (const item of items) {
  const rowId = String(item.rowId);
  const local = existingByRowId.get(rowId);
  if (!local) {
    untracked++;
    continue; // Not locally tracked yet — mergeAndSync seeds these on the next page load.
  }

  const s755 = Number(local.qty_s755) || 0;
  const s821 = Number(local.qty_s821) || 0;
  const tls = Number(local.qty_tls) || 0;
  const sheetTotal = Number(item.quantity) || 0;
  const elsewhere = s821 + tls;
  let target = sheetTotal - elsewhere;

  // Smartsheet says there's less on hand in total than the breakrooms alone
  // are holding — the split can't be represented without changing a breakroom
  // count, which this script deliberately never does. Clamp S755 to 0 and
  // surface it rather than silently writing a negative quantity.
  if (target < 0) {
    shortfalls.push({ sku: item.sku, name: item.name, sheetTotal, elsewhere });
    target = 0;
  }

  if (target !== s755) {
    changes.push({
      rowId, sku: item.sku, name: item.name,
      from: s755, to: target,
      oldTotal: s755 + elsewhere, newTotal: target + elsewhere, sheetTotal,
    });
  }
}

console.log(`${items.length} Smartsheet catalog items checked (${untracked} not yet locally tracked, skipped).`);
console.log(`${changes.length} item(s) need a quantity update (S755 adjusted so the total matches Smartsheet):\n`);
for (const c of changes) {
  const note = c.oldTotal !== c.newTotal ? `total ${c.oldTotal} -> ${c.newTotal}` : 'total unchanged';
  console.log(` - ${c.sku || c.rowId} ${c.name}: S755 ${c.from} -> ${c.to}  (${note})`);
}

if (shortfalls.length) {
  console.log(`\n⚠ ${shortfalls.length} item(s) hold more in S821/TLS than Smartsheet's total on hand — S755 clamped to 0:`);
  for (const s of shortfalls) {
    console.log(`   ${s.sku} ${s.name}: Smartsheet total ${s.sheetTotal}, breakrooms already hold ${s.elsewhere}`);
  }
}

if (!CONFIRMED) {
  console.log('\nDry run only — nothing changed. Re-run with --yes to apply.');
  process.exit(0);
}

for (const c of changes) {
  await sql`UPDATE items SET qty_s755 = ${c.to} WHERE row_id = ${c.rowId}`;
}
console.log(`\nUpdated ${changes.length} item(s).`);
