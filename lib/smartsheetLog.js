// Best-effort audit log written to a dedicated Smartsheet — separate from the
// read-only inventory catalog sheet in lib/smartsheet.js, and never touching
// it. This is a mirror of what's already durably recorded in data/store.json
// (the source of truth); if a write here fails for any reason, it's logged
// to the server console and swallowed — it must never block or fail the
// local operation that triggered it. SERVER-ONLY (reads the API token).

import { getLogSheetId, setLogSheetId } from './localStore.js';

const BASE = 'https://api.smartsheet.com/2.0';
const LOG_SHEET_NAME = 'Supply Inventory — Order & Transaction Log';

// `key` maps an event field to its cell; `title` becomes the Smartsheet
// column header. `timestamp` is first and is the sheet's required primary
// column. All columns are TEXT_NUMBER — this is an append-only log, not a
// structured form, so one flexible type per column is enough.
const LOG_COLUMNS = [
  { key: 'timestamp', title: 'Timestamp' },
  { key: 'eventType', title: 'Event Type' },
  { key: 'item', title: 'Item Name' },
  { key: 'itemNumber', title: 'Item Number' },
  { key: 'quantity', title: 'Quantity' },
  { key: 'unitPrice', title: 'Unit Price' },
  { key: 'extendedTotal', title: 'Extended Total' },
  { key: 'vendor', title: 'Vendor' },
  { key: 'source', title: 'Source' },
  { key: 'destination', title: 'Destination' },
  { key: 'person', title: 'Person' },
  { key: 'orderId', title: 'Order ID' },
  { key: 'notes', title: 'Notes' },
];

async function apiRequest(path, options = {}) {
  const token = process.env.SMARTSHEET_API_TOKEN;
  if (!token) throw new Error('Missing SMARTSHEET_API_TOKEN.');
  const res = await fetch(`${BASE}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
    cache: 'no-store',
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Smartsheet API ${res.status}: ${text || res.statusText}`);
  }
  return res.json();
}

// In-memory only (per server process) — cheap to rebuild on restart via one
// extra lookup, and avoids persisting Smartsheet-internal column IDs into
// data/store.json alongside the sheet ID.
let cachedColumnIdByTitle = null;

async function createLogSheet() {
  const body = {
    name: LOG_SHEET_NAME,
    columns: LOG_COLUMNS.map(({ title }, i) => ({
      title,
      type: 'TEXT_NUMBER',
      primary: i === 0,
    })),
  };
  const result = await apiRequest('/sheets', { method: 'POST', body: JSON.stringify(body) });
  cachedColumnIdByTitle = new Map(result.result.columns.map((c) => [c.title, c.id]));
  return result.result.id;
}

async function getOrCreateLogSheetId() {
  const pinned = process.env.SMARTSHEET_LOG_SHEET_ID;
  if (pinned) return pinned;

  const cached = getLogSheetId();
  if (cached) return cached;

  const id = await createLogSheet();
  setLogSheetId(id);
  return id;
}

async function getColumnIdByTitle(sheetId) {
  if (cachedColumnIdByTitle) return cachedColumnIdByTitle;
  const sheet = await apiRequest(`/sheets/${sheetId}?include=columnIds`);
  cachedColumnIdByTitle = new Map(sheet.columns.map((c) => [c.title, c.id]));
  return cachedColumnIdByTitle;
}

/**
 * Append one row to the audit-log sheet, creating the sheet on first use.
 * Never throws — logs and swallows any failure so a Smartsheet-side problem
 * (network, rate limit, revoked token) can never block or fail the local
 * operation that called this.
 */
export async function logEvent(event) {
  try {
    const sheetId = await getOrCreateLogSheetId();
    const columnIdByTitle = await getColumnIdByTitle(sheetId);
    const row = {
      toBottom: true,
      cells: LOG_COLUMNS.map(({ key, title }) => ({
        columnId: columnIdByTitle.get(title),
        value: event[key] ?? '',
      })),
    };

    await apiRequest(`/sheets/${sheetId}/rows`, {
      method: 'POST',
      body: JSON.stringify([row]),
    });
  } catch (err) {
    console.error('[smartsheetLog] failed to log event:', err.message || err);
  }
}
