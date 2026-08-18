import Link from 'next/link';
import { getTransfers } from '@/lib/localStore';

// Local-only transfer log — never touches Smartsheet.
export const dynamic = 'force-dynamic';

export default async function TransfersPage() {
  const transfers = await getTransfers();

  return (
    <main className="container">
      <header className="app-header">
        <h1>Transfer History</h1>
        <p className="subtitle"><Link href="/">← Back to inventory</Link></p>
      </header>

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Date</th>
              <th>Item</th>
              <th>SKU</th>
              <th className="num">Qty</th>
              <th>From</th>
              <th>To</th>
              <th>Person</th>
            </tr>
          </thead>
          <tbody>
            {transfers.length === 0 && (
              <tr><td colSpan={7} className="empty">No transfers recorded yet.</td></tr>
            )}
            {transfers.map((t) => (
              <tr key={t.id}>
                <td>{t.date}</td>
                <td>{t.item}</td>
                <td className="mono">{t.itemNumber}</td>
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
