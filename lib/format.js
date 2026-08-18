// Shared display-formatting helpers, usable from both server and client
// components. No network or framework code.

const currencyFormatter = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
const numberFormatter = new Intl.NumberFormat('en-US');

export function formatCurrency(value) {
  const n = Number(value);
  return currencyFormatter.format(Number.isFinite(n) ? n : 0);
}

export function formatNumber(value) {
  const n = Number(value);
  return numberFormatter.format(Number.isFinite(n) ? n : 0);
}

/** 'YYYY-MM' -> 'Mon YYYY' (e.g. '2026-08' -> 'Aug 2026'), for chart axis labels. */
export function formatMonth(monthKey) {
  if (!monthKey) return '';
  const [year, month] = monthKey.split('-');
  const date = new Date(Number(year), Number(month) - 1, 1);
  return date.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
}
