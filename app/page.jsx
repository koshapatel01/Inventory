import Link from 'next/link';
import { getInventory } from '@/lib/smartsheet';
import { mergeAndSync } from '@/lib/localStore';
import InventoryClient from '@/components/InventoryClient';

// Always fetch fresh data from Smartsheet on each request, then merge in
// local-only quantities/status (syncing in any brand-new items).
export const dynamic = 'force-dynamic';

export default async function Page() {
  let items = [];
  let error = null;
  try {
    const { items: sheetItems } = await getInventory();
    items = mergeAndSync(sheetItems);
  } catch (err) {
    error = err.message;
  }

  return (
    <main className="container">
      <header className="app-header">
        <h1>Supply Inventory &amp; Purchasing Status</h1>
        <p className="subtitle">UHD IT PMO · S755 · S821 · TLS</p>
        <p className="subtitle"><Link href="/transfers">View transfer history →</Link></p>
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
