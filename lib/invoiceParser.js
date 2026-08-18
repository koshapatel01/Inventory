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
// Amazon order-confirmation PDFs ("Final Details for Order #...") are a
// different shape entirely from a vendor invoice table: there's no SKU
// printed anywhere, quantity comes BEFORE the description ("2 of: <title>"),
// and only a single unit price is printed per line (no separate extended
// total — that's only summed at the very bottom as "Item(s) Subtotal").
// Anchoring on "N of:" is reliable since that phrase is Amazon-specific
// boilerplate that only appears once per line item.
const AMAZON_ITEM_PATTERN = /(\d+)\s+of:\s*([\s\S]*?)\$([\d,]+\.\d{2})/g;
// The description capture above is non-greedy up to the first `$` price, so
// it also swallows the "Sold by...", "Business Price", "Condition: New"
// boilerplate that sits between the product title and that price — strip
// starting from whichever of those appears first.
const AMAZON_DESC_STOP_PATTERN = /\b(Sold by|Business Price|Condition:)/i;
// Marks the end of the line-items table, right before the totals/payments
// block. A negative lookbehind rather than `\b` since a label can be glued
// directly onto the preceding price with no space (see the header note on
// glued text); the trailing `:?` is optional since some vendors (Tejas)
// print these labels with no colon at all ("Sub-Total 196.89", not
// "Subtotal: 196.89").
const TOTALS_BOUNDARY_PATTERN = /(?<![A-Za-z])(Items|Sub-?total|Total|Sales\s*Tax|Tax|Shipping|Payments|Amount\s*Due)\s*:?/i;
// The invoice's own printed total, used to reconcile against the sum of
// parsed line items — the fastest way to tell whether parsing missed
// something, since a mismatch is visible even without cross-checking every
// row against the PDF by hand. Preference order matters: "Items"/"Sub-Total"
// reflect the pre-tax/shipping sum of the line items themselves (what our
// parsed lines should add up to), while "Total" can include tax/shipping the
// line items don't capture — so it's only used as a last resort.
const INVOICE_TOTAL_LABELS = ['Items', 'Sub-Total', 'Subtotal', 'Total'];
function extractInvoiceTotal(text) {
  for (const label of INVOICE_TOTAL_LABELS) {
    const re = new RegExp(`(?<![A-Za-z])${escapeRegExp(label)}\\s*:?\\s*\\$?([\\d,]+\\.\\d{2})`, 'i');
    const m = text.match(re);
    if (m) return Number(m[1].replace(/,/g, ''));
  }
  return null;
}

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

// Anchors the start of the line-items table. Gateway's header row says "SKU"
// outright; Tejas instead labels the same column "Item Number".
const TABLE_HEADER_PATTERN = /\b(SKU|Item\s*Number)\b/i;

/** Index range of the line-items table, between the column-header row and the totals block. */
function tableSectionBounds(text) {
  const startMatch = text.search(TABLE_HEADER_PATTERN);
  const start = startMatch === -1 ? 0 : startMatch;

  // The totals-boundary search must not start until AFTER the header row
  // itself — Tejas's header row reads "...Unit Price Unit Total", and that
  // "Total" would otherwise be mistaken for the start of the totals block,
  // cutting the table off before a single item row is even reached (the
  // whole header row is on one line, unlike Gateway's item ROWS, which get
  // glued/split unpredictably — see the file's top-of-file note).
  const headerLineEnd = text.indexOf('\n', start);
  const searchFrom = headerLineEnd === -1 ? start : headerLineEnd + 1;

  const rest = text.slice(searchFrom);
  const endMatch = rest.search(TOTALS_BOUNDARY_PATTERN);
  const end = endMatch === -1 ? text.length : searchFrom + endMatch;
  return { start, end };
}

