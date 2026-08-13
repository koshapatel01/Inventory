import Link from 'next/link';
import { getOrders } from '@/lib/localStore';
import OrdersClient from '@/components/OrdersClient';

// Local-only order history — never touches Smartsheet.
export const dynamic = 'force-dynamic';

export default function OrdersPage({ searchParams }) {
  const rowId = searchParams?.rowId;
  const orders = getOrders(rowId ? { rowId } : {});
  const itemName = rowId && orders[0] ? orders[0].itemName : null;

  return (
    <main className="container">
      <header className="app-header">
        <h1>Order History{itemName ? ` — ${itemName}` : ''}</h1>
        <p className="subtitle">
          <Link href="/">← Back to inventory</Link>
          {' · '}
          <Link href="/orders/upload">Upload Invoice / PO →</Link>
          {rowId && <> · <Link href="/orders">Show all items</Link></>}
        </p>
      </header>

      <OrdersClient initialOrders={orders} />
    </main>
  );
}
