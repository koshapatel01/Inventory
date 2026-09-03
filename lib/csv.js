// Pure CSV building for the "Export to Excel" buttons on each log. No DOM or
// framework code here, so it's unit tested directly (see scripts/verify.mjs).
//
// CSV rather than a real .xlsx binary: Excel opens it natively, and it keeps
// the app dependency-free (an xlsx writer is a heavy dependency for what is
// ultimately a flat table). See toCsvBlobParts for the BOM that makes Excel
// read it as UTF-8 rather than mangling accented characters and symbols.

/**
 * Escape one CSV field. Anything containing a quote, comma, or newline gets
 * wrapped in quotes with its own quotes doubled, per RFC 4180 — otherwise a
 * value like an item name with a comma in it would silently split into two
 * columns when opened.
 */
export function escapeCsvValue(value) {
  if (value === null || value === undefined) return '';
  const s = String(value);
  if (/[",\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

/**
 * Build a CSV string from `columns` ([{ key, label }]) and `rows` (objects).
 * A column may supply `value(row)` to derive/format a field that isn't a
 * plain property.
 */
export function toCsv(columns, rows) {
  const header = columns.map((c) => escapeCsvValue(c.label ?? c.key)).join(',');
  const body = rows.map((row) =>
    columns.map((c) => escapeCsvValue(c.value ? c.value(row) : row[c.key])).join(',')
  );
  return [header, ...body].join('\r\n');
}

/**
 * A filename-safe, dated name like "order-history-2026-08-19.csv" so repeated
 * exports don't overwrite each other in the downloads folder.
 */
export function csvFilename(base, date = new Date()) {
  const stamp = date.toISOString().slice(0, 10);
  const safe = String(base).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return `${safe}-${stamp}.csv`;
}

// Excel assumes the system codepage unless a UTF-8 byte-order mark leads the
// file, which turns names like "Lemon & Ginger Tea" or a "×" into mojibake.
export const UTF8_BOM = '﻿';