/** Slice out just the line-items table, between the column-header row and the totals block. */
function extractTableSection(text) {
  const { start, end } = tableSectionBounds(text);
  return text.slice(start, end);
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

/**
 * Finds SKU-anchor positions for the line-item table. When a catalog SKU
 * list is supplied, exact matches against it are the primary strategy (see
 * parseInvoiceText's doc comment) — but a line whose SKU simply isn't in the
 * catalog yet would otherwise vanish from parsing entirely, with no trace in
 * the review table, which is exactly the "invoice items don't add up" bug
 * this exists to catch. So known-SKU matches are supplemented with any
 * additional SKU-shaped token (GENERIC_SKU_PATTERN) found in the table
 * section that isn't already covered by a known match — surfacing those rows
 * as "no catalog item" lines the user can manually match (or add to the
 * catalog) instead of them disappearing silently. Restricted to the table
 * section (not the whole document) because the generic pattern is prone to
 * false positives elsewhere, e.g. an account number like "UH5015" reads as
 * SKU-shaped.
 */
function findSkuMatches(text, knownSkus) {
  if (!knownSkus?.length) {
    return [...text.matchAll(GENERIC_SKU_PATTERN)];
  }
  const known = [...text.matchAll(buildKnownSkuPattern(knownSkus))];
  const { start, end } = tableSectionBounds(text);
  const coveredRanges = known.map((m) => [m.index, m.index + m[0].length]);
  const extra = [...text.matchAll(GENERIC_SKU_PATTERN)].filter((m) => {
    if (m.index < start || m.index >= end) return false;
    const mEnd = m.index + m[0].length;
    return !coveredRanges.some(([s, e]) => m.index < e && mEnd > s);
  });
  return [...known, ...extra].sort((a, b) => a.index - b.index);
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
 * Line items for Amazon order-confirmation PDFs, which have no SKU at all —
 * only a "N of: <product title>" line and a single unit price. `sku` is left
 * null; matching to a catalog item has to happen by fuzzy name match instead
 * (see matchLineItemToCatalog), not exact code lookup.
 */
function parseAmazonLineItems(text) {
  const items = [];
  for (const m of text.matchAll(AMAZON_ITEM_PATTERN)) {
    const quantity = Number(m[1]);
    let description = m[2];
    const stop = description.search(AMAZON_DESC_STOP_PATTERN);
    if (stop !== -1) description = description.slice(0, stop);
    description = description.replace(/\s+/g, ' ').trim();
    const unitPrice = Number(m[3].replace(/,/g, ''));
    if (!description || !Number.isFinite(unitPrice)) continue;
    const qty = Number.isFinite(quantity) && quantity > 0 ? quantity : 1;
    items.push({ sku: null, description, quantity: qty, unitPrice, extendedPrice: Number((qty * unitPrice).toFixed(2)) });
  }
  return items;
}

const MATCH_STOPWORDS = new Set(['and', 'the', 'for', 'of', 'with', 'in', 'a', 'to', 'on', 'by', 'or']);

/** Lowercased significant words (3+ letters, stopwords dropped) for fuzzy matching. */
function significantWords(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .split(' ')
    .filter((w) => w.length >= 3 && !MATCH_STOPWORDS.has(w));
}

/**
 * Match a parsed line item to a catalog item. Lines with a `sku` (Gateway,
 * Tejas) match by exact code, same as always. Lines with no `sku` (Amazon)
 * fall back to a fuzzy name match by word overlap, NOT a substring check —
 * Amazon's marketing titles pad brand/product words with filler ("OXO GOOD
 * GRIPS POP Container - Airtight Food Storage..."), so a short catalog name
 * like "OXO POP Container" never appears as one contiguous phrase even
 * though every word in it does appear. A catalog item matches when every one
 * of its significant words is found somewhere in the description; among
 * matches, the one with the most matched words wins (most specific). A
 * single-word catalog name only counts if that word is long enough (7+
 * letters) to not be a coincidental generic hit — e.g. a catalog item named
 * just "Sugar" must NOT auto-match an OXO container description that
 * mentions "Ideal for 5 lbs of sugar" as a capacity reference, not as the
 * product itself. Best-effort only — always
 * reviewed by a human before an order is created (see
 * components/InvoiceUpload.jsx), so a wrong or missing match is safe, just
 * inconvenient.
 */
export function matchLineItemToCatalog(line, catalogItems) {
  if (line.sku) {
    const upper = line.sku.toUpperCase();
    return catalogItems.find((item) => item.sku && item.sku.toUpperCase() === upper) || null;
  }
  const descWords = new Set(significantWords(line.description));
  if (descWords.size === 0) return null;
  let best = null;
  let bestMatchedCount = 0;
  for (const item of catalogItems) {
    const nameWords = significantWords(item.name);
    if (nameWords.length === 0) continue;
    if (nameWords.length === 1 && nameWords[0].length < 7) continue;
    const matchedCount = nameWords.filter((w) => descWords.has(w)).length;
    if (matchedCount < nameWords.length) continue; // require full coverage
    if (matchedCount > bestMatchedCount) {
      best = item;
      bestMatchedCount = matchedCount;
    }
  }
  return best;
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
  const vendor = detectVendor(raw);
  // Amazon order confirmations have no SKU anywhere in the text, so the
  // exact-code table strategy above can never find anything — use the
  // dedicated "N of: <title> ... $price" parser instead.
  const lineItems = vendor === 'Amazon'
    ? parseAmazonLineItems(raw)
    : parseLineItems(knownSkus?.length ? raw : extractTableSection(raw), knownSkus);
  return {
    vendor,
    referenceNumber: extractAfterLabel(raw, ['Reference Number', 'Invoice Number', 'Amazon.com order number']),
    orderDate: extractAfterLabel(raw, ['Order Date', 'Order Placed']),
    invoiceDate: extractAfterLabel(raw, ['Invoice Date']),
    invoiceTotal: extractInvoiceTotal(raw),
    lineItems,
  };
}
