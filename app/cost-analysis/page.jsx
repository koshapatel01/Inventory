import Link from 'next/link';
import { getInventory } from '@/lib/smartsheet';
import { getOrders, getManualCatalogItems } from '@/lib/localStore';
import { buildSpendRecords } from '@/lib/costAnalysis';
import { CATEGORIES } from '@/lib/config';
import CostAnalysisClient from '@/components/CostAnalysisClient';

// Reads placed orders (local Postgres, source of truth for purchasing spend)
// plus the current catalog (Smartsheet + manual items, for category tagging
// only) fresh on every request — same pattern as app/page.jsx.
export const dynamic = 'force-dynamic';

export default async function CostAnalysisPage() {
  let records = [];
  let items = [];
  let categories = CATEGORIES;
  let error = null;

  try {
    const [orders, { items: sheetItems }, manualItems] = await Promise.all([
      getOrders(),
      getInventory(),
      getManualCatalogItems(),
    ]);

    const categoryByRowId = new Map();
    for (const item of [...sheetItems, ...manualItems]) {
      categoryByRowId.set(String(item.rowId), item.category || 'Uncategorized');
    }

    records = buildSpendRecords(orders, categoryByRowId);

    const seenItems = new Map();
    const seenCategories = new Set(CATEGORIES);
    for (const r of records) {
      const key = String(r.rowId);
      if (!seenItems.has(key)) seenItems.set(key, { rowId: r.rowId, name: r.item, sku: r.itemNumber });
      seenCategories.add(r.category);
    }
    items = [...seenItems.values()].sort((a, b) => (a.name || '').localeCompare(b.name || ''));
    categories = [...seenCategories];
  } catch (err) {
    error = err.message;
  }

  return (
    <main className="container">
      <header className="app-header">
        <h1>Cost Analysis Dashboard</h1>
        <p className="subtitle"><Link href="/">← Back to inventory</Link></p>
      </header>

      {error ? (
        <div className="error-box">
          <strong>Couldn’t load cost analysis data.</strong>
          <p>{error}</p>
          <p className="hint">
            This page needs both the order history database and the Smartsheet catalog (for
            Office/Breakroom classification). Check <code>DATABASE_URL</code>,{' '}
            <code>SMARTSHEET_API_TOKEN</code>, and <code>SMARTSHEET_SHEET_ID</code>.
          </p>
        </div>
      ) : (
        <CostAnalysisClient initialRecords={records} items={items} categories={categories} />
      )}
    </main>
  );
}
