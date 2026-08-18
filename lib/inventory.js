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
      if (field) {
        item[field] = cell.value ?? null;
        // The Item Number cell often carries a hyperlink to the vendor's
        // product page in Smartsheet — surface it so order forms can prefill it.
        if (field === 'sku' && cell.hyperlink?.url) item.orderLink = cell.hyperlink.url;
      }
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
 * True when an item's total quantity (across all locations) is below its
 * minimum (reorder point) — exactly at the minimum still counts as OK, since
 * that's the level stock is supposed to be kept at, not a shortfall. Blank/
 * missing minimum is treated as "unknown" and is NOT flagged low (note:
 * Number('') === 0, so we must reject empty values before coercing).
 */
export function isLowStock(item) {
  const m = item.minimum;
  const missing = (v) => v === null || v === undefined || v === '';
  if (missing(m)) return false;
  const min = Number(m);
  if (Number.isNaN(min)) return false;
  return totalQuantity(item) < min;
}

/**
 * Derives an item's display status — never manually set. While it has an
 * order that's been placed but not yet fully received, it reads "Ordered"
 * regardless of current stock; otherwise it reflects live stock vs minimum.
 */
export function deriveItemStatus(item, hasPendingOrder) {
  if (hasPendingOrder) return 'Ordered';
  return isLowStock(item) ? 'Low' : 'OK';
}

/** True when `quantity` is a positive number no greater than what's available. */
export function canTransfer(available, quantity) {
  const avail = Number(available);
  const qty = Number(quantity);
  if (!Number.isFinite(qty) || qty <= 0) return false;
  if (!Number.isFinite(avail)) return false;
  return qty <= avail;
}

/** quantity × unitPrice, 0 if either isn't a finite number. */
export function computeEstimatedTotal(quantity, unitPrice) {
  const qty = Number(quantity);
  const price = Number(unitPrice);
  if (!Number.isFinite(qty) || !Number.isFinite(price)) return 0;
  return qty * price;
}

/** Derives an order's status from how much of it has been received so far. */
export function deriveOrderStatus(quantityOrdered, quantityReceived) {
  const received = Number(quantityReceived) || 0;
  if (received <= 0) return 'Ordered';
  const ordered = Number(quantityOrdered) || 0;
  return received >= ordered ? 'Received' : 'Partially Received';
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
