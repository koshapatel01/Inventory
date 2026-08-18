import { NextResponse } from 'next/server';
import { getInventory } from '@/lib/smartsheet';
import { addManualItem, getManualCatalogItems } from '@/lib/localStore';

export const dynamic = 'force-dynamic';

// POST /api/inventory/manual  { sku, name, vendor }  ->  { item }
// Creates a new locally-owned catalog item for an invoice line whose SKU
// isn't in the Smartsheet catalog — Smartsheet itself is never written to.
// The item is categorized 'Manual Add' and merged into the main inventory
// list the same way Smartsheet rows are (see lib/localStore.js's
// mergeAndSync). Blocks reusing a name already used by a different SKU.
export async function POST(request) {
  try {
    const body = await request.json();
    const { items: catalogItems } = await getInventory();
    const existingCatalog = [...catalogItems, ...(await getManualCatalogItems())];
    const item = await addManualItem(
      { sku: body.sku, name: body.name, vendor: body.vendor },
      existingCatalog
    );
    return NextResponse.json({ ok: true, item });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 400 });
  }
}
