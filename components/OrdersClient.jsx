'use client';

import { useState } from 'react';
import { deriveOrderStatus } from '@/lib/inventory';

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

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Order Date</th>
              <th>Item</th>
              <th>Item #</th>
              <th>Vendor</th>
              <th className="num">Qty Ordered</th>
              <th className="num">Qty Received</th>
              <th className="num">Unit Price</th>
              <th className="num">Est. Total</th>
              <th>Status</th>
              <th>Ordered By</th>
              <th>Link</th>
              <th>Date Received</th>
              <th>Notes</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {orders.length === 0 && (
              <tr><td colSpan={14} className="empty">No orders recorded yet.</td></tr>
            )}
            {orders.map((order) => {
              const busy = busyId === order.id;
              const canAct = order.status === 'Ordered' || order.status === 'Partially Received';
              return (
                <tr key={order.id}>
                  <td>{order.orderDate}</td>
                  <td>{order.itemName}</td>
                  <td className="mono">{order.itemNumber}</td>
                  <td>{order.vendor}</td>
                  <td className="num">{order.quantityOrdered}</td>
                  <td className="num">{order.quantityReceived}</td>
                  <td className="num">{order.unitPrice.toFixed(2)}</td>
                  <td className="num">{order.estimatedTotal.toFixed(2)}</td>
                  <td>{order.status}</td>
                  <td>{order.orderedBy}</td>
                  <td>
                    {order.link && (
                      <a href={order.link} target="_blank" rel="noreferrer">Link</a>
                    )}
                    {order.link && order.invoiceFileId && ' · '}
                    {order.invoiceFileId && (
                      <a href={`/api/invoices/${order.invoiceFileId}`} target="_blank" rel="noreferrer">
                        View Invoice
                      </a>
                    )}
                    {!order.link && !order.invoiceFileId && '—'}
                  </td>
                  <td>{order.dateReceived || '—'}</td>
                  <td className="notes">{order.notes}</td>
                  <td>
                    {canAct ? (
                      receivingId === order.id ? (
                        <ReceiveForm
                          order={order}
                          busy={busy}
                          onCancel={() => setReceivingId(null)}
                          onSubmit={(payload) => receive(order, payload)}
                        />
                      ) : (
                        <div className="transfer-form">
                          <button
                            type="button"
                            className="transfer-btn"
                            disabled={busy}
                            onClick={() => setReceivingId(order.id)}
                          >
                            Receive
                          </button>
                          <button type="button" disabled={busy} onClick={() => cancel(order)}>
                            Cancel Order
                          </button>
                        </div>
                      )
                    ) : (
                      '—'
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function ReceiveForm({ order, busy, onCancel, onSubmit }) {
  const remaining = order.quantityOrdered - order.quantityReceived;
  const [quantity, setQuantity] = useState('');
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [notes, setNotes] = useState('');

  function submit(e) {
    e.preventDefault();
    const qty = Number(quantity);
    if (!Number.isFinite(qty) || qty <= 0) return;
    onSubmit({ quantity: qty, date, notes: notes || undefined });
  }

  return (
    <form className="transfer-form" onSubmit={submit}>
      <input
        type="number"
        min="1"
        max={remaining}
        className="qty-input"
        placeholder={`Qty (≤${remaining})`}
        value={quantity}
        disabled={busy}
        onChange={(e) => setQuantity(e.target.value)}
      />
      <input
        type="date"
        value={date}
        disabled={busy}
        onChange={(e) => setDate(e.target.value)}
      />
      <input
        type="text"
        placeholder="Notes (optional)"
        value={notes}
        disabled={busy}
        onChange={(e) => setNotes(e.target.value)}
      />
      <button type="submit" disabled={busy}>Send</button>
      <button type="button" disabled={busy} onClick={onCancel}>Cancel</button>
    </form>
  );
}
