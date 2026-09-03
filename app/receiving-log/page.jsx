import Link from 'next/link';
import { getTransactions } from '@/lib/localStore';
import ExportButton from '@/components/ExportButton';

// Local-only receiving log (deliveries logged against orders) — never touches Smartsheet.
export const dynamic = 'force-dynamic';

const EXPORT_COLUMNS = [
  { key: 'date', label: 'Date' },
  { key: 'type', label: 'Type' },
  { key: 'item', label: 'Item' },
  { key: 'quantity', label: 'Qty' },
  { key: 'source', label: 'From' },
  { key: 'destination', label: 'To' },
  { key: 'person', label: 'Person' },
  { key: 'orderId', label: 'Order ID' },
];

export default async function ReceivingLogPage() {
  const transactions = await getTransactions();

  return (
    <main className="container">
      <header className="app-header">
        <h1>Receiving Log</h1>
        <p className="subtitle"><Link href="/">← Back to inventory</Link></p>
      </header>

      <div className="log-toolbar">
        <span className="log-count">
          {transactions.length} deliver{transactions.length === 1 ? 'y' : 'ies'}
        </span>
        <ExportButton columns={EXPORT_COLUMNS} rows={transactions} filename="receiving-log" />
      </div>

      <div className="table-wrap">
        <table className="log-table">
          <thead>
            <tr>
              <th>Date</th>
              <th>Type</th>
              <th>Item</th>
              <th className="num">Qty</th>
              <th>From</th>
              <th>To</th>
              <th>Person</th>
            </tr>
          </thead>
          <tbody>
            {transactions.length === 0 && (
              <tr><td colSpan={7} className="empty">No deliveries recorded yet.</td></tr>
            )}
            {transactions.map((t) => (
              <tr key={t.id}>
                <td>{t.date}</td>
                <td>{t.type}</td>
                <td>{t.item}</td>
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
