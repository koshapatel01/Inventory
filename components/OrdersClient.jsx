'use client';

import { useState } from 'react';
import { deriveOrderStatus } from '@/lib/inventory';
import ExportButton from '@/components/ExportButton';

// Every column the table renders, so the receive-form row beneath an order can
// span the full width without this count drifting out of sync.
const COLUMN_COUNT = 9;

// The export carries every field, including ones the compact on-screen table
// folds together (or leaves out entirely, like the invoice link) — a
// spreadsheet has room the screen doesn't.
const EXPORT_COLUMNS = [
  { key: 'orderDate', label: 'Order Date' },
  { key: 'itemName', label: 'Item' },
  { key: 'itemNumber', label: 'Item #' },
  { key: 'vendor', label: 'Vendor' },
  { key: 'quantityOrdered', label: 'Qty Ordered' },
  { key: 'quantityReceived', label: 'Qty Received' },
  { key: 'unitPrice', label: 'Unit Price', value: (o) => Number(o.unitPrice || 0).toFixed(2) },
  { key: 'estimatedTotal', label: 'Est. Total', value: (o) => Number(o.estimatedTotal || 0).toFixed(2) },
  { key: 'status', label: 'Status' },
  { key: 'orderedBy', label: 'Ordered By' },
  { key: 'dateReceived', label: 'Date Received' },
  { key: 'notes', label: 'Notes' },
  { key: 'link', label: 'Order Link' },
  {
    key: 'invoiceFileId',
    label: 'Invoice',
    value: (o) => (o.invoiceFileId ? `/api/invoices/${o.invoiceFileId}` : ''),
  },
];

