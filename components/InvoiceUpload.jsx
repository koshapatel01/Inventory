'use client';

import { useState } from 'react';
import { STAFF, VENDORS } from '@/lib/config';
import { computeEstimatedTotal } from '@/lib/inventory';

// The vendor on every parsed line should always match the vendor detected
// for the invoice as a whole — a single PDF only ever comes from one vendor,
// so there's no legitimate case for a line to differ from it. Only falls
// back to the catalog item's own vendor when the invoice's vendor couldn't
// be detected at all.
function defaultVendorFor(line, parsedVendor) {
  if (parsedVendor && VENDORS.includes(parsedVendor)) return parsedVendor;
  if (line.catalogVendor && VENDORS.includes(line.catalogVendor)) return line.catalogVendor;
  return '';
}

// A row is ready to be selected/ordered once it's either matched to an
// existing catalog item, or the user has typed a name for a brand-new one
// (see applyCatalogMatch / the manual-name input in the Item column).
function isRowReady(row) {
  return row.matched || Boolean(row.manualItemName && row.manualItemName.trim());
}

export default function InvoiceUpload() {
  const [file, setFile] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState(null);
  const [invoice, setInvoice] = useState(null);
  const [rows, setRows] = useState([]);
  const [catalog, setCatalog] = useState([]);
  const [invoiceTotal, setInvoiceTotal] = useState(null);
  const [rawTextPreview, setRawTextPreview] = useState('');
  const [orderedBy, setOrderedBy] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function upload(e) {
    e.preventDefault();
    if (!file) return;
    setUploading(true);
    setUploadError(null);
    setInvoice(null);
    setRows([]);
    setCatalog([]);
    setInvoiceTotal(null);
    setRawTextPreview('');
    try {
      const form = new FormData();
      form.append('file', file);
      const res = await fetch('/api/invoices', { method: 'POST', body: form });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Upload failed');
      setInvoice(data.invoice);
      setRawTextPreview(data.rawTextPreview || '');
      setCatalog(data.catalog || []);
      setInvoiceTotal(typeof data.invoiceTotal === 'number' ? data.invoiceTotal : null);
      setRows(
        data.lines.map((line) => ({
          ...line,
          checked: line.matched,
          quantity: line.quantity,
          unitPrice: line.unitPrice,
          vendor: defaultVendorFor(line, data.invoice.vendor),
          notes: data.invoice.referenceNumber ? `Invoice #${data.invoice.referenceNumber}` : '',
          result: null, // null = not submitted, 'pending' | 'created' | error string
        }))
      );
    } catch (err) {
      setUploadError(err.message);
    } finally {
      setUploading(false);
    }
  }

  function updateRow(index, patch) {
    setRows((prev) => prev.map((r, i) => (i === index ? { ...r, ...patch } : r)));
  }

  // Lets the user override or supply the catalog match by hand — needed for
  // vendors like Amazon that print no SKU, where auto fuzzy-matching by
  // product title sometimes misses or picks the wrong item.
  function applyCatalogMatch(index, rowId) {
    const match = catalog.find((c) => String(c.rowId) === String(rowId));
    setRows((prev) =>
      prev.map((r, i) => {
        if (i !== index) return r;
        if (!match) {
          return { ...r, matched: false, checked: false, rowId: null, itemName: null, minimum: null, catalogVendor: null, orderLink: null };
        }
        return {
          ...r,
          matched: true,
          checked: true,
          sku: match.sku,
          rowId: match.rowId,
          itemName: match.name,
          minimum: match.minimum,
          catalogVendor: match.vendor,
          orderLink: match.orderLink,
          vendor: r.vendor || defaultVendorFor({ catalogVendor: match.vendor }, invoice?.vendor),
        };
      })
    );
  }

  const checkedCount = rows.filter((r) => isRowReady(r) && r.checked && !r.result).length;

  // Sum of every parsed row (matched or not) — comparing this against the
  // invoice's own printed total is what surfaces a parsing gap immediately,
  // instead of the user having to eyeball every row against the PDF.
  const parsedTotal = rows.reduce((sum, r) => sum + computeEstimatedTotal(r.quantity, r.unitPrice), 0);
  const totalsDiffer = invoiceTotal != null && Math.abs(parsedTotal - invoiceTotal) > 0.01;
  const unmatchedCount = rows.filter((r) => !r.matched).length;

  async function createOrders() {
    if (!orderedBy || checkedCount === 0) return;
    setSubmitting(true);
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      if (!isRowReady(row) || !row.checked || row.result) continue;
      if (!Number.isFinite(row.quantity) || row.quantity <= 0) {
        updateRow(i, { result: 'Quantity must be positive.' });
        continue;
      }
      if (!Number.isFinite(row.unitPrice) || row.unitPrice < 0) {
        updateRow(i, { result: 'Unit price must be non-negative.' });
        continue;
      }
      if (!row.vendor) {
        updateRow(i, { result: 'Vendor required.' });
        continue;
      }
      updateRow(i, { result: 'pending' });
      try {
        let rowId = row.rowId;
        let itemName = row.itemName;

        if (!row.matched) {
          // No catalog item exists for this SKU yet — create one now (never
          // touches Smartsheet; see /api/inventory/manual) so the order can
          // be tied to a real inventory row and this item shows up on the
          // main list going forward. The parsed SKU is always kept as-is.
          const manualRes = await fetch('/api/inventory/manual', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sku: row.sku, name: row.manualItemName, vendor: row.vendor }),
          });
          const manualData = await manualRes.json().catch(() => ({}));
          if (!manualRes.ok) throw new Error(manualData.error || 'Could not create item.');
          rowId = manualData.item.rowId;
          itemName = manualData.item.name;
        }

        const res = await fetch('/api/orders', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            rowId,
            itemName,
            itemNumber: row.sku,
            quantity: row.quantity,
            orderedBy,
            vendor: row.vendor,
            link: row.orderLink || '',
            unitPrice: row.unitPrice,
            notes: row.notes,
            invoiceId: invoice.id,
            invoiceFileId: invoice.fileId,
          }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || 'Order failed');
        updateRow(i, { result: 'created' });
      } catch (err) {
        updateRow(i, { result: err.message });
      }
    }
    setSubmitting(false);
  }

  return (
    <section>
      <form className="filters" onSubmit={upload}>
        <label className="grow">
          Invoice / PO PDF
          <input
            type="file"
            accept="application/pdf"
            onChange={(e) => setFile(e.target.files?.[0] || null)}
          />
        </label>
        <button type="submit" className="transfer-btn" disabled={!file || uploading}>
          {uploading ? 'Reading…' : 'Upload & Parse'}
        </button>
      </form>

      {uploadError && <div className="toast toast-error">{uploadError}</div>}

      {invoice && (
        <>
          <div className="chip" style={{ marginBottom: 12 }}>
            Vendor: <strong>{invoice.vendor || 'Unknown'}</strong>
            {invoice.referenceNumber && <> · Ref: <strong>{invoice.referenceNumber}</strong></>}
            {invoice.invoiceDate && <> · Invoice Date: <strong>{invoice.invoiceDate}</strong></>}
          </div>

          {invoiceTotal != null && (
            <div className={`chip ${totalsDiffer ? 'chip-low' : 'chip-ok'}`} style={{ marginBottom: 12 }}>
              Invoice Total: <strong>${invoiceTotal.toFixed(2)}</strong>
              {' · '}Parsed Total: <strong>${parsedTotal.toFixed(2)}</strong>
              {totalsDiffer && (
                <>
                  {' · Off by '}<strong>${Math.abs(invoiceTotal - parsedTotal).toFixed(2)}</strong>
                  {unmatchedCount > 0
                    ? ` — check the ${unmatchedCount} unmatched row${unmatchedCount === 1 ? '' : 's'} below, or the extracted text`
                    : ' — check the extracted text below for a missed line'}
                </>
              )}
              {!totalsDiffer && ' · all line items accounted for'}
            </div>
          )}

          <div className="filters">
            <label>
              Ordered By (applies to all lines)
              <select value={orderedBy} onChange={(e) => setOrderedBy(e.target.value)}>
                <option value="">Who?</option>
                {STAFF.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </label>
          </div>

          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th></th>
                  <th>SKU</th>
                  <th>Item</th>
                  <th>Vendor</th>
                  <th className="num">Qty</th>
                  <th className="num">Unit Price</th>
                  <th className="num">Est. Total</th>
                  <th>Notes</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 && (
                  <tr><td colSpan={9} className="empty">No line items found in this PDF.</td></tr>
                )}
                {rows.map((row, i) => {
                  const ready = isRowReady(row);
                  const needsManualEntry = !row.matched || row.unitPrice === 0;
                  const vendorLocked = invoice.vendor && VENDORS.includes(invoice.vendor);
                  return (
                    <tr key={i} className={!ready ? 'row-low' : ''}>
                      <td>
                        {ready && (
                          <input
                            type="checkbox"
                            checked={row.checked}
                            disabled={!!row.result}
                            onChange={(e) => updateRow(i, { checked: e.target.checked })}
                          />
                        )}
                      </td>
                      <td className="mono">{row.sku || '—'}</td>
                      <td>
                        {needsManualEntry ? (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 200 }}>
                            <input
                              type="text"
                              placeholder="Type item name…"
                              value={row.matched ? '' : (row.manualItemName || '')}
                              disabled={!!row.result || row.matched}
                              onChange={(e) => updateRow(i, { manualItemName: e.target.value })}
                            />
                            <select
                              value={row.matched ? String(row.rowId) : ''}
                              disabled={!!row.result}
                              title={row.description}
                              onChange={(e) => applyCatalogMatch(i, e.target.value)}
                            >
                              <option value="">
                                {row.matched ? '— clear match —' : `— or pick existing item (parsed: "${row.description}") —`}
                              </option>
                              {catalog.map((c) => (
                                <option key={c.rowId} value={c.rowId}>
                                  {c.sku ? `${c.sku} — ${c.name}` : c.name}
                                </option>
                              ))}
                            </select>
                          </div>
                        ) : (
                          <select
                            value={String(row.rowId)}
                            disabled={!!row.result}
                            title={row.description}
                            onChange={(e) => applyCatalogMatch(i, e.target.value)}
                          >
                            <option value="">— clear match —</option>
                            {catalog.map((c) => (
                              <option key={c.rowId} value={c.rowId}>
                                {c.sku ? `${c.sku} — ${c.name}` : c.name}
                              </option>
                            ))}
                          </select>
                        )}
                      </td>
                      <td>
                        {ready ? (
                          vendorLocked ? (
                            <span>{row.vendor}</span>
                          ) : (
                            <select
                              value={row.vendor}
                              disabled={!!row.result}
                              onChange={(e) => updateRow(i, { vendor: e.target.value })}
                            >
                              <option value="">Vendor?</option>
                              {VENDORS.map((v) => <option key={v} value={v}>{v}</option>)}
                            </select>
                          )
                        ) : '—'}
                      </td>
                      <td className="num">
                        {ready ? (
                          <input
                            type="number"
                            min="1"
                            className="qty-input"
                            value={row.quantity}
                            disabled={!!row.result}
                            onChange={(e) => updateRow(i, { quantity: Number(e.target.value) })}
                          />
                        ) : row.quantity}
                      </td>
                      <td className="num">
                        {ready ? (
                          <input
                            type="number"
                            min="0"
                            step="0.01"
                            className="qty-input"
                            value={row.unitPrice}
                            disabled={!!row.result}
                            onChange={(e) => updateRow(i, { unitPrice: Number(e.target.value) })}
                          />
                        ) : `$${row.unitPrice.toFixed(2)}`}
                      </td>
                      <td className="num">${computeEstimatedTotal(row.quantity, row.unitPrice).toFixed(2)}</td>
                      <td>
                        {ready ? (
                          <input
                            type="text"
                            value={row.notes}
                            disabled={!!row.result}
                            onChange={(e) => updateRow(i, { notes: e.target.value })}
                          />
                        ) : '—'}
                      </td>
                      <td>
                        {row.result === 'created' ? 'Created ✓'
                          : row.result === 'pending' ? 'Saving…'
                          : row.result ? <span className="toast-error">{row.result}</span>
                          : ready ? '' : 'TBD'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <p className="footnote">
            Nothing here is saved until you click "Create Orders" below — review and edit any line first.
          </p>

          <button
            type="button"
            className="transfer-btn"
            disabled={!orderedBy || checkedCount === 0 || submitting}
            onClick={createOrders}
          >
            {submitting ? 'Creating…' : `Create ${checkedCount} Order${checkedCount === 1 ? '' : 's'}`}
          </button>

          {rawTextPreview && (
            <details style={{ marginTop: 16 }} open={rows.length === 0}>
              <summary style={{ cursor: 'pointer', color: 'var(--muted)', fontSize: 13 }}>
                Extracted text (for troubleshooting)
              </summary>
              <pre
                style={{
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word',
                  fontSize: 12,
                  background: '#fafafa',
                  border: '1px solid var(--line)',
                  borderRadius: 8,
                  padding: 12,
                  marginTop: 8,
                  maxHeight: 300,
                  overflow: 'auto',
                }}
              >
                {rawTextPreview}
              </pre>
            </details>
          )}
        </>
      )}
    </section>
  );
}
