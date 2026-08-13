// Smartsheet REST API client. SERVER-ONLY — this module reads the secret API
// token from environment variables and must never be imported into client code.

import { COLUMN_MAP } from './config.js';
import { rowsToItems } from './inventory.js';
import { getCategoryForItem } from './itemCategories.js';

const BASE = 'https://api.smartsheet.com/2.0';

function getConfig() {
  const token = process.env.SMARTSHEET_API_TOKEN;
  const sheetId = process.env.SMARTSHEET_SHEET_ID;
  if (!token || !sheetId) {
    throw new Error(
      'Missing SMARTSHEET_API_TOKEN or SMARTSHEET_SHEET_ID. Set them in .env.local (local) or Vercel project settings (deployed).'
    );
  }
  return { token, sheetId };
}

async function apiRequest(path, options = {}) {
  const { token } = getConfig();
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

/** Fetch the whole inventory sheet and return flat app items. */
export async function getInventory() {
  const { sheetId } = getConfig();
  const sheet = await apiRequest(`/sheets/${sheetId}`);
  const items = rowsToItems(sheet, COLUMN_MAP).map((item) => ({
    ...item,
    category: item.category ?? getCategoryForItem(item.name),
  }));
  return { items, columns: sheet.columns || [] };
}