export default function OrdersClient({ initialOrders }) {
  const [orders, setOrders] = useState(initialOrders);
  const [busyId, setBusyId] = useState(null);
  const [receivingId, setReceivingId] = useState(null);
  const [message, setMessage] = useState(null);

  async function receive(order, { quantity, date, notes }) {
    setBusyId(order.id);
    setMessage(null);
    const previous = { ...order };
    const optimisticReceived = order.quantityReceived + quantity;
    setOrders((prev) =>
      prev.map((o) =>
        o.id === order.id
          ? {
              ...o,
              quantityReceived: optimisticReceived,
              dateReceived: date,
              status: deriveOrderStatus(o.quantityOrdered, optimisticReceived),
            }
          : o
      )
    );
    try {
      const res = await fetch(`/api/orders/${order.id}/receive`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ quantity, date, notes }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Receive failed');
      setOrders((prev) => prev.map((o) => (o.id === order.id ? data.order : o)));
      setMessage({ type: 'ok', text: `Received ${quantity} × ${order.itemName}.` });
      setReceivingId(null);
    } catch (err) {
      setOrders((prev) => prev.map((o) => (o.id === order.id ? previous : o)));
      setMessage({ type: 'error', text: `Could not receive: ${err.message}` });
    } finally {
      setBusyId(null);
    }
  }

  async function cancel(order) {
    if (!window.confirm(`Cancel the order for ${order.itemName}?`)) return;
    setBusyId(order.id);
    setMessage(null);
    const previous = { ...order };
    setOrders((prev) => prev.map((o) => (o.id === order.id ? { ...o, status: 'Cancelled' } : o)));
    try {
      const res = await fetch(`/api/orders/${order.id}/cancel`, { method: 'POST' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Cancel failed');
      setMessage({ type: 'ok', text: `Cancelled order for ${order.itemName}.` });
    } catch (err) {
      setOrders((prev) => prev.map((o) => (o.id === order.id ? previous : o)));
      setMessage({ type: 'error', text: `Could not cancel: ${err.message}` });
    } finally {
      setBusyId(null);
    }
  }

  return (
    <section>
      {message && (
        <div className={message.type === 'ok' ? 'toast toast-ok' : 'toast toast-error'}>
          {message.text}
        </div>
      )}

      <div className="log-toolbar">
        <span className="log-count">{orders.length} order{orders.length === 1 ? '' : 's'}</span>
        <ExportButton columns={EXPORT_COLUMNS} rows={orders} filename="order-history" />
      </div>

      <div className="table-wrap">
        <table className="log-table">
          <thead>
            <tr>
              <th>Date</th>
              <th>Item</th>
              <th>Vendor</th>
              <th className="num">Qty</th>
              <th className="num">Unit</th>
              <th className="num">Total</th>
              <th>Status</th>
              <th>Notes</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {orders.length === 0 && (
              <tr><td colSpan={COLUMN_COUNT} className="empty">No orders recorded yet.</td></tr>
            )}
            {orders.map((order) => {
              const busy = busyId === order.id;
              const canAct = order.status === 'Ordered' || order.status === 'Partially Received';
              const isReceiving = receivingId === order.id;
              const fullyReceived = order.quantityReceived >= order.quantityOrdered;
              return [
                <tr key={order.id}>
                  {/* Ordered and received dates share a cell — they're the same
                      fact (when this order moved) and rarely both needed at a glance. */}
                  <td className="cell-stack">
                    <span>{order.orderDate}</span>
                    {order.dateReceived && (
                      <span className="cell-sub">recv {order.dateReceived}</span>
                    )}
                  </td>
                  <td className="cell-item">
                    <span className="item-name">{order.itemName}</span>
                    <span className="item-meta">
                      <span className="mono">{order.itemNumber}</span>
                      {order.link && <> · <a href={order.link} target="_blank" rel="noreferrer">Link</a></>}
                      {order.invoiceFileId && (
                        <> · <a href={`/api/invoices/${order.invoiceFileId}`} target="_blank" rel="noreferrer">Invoice</a></>
                      )}
                    </span>
                  </td>
                  <td className="cell-stack">
                    <span>{order.vendor}</span>
                    <span className="cell-sub">by {order.orderedBy}</span>
                  </td>
                  <td className="num">
                    <span className={fullyReceived ? '' : 'qty-partial'}>
                      {order.quantityReceived}/{order.quantityOrdered}
                    </span>
                  </td>
                  <td className="num">{order.unitPrice.toFixed(2)}</td>
                  <td className="num">{order.estimatedTotal.toFixed(2)}</td>
                  <td><OrderStatusBadge status={order.status} /></td>
                  <td className="notes">{order.notes}</td>
                  <td>
                    {canAct ? (
                      <div className="row-actions">
                        <button
                          type="button"
                          className={`transfer-btn${isReceiving ? ' is-active' : ''}`}
                          disabled={busy}
                          onClick={() => setReceivingId(isReceiving ? null : order.id)}
                        >
                          Receive
                        </button>
                        <button
                          type="button"
                          className="transfer-btn"
                          disabled={busy}
                          onClick={() => cancel(order)}
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      '—'
                    )}
                  </td>
                </tr>,
                // Same approach as the inventory table: the receive form opens
                // full-width beneath its order instead of inside a narrow
                // cell, so the table never has to grow wide enough to scroll.
                isReceiving && (
                  <tr key={`${order.id}-form`} className="form-row">
                    <td colSpan={COLUMN_COUNT}>
                      <ReceiveForm
                        order={order}
                        busy={busy}
                        onCancel={() => setReceivingId(null)}
                        onSubmit={(payload) => receive(order, payload)}
                      />
                    </td>
                  </tr>
                ),
              ];
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

const ORDER_STATUS_CLASS = {
  Received: 'status-ok',
  Ordered: 'status-ordered',
  'Partially Received': 'status-ordered',
  Cancelled: 'status-low',
};

function OrderStatusBadge({ status }) {
  return <span className={`status-badge ${ORDER_STATUS_CLASS[status] || ''}`}>{status}</span>;
}

function ReceiveForm({ order, busy, onCancel, onSubmit }) {
  const remaining = order.quantityOrdered - order.quantityReceived;
  const [quantity, setQuantity] = useState(String(remaining));
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [notes, setNotes] = useState('');

  function submit(e) {
    e.preventDefault();
    const qty = Number(quantity);
    if (!Number.isFinite(qty) || qty <= 0) return;
    onSubmit({ quantity: qty, date, notes: notes || undefined });
  }

  return (
    <form onSubmit={submit}>
      <div className="inline-form">
        <div className="inline-form-head">
          <strong>Receive delivery</strong>
          <span className="inline-form-item">
            {order.itemName} · {remaining} of {order.quantityOrdered} still outstanding
          </span>
        </div>
        <div className="inline-form-fields">
          <label>
            Quantity received
            <input
              type="number"
              min="1"
              max={remaining}
              value={quantity}
              disabled={busy}
              onChange={(e) => setQuantity(e.target.value)}
            />
          </label>
          <label>
            Date received
            <input type="date" value={date} disabled={busy} onChange={(e) => setDate(e.target.value)} />
          </label>
          <label className="grow">
            Notes (optional)
            <input type="text" value={notes} disabled={busy} onChange={(e) => setNotes(e.target.value)} />
          </label>
        </div>
        <div className="inline-form-actions">
          <button type="submit" disabled={busy}>{busy ? 'Saving…' : 'Log Delivery'}</button>
          <button type="button" disabled={busy} onClick={onCancel}>Cancel</button>
        </div>
      </div>
    </form>
  );
}
