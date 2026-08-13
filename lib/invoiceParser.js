// Pure text-parsing logic for vendor invoices/POs. Takes the flat text a PDF
// text-extractor produces and reconstructs line items well enough for a
// human to review and correct. No fs/network here — testable directly (see
// scripts/verify.mjs).
//
// Important quirk this has to work around: PDF text extractors (pdf-parse
// included) generally only insert a line break when the vertical position of
// text changes — text runs that sit side-by-side in the same table row (SKU
// cell, description cell, qty cell, price cell...) often get concatenated
// with NO separator at all, e.g. "1TWG09180Twinings of London...25/Box1Box
// $8.21$8.21". That breaks any matching that relies on word-boundary (`\b`)
// separation between cells, so none of the logic below assumes cell
// boundaries are whitespace — only the `$`-prefixed price pattern and a
// digit/letter transition are used as anchors, since those survive gluing.

// Fallback pattern used only when no catalog SKU list is supplied. Real Item
// Numbers vary wildly (see GENERIC_SKU_PATTERN note below), so matching
// against the actual catalog (see parseInvoiceText's `knownSkus` param) is
// far more reliable and is the primary strategy in this app.
const GENERIC_SKU_PATTERN = /\b[A-Z0-9]{2,6}\d[A-Z0-9]{2,10}\b/g;
const MONEY_PATTERN = /\$[\d,]+\.\d{2}/g;
// Some vendors (Tejas) print prices as plain decimals with no `$` at all, in
// a fixed "Qty Shipped UOM UnitPrice Total" cluster, e.g. "1 1 CT 54.24
// 54.24". Matching any bare decimal would false-positive on measurements
// inside descriptions (e.g. an 8.75" plate), so this only fires as a
// fallback when no `$` price was found, and requires the full five-token
// shape (two integers, a short unit code, two money-shaped decimals) as
// anchor — that shape is unlikely to occur by coincidence in prose text.
const PLAIN_PRICE_LINE_PATTERN = /(\d+)\s+\d+\s+[A-Za-z]{1,4}\s+(\d+\.\d{2})\s+(\d+\.\d{2})/g;
// Marks the end of the line-items table, right before the totals/payments
// block. A negative lookbehind rather than `\b` since a label can be glued
// directly onto the preceding price with no space (see the header note on
// glued text); the trailing `:?` is optional since some vendors (Tejas)
// print these labels with no colon at all ("Sub-Total 196.89", not
// "Subtotal: 196.89").
const TOTALS_BOUNDARY_PATTERN = /(?<![A-Za-z])(Items|Sub-?total|Total|Sales\s*Tax|Tax|Shipping|Payments|Amount\s*Due)\s*:?/i;
const VENDOR_KEYWORDS = [
  { vendor: 'Gateway', patterns: [/gatewayp\.com/i, /\bgateway\b/i] },
  { vendor: 'Tejas', patterns: [/tejasoffice\.com/i, /\btejas\b/i] },
  { vendor: 'Amazon', patterns: [/amazon\.com/i, /\bamazon\b/i] },
];

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// `labels` may be a single label or a list of alternatives to try in order —
// different vendors name the same field differently (Gateway: "Reference
// Number", Tejas: "Invoice Number" — there's no "Reference Number" on a
// Tejas invoice at all).
function extractAfterLabel(text, labels) {
  for (const label of Array.isArray(labels) ? labels : [labels]) {
    const re = new RegExp(`${escapeRegExp(label)}\\s*:?\\s*\\n?\\s*([^\\n]+)`, 'i');
    const m = text.match(re);
    if (m && m[1].trim()) return m[1].trim();
  }
  return null;
}

function detectVendor(text) {
  for (const { vendor, patterns } of VENDOR_KEYWORDS) {
    if (patterns.some((p) => p.test(text))) return vendor;
  }
  return null;
}

/** Slice out just the line-items table, between the column-header row and the totals block. */
function extractTableSection(text) {
  const startMatch = text.search(/\bSKU\b/i);
  const start = startMatch === -1 ? 0 : startMatch;
  const rest = text.slice(start);
  const endMatch = rest.search(TOTALS_BOUNDARY_PATTERN);
  return endMatch === -1 ? rest : rest.slice(0, endMatch);
}

/**
 * Builds a regex matching any of the given literal SKU strings, longest
 * first (avoids prefix collisions). No `\b` boundaries — adjacent cells can
 * be glued directly onto the SKU with no separator (see file header note),
 * so requiring a word boundary would make real SKUs unmatchable.
 */
function buildKnownSkuPattern(knownSkus) {
  const unique = [...new Set(knownSkus.filter(Boolean))].sort((a, b) => b.length - a.length);
  if (unique.length === 0) return null;
  return new RegExp(`(${unique.map(escapeRegExp).join('|')})`, 'gi');
}

