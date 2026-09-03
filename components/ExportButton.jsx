'use client';

import { toCsv, csvFilename, UTF8_BOM } from '@/lib/csv';

/**
 * "Export to Excel" button for a log table. Builds the file in the browser
 * from data the page already has — no round trip, and nothing extra kept
 * server-side.
 *
 * `columns` is [{ key, label, value? }] (see lib/csv.js) and should include
 * every field worth having in a spreadsheet, not just the ones the compact
 * on-screen table shows.
 */
export default function ExportButton({ columns, rows, filename, label = 'Export to Excel' }) {
  const count = rows?.length || 0;

  function download() {
    if (!count) return;
    const csv = UTF8_BOM + toCsv(columns, rows);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = csvFilename(filename);
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    // Revoking immediately can cancel the download in some browsers, so let
    // the click be processed first.
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  return (
    <button
      type="button"
      className="export-btn"
      onClick={download}
      disabled={!count}
      title={count ? `Download all ${count} row${count === 1 ? '' : 's'} as a spreadsheet` : 'Nothing to export yet'}
    >
      ⤓ {label}
      {count > 0 && <span className="export-count">{count}</span>}
    </button>
  );
}
