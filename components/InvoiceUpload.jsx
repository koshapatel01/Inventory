'use client';

import { useState } from 'react';
import { STAFF, VENDORS } from '@/lib/config';
import { computeEstimatedTotal } from '@/lib/inventory';

function defaultVendorFor(line, parsedVendor) {
  if (line.catalogVendor && VENDORS.includes(line.catalogVendor)) return line.catalogVendor;
  if (parsedVendor && VENDORS.includes(parsedVendor)) return parsedVendor;
  return '';
}

export default function InvoiceUpload() {
  const [file, setFile] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState(null);
  const [invoice, setInvoice] = useState(null);
  const [rows, setRows] = useState([]);
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
    setRawTextPreview('');
    try {
      const form = new FormData();
      form.append('file', file);
      const res = await fetch('/api/invoices', { method: 'POST', body: form });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Upload failed');
      setInvoice(data.invoice);
      setRawTextPreview(data.rawTextPreview || '');
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

  const checkedCount = rows.filter((r) => r.matched && r.checked && !r.result).length;

  async function createOrders() {
    if (!orderedBy || checkedCount === 0) return;
    setSubmitting(true);
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      if (!row.matched || !row.checked || row.result) continue;
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
        const res = await fetch('/api/orders', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            rowId: row.rowId,
            itemName: row.itemName,
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
                {rows.map((row, i) => (
                  <tr key={i} className={!row.matched ? 'row-low' : ''}>
                    <td>
                      {row.matched && (
                        <input
                          type="checkbox"
                          checked={row.checked}
                          disabled={!!row.result}
                          onChange={(e) => updateRow(i, { checked: e.target.checked })}
                        />
                      )}
                    </td>
                    <td className="mono">{row.sku}</td>
                    <td>
                      {row.matched ? row.itemName : (
                        <span title={row.description}>No matching item — SKU not in catalog</span>
                      )}
                    </td>
                    <td>
                      {row.matched ? (
                        <select
                          value={row.vendor}
                          disabled={!!row.result}
                          onChange={(e) => updateRow(i, { vendor: e.target.value })}
                        >
                          <option value="">Vendor?</option>
                          {VENDORS.map((v) => <option key={v} value={v}>{v}</option>)}
                        </select>
                      ) : '—'}
                    </td>
                    <td className="num">
                      {row.matched ? (
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
                      {row.matched ? (
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
                      {row.matched ? (
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
                        : row.matched ? '' : 'Skipped'}
                    </td>
                  </tr>
                ))}
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
