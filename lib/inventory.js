// Pure, dependency-free inventory helpers.
// These functions contain no network or framework code, so they can be unit
// tested directly under Node (see scripts/verify.mjs).

/** Build a lookup of { columnTitle: columnId } from a Smartsheet sheet payload. */
export function columnIndex(columns = []) {
  const byTitle = {};
  for (const col of columns) byTitle[col.title] = col.id;
  return byTitle;
}

/**
 * Convert a raw Smartsheet sheet payload ({ columns, rows }) into flat app items.
 * Each item is keyed by the app field names from COLUMN_MAP, plus `rowId`.
 */
export function rowsToItems(sheet, columnMap) {
  const columns = sheet.columns || [];
  const idToField = {};
  for (const [field, title] of Object.entries(columnMap)) {
    const col = columns.find((c) => c.title === title);
    if (col) idToField[col.id] = field;
  }
  return (sheet.rows || []).map((row) => {
    const item = { rowId: row.id };
    for (const cell of row.cells || []) {
      const field = idToField[cell.columnId];
      if (field) item[field] = cell.value ?? null;
    }
    return item;
  });
}

/** Sum of an item's quantities across S755/S821/TLS. Missing/non-numeric values count as 0. */
export function totalQuantity(item) {
  return ['qtyS755', 'qtyS821', 'qtyTls'].reduce((sum, field) => {
    const v = Number(item[field]);
    return sum + (Number.isFinite(v) ? v : 0);
  }, 0);
}

/**
 * True when an item's total quantity (across all locations) is at or below its
 * minimum (reorder point). Blank/missing minimum is treated as "unknown" and is
 * NOT flagged low (note: Number('') === 0, so we must reject empty values before coercing).
 */
export function isLowStock(item) {
  const m = item.minimum;
  const missing = (v) => v === null || v === undefined || v === '';
  if (missing(m)) return false;
  const min = Number(m);
  if (Number.isNaN(min)) return false;
  return totalQuantity(item) <= min;
}

/** True when `quantity` is a positive number no greater than what's available. */
export function canTransfer(available, quantity) {
  const avail = Number(available);
  const qty = Number(quantity);
  if (!Number.isFinite(qty) || qty <= 0) return false;
  if (!Number.isFinite(avail)) return false;
  return qty <= avail;
}

/** Filter items by category, free-text query, and low-stock-only. */
export function filterItems(items, filters = {}) {
  const { category = 'all', query = '', lowOnly = false } = filters;
  const q = String(query).trim().toLowerCase();
  return items.filter((item) => {
    if (category !== 'all' && item.category !== category) return false;
    if (lowOnly && !isLowStock(item)) return false;
    if (q) {
      const hay = `${item.sku ?? ''} ${item.name ?? ''}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

/**
 * Build a Smartsheet `cells[]` payload from a field patch (e.g. { quantity: 7 }),
 * mapping app field names -> column titles -> column ids. Unknown fields are skipped.
 */
export function fieldsToCells(patch, columnMap, titleToId) {
  const cells = [];
  for (const [field, value] of Object.entries(patch)) {
    const title = columnMap[field];
    const columnId = title && titleToId[title];
    if (columnId) cells.push({ columnId, value });
  }
  return cells;
}

/** Roll up counts for the dashboard header. */
export function summarize(items) {
  const total = items.length;
  const low = items.filter(isLowStock).length;
  return { total, low, ok: total - low };
}
