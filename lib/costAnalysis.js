// Pure, dependency-free cost-analysis helpers for the Cost Analysis Dashboard
// (see app/cost-analysis/page.jsx). No network or framework code, so these are
// unit tested directly under Node (see scripts/verify.mjs), same as lib/inventory.js.
//
// Only "Order Placed" events count toward purchasing cost and order frequency —
// each row in the `orders` table (see lib/localStore.js's placeOrder) already
// represents exactly one such event, so no separate event-type filtering is
// needed here. Receiving a delivery or transferring stock between locations
// moves existing, already-paid-for stock — counting either would double-count
// the same purchase, so those tables are never read by this module.

/**
 * An order's spend, in dollars: its stored estimatedTotal (quantity × unitPrice,
 * computed once when the order was placed — see lib/inventory.js's
 * computeEstimatedTotal) if present, otherwise recomputed from quantity and
 * unit price directly.
 */
export function extendedTotalFor(order) {
  const total = Number(order.estimatedTotal);
  if (Number.isFinite(total)) return total;
  const qty = Number(order.quantityOrdered) || 0;
  const price = Number(order.unitPrice) || 0;
  return qty * price;
}

/**
 * True when an order has no real unit price on record. Unit price is required
 * (and validated non-negative) everywhere an order can be placed, so this only
 * flags genuine $0 entries — real free promo items and "price wasn't known"
 * both land here, so a flagged record isn't necessarily wrong, just worth a
 * second look before trusting cost totals that include it.
 */
export function isMissingPrice(order) {
  return !Number(order.unitPrice);
}

/** 'YYYY-MM' for an order's date. order.orderDate is always an ISO YYYY-MM-DD
 *  string assigned at order-placement time (see lib/localStore.js's placeOrder),
 *  regardless of what date the source invoice printed. */
export function monthKey(dateStr) {
  return typeof dateStr === 'string' && dateStr.length >= 7 ? dateStr.slice(0, 7) : null;
}

/**
 * Convert placed orders into flat "spend records" for the dashboard, tagging
 * each with its item's current category (Office Supplies / Breakroom Supplies
 * / Manual Add) via categoryByRowId — a { rowId(string) -> category } map
 * built from the live catalog (see app/cost-analysis/page.jsx). An order whose
 * item no longer resolves to a known category (e.g. removed from the catalog
 * after being ordered) is tagged 'Uncategorized' rather than dropped, so its
 * spend still counts toward the overall total.
 */
export function buildSpendRecords(orders, categoryByRowId) {
  return orders.map((order) => ({
    id: order.id,
    date: order.orderDate,
    month: monthKey(order.orderDate),
    rowId: order.rowId,
    item: order.itemName,
    itemNumber: order.itemNumber,
    category: categoryByRowId.get(String(order.rowId)) || 'Uncategorized',
    vendor: order.vendor,
    quantity: Number(order.quantityOrdered) || 0,
    unitPrice: Number(order.unitPrice) || 0,
    extendedTotal: extendedTotalFor(order),
    missingPrice: isMissingPrice(order),
    status: order.status,
  }));
}

/** Apply the dashboard's date-range / category / item filters to spend records. */
export function filterRecords(records, filters = {}) {
  const { from = '', to = '', category = 'all', rowId = 'all' } = filters;
  return records.filter((r) => {
    if (from && (!r.date || r.date < from)) return false;
    if (to && (!r.date || r.date > to)) return false;
    if (category !== 'all' && r.category !== category) return false;
    if (rowId !== 'all' && String(r.rowId) !== String(rowId)) return false;
    return true;
  });
}

/** Total spend, order count, per-category totals, and flagged-record count for a set of records. */
export function summarize(records) {
  const summary = { totalSpend: 0, totalOrders: records.length, flaggedCount: 0, byCategory: {} };
  for (const r of records) {
    summary.totalSpend += r.extendedTotal;
    summary.byCategory[r.category] = (summary.byCategory[r.category] || 0) + r.extendedTotal;
    if (r.missingPrice) summary.flaggedCount += 1;
  }
  return summary;
}

/**
 * Detail metrics for one item's spend records: total spent, total quantity
 * ordered, times ordered, average unit price (spend ÷ quantity — weighted by
 * how much was actually bought on each order, not a plain average of listed
 * prices), and average cost per order (spend ÷ times ordered).
 */
export function summarizeItem(records) {
  const totalSpent = records.reduce((s, r) => s + r.extendedTotal, 0);
  const totalQuantity = records.reduce((s, r) => s + r.quantity, 0);
  const timesOrdered = records.length;
  return {
    totalSpent,
    totalQuantity,
    timesOrdered,
    avgUnitPrice: totalQuantity > 0 ? totalSpent / totalQuantity : 0,
    avgCostPerOrder: timesOrdered > 0 ? totalSpent / timesOrdered : 0,
  };
}

/** Chronological monthly series of spend + order count, for the monthly chart. */
export function buildMonthlySeries(records) {
  const byMonth = new Map();
  for (const r of records) {
    if (!r.month) continue;
    const bucket = byMonth.get(r.month) || { month: r.month, spend: 0, orders: 0 };
    bucket.spend += r.extendedTotal;
    bucket.orders += 1;
    byMonth.set(r.month, bucket);
  }
  return [...byMonth.values()].sort((a, b) => a.month.localeCompare(b.month));
}

/** Category totals (e.g. Office Supplies vs Breakroom Supplies), sorted by spend descending. */
export function buildCategoryTotals(records) {
  const totals = new Map();
  for (const r of records) {
    totals.set(r.category, (totals.get(r.category) || 0) + r.extendedTotal);
  }
  return [...totals.entries()]
    .map(([category, spend]) => ({ category, spend }))
    .sort((a, b) => b.spend - a.spend);
}

/** One row per item, sorted by total spend descending — for the ranked spending table. */
export function rankItemsBySpend(records) {
  const byItem = new Map();
  for (const r of records) {
    const key = String(r.rowId);
    const row = byItem.get(key) || {
      rowId: r.rowId,
      item: r.item,
      itemNumber: r.itemNumber,
      category: r.category,
      totalSpent: 0,
      totalQuantity: 0,
      timesOrdered: 0,
      flaggedCount: 0,
    };
    row.totalSpent += r.extendedTotal;
    row.totalQuantity += r.quantity;
    row.timesOrdered += 1;
    if (r.missingPrice) row.flaggedCount += 1;
    byItem.set(key, row);
  }
  return [...byItem.values()]
    .map((row) => ({ ...row, avgUnitPrice: row.totalQuantity > 0 ? row.totalSpent / row.totalQuantity : 0 }))
    .sort((a, b) => b.totalSpent - a.totalSpent);
}
