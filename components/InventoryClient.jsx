'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { CATEGORIES, STAFF, TRANSFER_DESTINATIONS, VENDORS } from '@/lib/config';
import { filterItems, isLowStock, totalQuantity, summarize, deriveItemStatus } from '@/lib/inventory';

const LOCATION_QTY_FIELDS = [
  { field: 'qtyS755', label: 'Qty S755' },
  { field: 'qtyS821', label: 'Qty S821' },
  { field: 'qtyTls', label: 'Qty TLS' },
];

export default function InventoryClient({ initialItems }) {
  const [items, setItems] = useState(initialItems);
  const [category, setCategory] = useState('all');
  const [query, setQuery] = useState('');
  const [lowOnly, setLowOnly] = useState(false);
  const [savingRow, setSavingRow] = useState(null);
  const [message, setMessage] = useState(null);
  const [transferRow, setTransferRow] = useState(null);
  const [orderRow, setOrderRow] = useState(null);

  const filtered = useMemo(
    () => filterItems(items, { category, query, lowOnly }),
    [items, category, query, lowOnly]
  );
  const stats = useMemo(() => summarize(items), [items]);

  async function saveField(item, field, value) {
    setSavingRow(item.rowId);
    setMessage(null);
    const previous = item[field];
    // Optimistic update so the UI feels instant.
    setItems((prev) =>
      prev.map((it) => (it.rowId === item.rowId ? { ...it, [field]: value } : it))
    );
    try {
      const res = await fetch(`/api/inventory/${item.rowId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ [field]: value }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Save failed');
      }
      setMessage({ type: 'ok', text: `Saved ${item.sku || item.name || 'item'}.` });
    } catch (err) {
      // Roll back the optimistic change on failure.
      setItems((prev) =>
        prev.map((it) => (it.rowId === item.rowId ? { ...it, [field]: previous } : it))
      );
      setMessage({ type: 'error', text: `Could not save: ${err.message}` });
    } finally {
      setSavingRow(null);
    }
  }

  async function submitTransfer(item, { quantity, destination, person }) {
    setSavingRow(item.rowId);
    setMessage(null);
    const destField = destination === 'S821' ? 'qtyS821' : 'qtyTls';
    const previous = { qtyS755: item.qtyS755, [destField]: item[destField] };
    setItems((prev) =>
      prev.map((it) =>
        it.rowId === item.rowId
          ? { ...it, qtyS755: it.qtyS755 - quantity, [destField]: (it[destField] || 0) + quantity }
          : it
      )
    );
    try {
      const res = await fetch('/api/transfers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          rowId: item.rowId,
          itemName: item.name,
          itemNumber: item.sku,
          quantity,
          destination,
          person,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Transfer failed');
      setMessage({ type: 'ok', text: `Transferred ${quantity} × ${item.name} to ${destination}.` });
      setTransferRow(null);
    } catch (err) {
      setItems((prev) =>
        prev.map((it) => (it.rowId === item.rowId ? { ...it, ...previous } : it))
      );
      setMessage({ type: 'error', text: `Could not transfer: ${err.message}` });
    } finally {
      setSavingRow(null);
    }
  }

  async function submitOrder(item, { quantity, vendor, link, unitPrice, orderedBy, notes }) {
    setSavingRow(item.rowId);
    setMessage(null);
    try {
      const res = await fetch('/api/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          rowId: item.rowId,
          itemName: item.name,
          itemNumber: item.sku,
          quantity,
          orderedBy,
          vendor,
          link,
          unitPrice,
          notes,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Order failed');
      setItems((prev) =>
        prev.map((it) => (it.rowId === item.rowId ? { ...it, hasPendingOrder: true } : it))
      );
      setMessage({ type: 'ok', text: `Order placed for ${quantity} × ${item.name} from ${vendor}.` });
      setOrderRow(null);
    } catch (err) {
      setMessage({ type: 'error', text: `Could not place order: ${err.message}` });
    } finally {
      setSavingRow(null);
    }
  }

  return (
    <section>
      <div className="stats">
        <div className="chip">Total: <strong>{stats.total}</strong></div>
        <div className="chip chip-ok">OK: <strong>{stats.ok}</strong></div>
        <div className="chip chip-low">Low: <strong>{stats.low}</strong></div>
      </div>

      <div className="filters">
        <label>
          Category
          <select value={category} onChange={(e) => setCategory(e.target.value)}>
            <option value="all">All</option>
            {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </label>
        <label className="grow">
          Search
          <input
            type="text"
            placeholder="SKU or item name…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
        <label className="checkbox">
          <input type="checkbox" checked={lowOnly} onChange={(e) => setLowOnly(e.target.checked)} />
          Low stock only
        </label>
      </div>

      {message && (
        <div className={message.type === 'ok' ? 'toast toast-ok' : 'toast toast-error'}>
          {message.text}
        </div>
      )}

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>SKU</th>
              <th>Item</th>
              <th>Category</th>
              {LOCATION_QTY_FIELDS.map(({ field, label }) => (
                <th key={field} className="num">{label}</th>
              ))}
              <th className="num">Total</th>
              <th className="num">Min</th>
              <th>Status</th>
              <th>Notes</th>
              <th data-tour="transfer-header">Transfer</th>
              <th data-tour="orders-header">Orders</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && (
              <tr><td colSpan={12} className="empty">No items match your filters.</td></tr>
            )}
            {filtered.map((item) => {
              const low = isLowStock(item);
              const busy = savingRow === item.rowId;
              return (
                <tr key={item.rowId} className={low ? 'row-low' : ''}>
                  <td className="mono">{item.sku}</td>
                  <td>{item.name}</td>
                  <td>{item.category}</td>
                  {LOCATION_QTY_FIELDS.map(({ field }) => (
                    <td className="num" key={field}>
                      <input
                        type="number"
                        className="qty-input"
                        defaultValue={item[field] ?? ''}
                        disabled={busy}
                        onBlur={(e) => {
                          const v = Number(e.target.value);
                          if (!Number.isNaN(v) && v !== Number(item[field])) {
                            saveField(item, field, v);
                          }
                        }}
                      />
                    </td>
                  ))}
                  <td className="num">{totalQuantity(item)}</td>
                  <td className="num">{item.minimum}</td>
                  <td>
                    <StatusBadge status={deriveItemStatus(item, item.hasPendingOrder)} />
                  </td>
                  <td className="notes">{item.notes}</td>
                  <td>
                    {transferRow === item.rowId ? (
                      <TransferForm
                        item={item}
                        busy={busy}
                        onCancel={() => setTransferRow(null)}
                        onSubmit={(payload) => submitTransfer(item, payload)}
                      />
                    ) : (
                      <button
                        type="button"
                        className="transfer-btn"
                        disabled={busy}
                        onClick={() => setTransferRow(item.rowId)}
                      >
                        Transfer
                      </button>
                    )}
                  </td>
                  <td>
                    {orderRow === item.rowId ? (
                      <OrderForm
                        item={item}
                        busy={busy}
                        onCancel={() => setOrderRow(null)}
                        onSubmit={(payload) => submitOrder(item, payload)}
                      />
                    ) : (
                      <div className="transfer-form">
                        <button
                          type="button"
                          className="transfer-btn"
                          disabled={busy}
                          onClick={() => setOrderRow(item.rowId)}
                        >
                          Place Order
                        </button>
                        <Link href={`/orders?rowId=${item.rowId}`}>History</Link>
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <p className="footnote">
        Quantities and transfers are stored locally on this machine — Smartsheet stays a
        read-only catalog and is never written to. Status is automatic: Ordered while a
        placed order hasn’t fully arrived, otherwise OK/Low from current stock vs minimum.
        Low-stock rows are highlighted; the daily email to ITPMO@UHD.EDU is handled by
        Smartsheet’s alert rules.
      </p>
    </section>
  );
}

const STATUS_BADGE_CLASS = { OK: 'status-ok', Low: 'status-low', Ordered: 'status-ordered' };

function StatusBadge({ status }) {
  return <span className={`status-badge ${STATUS_BADGE_CLASS[status] || ''}`}>{status}</span>;
}

function TransferForm({ item, busy, onCancel, onSubmit }) {
  const [quantity, setQuantity] = useState('');
  const [destination, setDestination] = useState(TRANSFER_DESTINATIONS[0]);
  const [person, setPerson] = useState('');

  function submit(e) {
    e.preventDefault();
    const qty = Number(quantity);
    if (!Number.isFinite(qty) || qty <= 0 || !person) return;
    onSubmit({ quantity: qty, destination, person });
  }

  return (
    <form className="transfer-form" onSubmit={submit}>
      <input
        type="number"
        min="1"
        className="qty-input"
        placeholder="Qty"
        value={quantity}
        disabled={busy}
        onChange={(e) => setQuantity(e.target.value)}
      />
      <select value={destination} disabled={busy} onChange={(e) => setDestination(e.target.value)}>
        {TRANSFER_DESTINATIONS.map((d) => <option key={d} value={d}>{d}</option>)}
      </select>
      <select value={person} disabled={busy} onChange={(e) => setPerson(e.target.value)} required>
        <option value="">Who?</option>
        {STAFF.map((s) => <option key={s} value={s}>{s}</option>)}
      </select>
      <button type="submit" disabled={busy}>Send</button>
      <button type="button" disabled={busy} onClick={onCancel}>Cancel</button>
    </form>
  );
}

function OrderForm({ item, busy, onCancel, onSubmit }) {
  // The catalog vendor (from Smartsheet) is the one whose product-page link
  // we already know; switching to a different vendor means that link is no
  // longer valid, so it's cleared and the user is prompted to enter it.
  const catalogVendor = VENDORS.includes(item.vendor) ? item.vendor : '';
  const [quantity, setQuantity] = useState(item.minimum ?? '');
  const [vendor, setVendor] = useState(catalogVendor);
  const [link, setLink] = useState(catalogVendor ? (item.orderLink || '') : '');
  const [unitPrice, setUnitPrice] = useState('');
  const [orderedBy, setOrderedBy] = useState('');
  const [notes, setNotes] = useState('');

  function handleVendorChange(v) {
    setVendor(v);
    setLink(v === catalogVendor ? (item.orderLink || '') : '');
  }

  function submit(e) {
    e.preventDefault();
    const qty = Number(quantity);
    const price = Number(unitPrice);
    if (!Number.isFinite(qty) || qty <= 0) return;
    if (!Number.isFinite(price) || price < 0) return;
    if (!vendor || !orderedBy) return;
    onSubmit({ quantity: qty, vendor, link: link.trim(), unitPrice: price, orderedBy, notes: notes.trim() });
  }

  const needsLink = vendor && vendor !== catalogVendor;

  return (
    <form className="transfer-form order-form" onSubmit={submit}>
      <input
        type="number"
        min="1"
        className="qty-input"
        placeholder="Qty"
        value={quantity}
        disabled={busy}
        onChange={(e) => setQuantity(e.target.value)}
      />
      <select value={vendor} disabled={busy} onChange={(e) => handleVendorChange(e.target.value)} required>
        <option value="">Vendor?</option>
        {VENDORS.map((v) => <option key={v} value={v}>{v}</option>)}
      </select>
      <input
        type="text"
        placeholder={needsLink ? 'Enter link for this vendor' : 'Order link'}
        title={needsLink ? 'This vendor differs from the catalog vendor — enter the order link manually.' : undefined}
        value={link}
        disabled={busy}
        required={needsLink}
        onChange={(e) => setLink(e.target.value)}
      />
      <input
        type="number"
        min="0"
        step="0.01"
        className="qty-input"
        placeholder="Unit $"
        value={unitPrice}
        disabled={busy}
        onChange={(e) => setUnitPrice(e.target.value)}
      />
      <select value={orderedBy} disabled={busy} onChange={(e) => setOrderedBy(e.target.value)} required>
        <option value="">Who?</option>
        {STAFF.map((s) => <option key={s} value={s}>{s}</option>)}
      </select>
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
