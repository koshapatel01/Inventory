import Link from 'next/link';
import { getInventory } from '@/lib/smartsheet';
import { mergeAndSync, getOrders } from '@/lib/localStore';
import InventoryClient from '@/components/InventoryClient';

// Always fetch fresh data from Smartsheet on each request, then merge in
// local-only quantities/status (syncing in any brand-new items).
export const dynamic = 'force-dynamic';

// An item's displayed Status is never set manually — it's "Ordered" while it
// has an order placed but not yet fully received, otherwise OK/Low from
// current stock vs minimum (see lib/inventory.js's deriveItemStatus).
const PENDING_ORDER_STATUSES = new Set(['Ordered', 'Partially Received']);

export default async function Page() {
  let items = [];
  let error = null;
  try {
    const { items: sheetItems } = await getInventory();
    const merged = await mergeAndSync(sheetItems);
    const orders = await getOrders();
    const pendingRowIds = new Set(
      orders
        .filter((o) => PENDING_ORDER_STATUSES.has(o.status))
        .map((o) => o.rowId)
    );
    items = merged.map((item) => ({
      ...item,
      hasPendingOrder: pendingRowIds.has(String(item.rowId)),
    }));
  } catch (err) {
    error = err.message;
  }

  return (
    <main className="container">
      <header className="app-header">
        <h1>Supply Inventory &amp; Purchasing Status</h1>
        <p className="subtitle">UHD IT PMO · S755 · S821 · TLS</p>
        <p className="subtitle">
          <Link href="/transfers">View transfer history →</Link>
          {' · '}
          <Link href="/orders">View order history →</Link>
          {' · '}
          <Link href="/receiving-log">View receiving log →</Link>
        </p>
      </header>

      {error ? (
        <div className="error-box">
          <strong>Couldn’t load Smartsheet data.</strong>
          <p>{error}</p>
          <p className="hint">
            Check <code>SMARTSHEET_API_TOKEN</code> and <code>SMARTSHEET_SHEET_ID</code>, and confirm your
            column names match <code>lib/config.js</code>.
          </p>
        </div>
      ) : (
        <InventoryClient initialItems={items} />
      )}
    </main>
  );
}