function findSkuMatches(text, knownSkus) {
  const pattern = knownSkus?.length ? buildKnownSkuPattern(knownSkus) : GENERIC_SKU_PATTERN;
  return pattern ? [...text.matchAll(pattern)] : [];
}

function parseLineItems(text, knownSkus) {
  const normalized = text.replace(/\bFREE\b/gi, '$0.00');
  const skuMatches = findSkuMatches(normalized, knownSkus);
  const items = [];

  for (let i = 0; i < skuMatches.length; i++) {
    const sku = skuMatches[i][0];
    const windowStart = skuMatches[i].index + sku.length;
    const windowEnd = i + 1 < skuMatches.length ? skuMatches[i + 1].index : normalized.length;
    let window = normalized.slice(windowStart, windowEnd);
    // The last line item's window would otherwise run to the end of the
    // document — cut it off at the totals/payments block so its numbers
    // aren't picked up as this item's own.
    const totalsMatch = window.search(TOTALS_BOUNDARY_PATTERN);
    if (totalsMatch !== -1) window = window.slice(0, totalsMatch);

    const prices = [...window.matchAll(MONEY_PATTERN)];

    let unitPrice, extendedPrice, quantity, description;

    if (prices.length > 0) {
      // Take the two prices closest to the SKU, not the last two in the
      // whole window: if the *next* line's SKU isn't in the catalog (e.g. an
      // item not yet added to Smartsheet, or a promo line), there's no
      // boundary marker for it and this window runs past it — its prices
      // would otherwise get picked up as this item's own.
      const nearestTwo = prices.slice(0, 2);
      unitPrice = Number(nearestTwo[0][0].replace(/[$,]/g, ''));
      extendedPrice = Number(nearestTwo[nearestTwo.length - 1][0].replace(/[$,]/g, ''));

      // Quantity: the run of digits immediately before the unit-price
      // amount, allowing for a short trailing "unit" word glued in between
      // (e.g. the "1Box" in "...25/Box1Box$8.21") — works whether or not
      // cells are whitespace-separated, since it anchors off the $ amount,
      // not spacing.
      const beforePrice = window.slice(0, nearestTwo[0].index);
      const qtyMatch = beforePrice.match(/(\d+)\s*[A-Za-z]{0,20}\s*$/);
      quantity = qtyMatch ? Number(qtyMatch[1]) : 1;
      description = (qtyMatch ? beforePrice.slice(0, qtyMatch.index) : beforePrice)
        .replace(/\s+/g, ' ')
        .trim();
    } else {
      // No `$` price nearby — try the no-dollar-sign vendor layout instead
      // (see PLAIN_PRICE_LINE_PATTERN). Take the last match in the window,
      // closest to the boundary, in case an earlier decimal-looking number
      // in the description happens to be followed by more digits.
      const plainMatches = [...window.matchAll(PLAIN_PRICE_LINE_PATTERN)];
      if (plainMatches.length === 0) continue; // no price found near this SKU — not a real line item
      const m = plainMatches[plainMatches.length - 1];
      quantity = Number(m[1]);
      unitPrice = Number(m[2]);
      extendedPrice = Number(m[3]);
      description = window.slice(0, m.index).replace(/\s+/g, ' ').trim();
    }

    items.push({ sku, description, quantity, unitPrice, extendedPrice });
  }

  return items;
}

/**
 * Parse flattened invoice/PO text into vendor, header fields, and line items.
 *
 * `knownSkus` (optional) is the list of Item Numbers from the Smartsheet
 * catalog — when provided, line items are found by searching for those exact
 * values in the text rather than guessing a generic code pattern. Real Item
 * Numbers vary too much (`DCC12J12`, `5MIL100`, or even a plain phrase like
 * "Frigidaire Air Filter") for one regex to reliably catch them all, but an
 * exact search against a known, closed set is reliable — and safe to run
 * against the whole document, not just a "table section", since a real
 * catalog SKU is extremely unlikely to appear outside the line-items table.
 * Without `knownSkus`, a generic best-effort pattern is used instead,
 * restricted to a heuristically-detected table section to limit false
 * positives (e.g. an account number that happens to look SKU-shaped).
 *
 * Line items are always a best-effort reconstruction from a linear text
 * stream — meant to be reviewed/edited by a human before use, never trusted
 * blindly.
 */
export function parseInvoiceText(text, knownSkus = []) {
  const raw = text || '';
  const searchText = knownSkus?.length ? raw : extractTableSection(raw);
  return {
    vendor: detectVendor(raw),
    referenceNumber: extractAfterLabel(raw, ['Reference Number', 'Invoice Number']),
    orderDate: extractAfterLabel(raw, ['Order Date']),
    invoiceDate: extractAfterLabel(raw, ['Invoice Date']),
    lineItems: parseLineItems(searchText, knownSkus),
  };
}
