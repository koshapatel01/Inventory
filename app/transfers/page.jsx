import Link from 'next/link';
import { getTransfers } from '@/lib/localStore';
import ExportButton from '@/components/ExportButton';

// Local-only transfer log — never touches Smartsheet.
export const dynamic = 'force-dynamic';

const EXPORT_COLUMNS = [
  { key: 'date', label: 'Date' },
  { key: 'item', label: 'Item' },
  { key: 'itemNumber', label: 'SKU' },
  { key: 'quantity', label: 'Qty' },
  { key: 'source', label: 'From' },
  { key: 'destination', label: 'To' },
  { key: 'person', label: 'Person' },
];

export default async function TransfersPage() {
  const transfers = await getTransfers();

  return (
    <main className="container">
      <header className="app-header">
        <h1>Transfer History</h1>
        <p className="subtitle"><Link href="/">← Back to inventory</Link></p>
      </header>

      <div className="log-toolbar">
        <span className="log-count">{transfers.length} transfer{transfers.length === 1 ? '' : 's'}</span>
        <ExportButton columns={EXPORT_COLUMNS} rows={transfers} filename="transfer-history" />
      </div>

      <div className="table-wrap">
        <table className="log-table">
          <thead>
            <tr>
              <th>Date</th>
              <th>Item</th>
              <th className="num">Qty</th>
              <th>From</th>
              <th>To</th>
              <th>Person</th>
            </tr>
          </thead>
          <tbody>
            {transfers.length === 0 && (
              <tr><td colSpan={6} className="empty">No transfers recorded yet.</td></tr>
            )}
            {transfers.map((t) => (
              <tr key={t.id}>
                <td>{t.date}</td>
                <td className="cell-item">
                  <span className="item-name">{t.item}</span>
                  <span className="item-meta"><span className="mono">{t.itemNumber}</span></span>
                </td>
                <td className="num">{t.quantity}</td>
                <td>{t.source}</td>
                <td>{t.destination}</td>
                <td>{t.person}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </main>
  );
}
