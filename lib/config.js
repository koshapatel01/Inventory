// ─────────────────────────────────────────────────────────────────────────────
// EDIT ME to match your Smartsheet. The keys on the left are used by the app;
// the strings on the right must equal your Smartsheet column titles EXACTLY
// (case-sensitive). You do NOT need to rename anything in Smartsheet — just make
// these strings match what you already have.
// ─────────────────────────────────────────────────────────────────────────────

export const COLUMN_MAP = {
  sku: 'Item Number',
  name: 'Item Description',
  category: 'Category',
  location: 'Location',
  quantity: 'Qty On-Hand',
  minimum: 'Min Qty Required',
  status: 'Status',
  lastUpdated: 'Date Inventory Counted',
  notes: 'Notes',
  vendor: 'Vendor',
  reorderQty: 'Min Qty To Order',
  containerType: 'Container Type',
  orderPlaced: 'Order Placed',
  orderPlacedBy: 'Order Placed By',
};

// Fields operators can edit inline. These are local-only (see lib/localStore.js)
// — Smartsheet itself is never written to.
export const EDITABLE_FIELDS = ['qtyS755', 'qtyS821', 'qtyTls', 'status'];

// Filter options shown in the UI.
export const LOCATIONS = ['S755', 'S821', 'TLS'];
export const CATEGORIES = ['Office Supplies', 'Breakroom Supplies'];
export const STATUS_OPTIONS = ['OK', 'Low', 'Ordered', 'Received'];

// Supply transfers always originate at S755 (central receiving/storage) and
// move to one of the other breakrooms.
export const TRANSFER_SOURCE = 'S755';
export const TRANSFER_DESTINATIONS = LOCATIONS.filter((l) => l !== TRANSFER_SOURCE);

// Staff who can be recorded as completing a transfer.
export const STAFF = ['Jenny', 'Samantha', 'Sofia', 'Genesis'];

// Optional friendlier labels (used in tooltips / future views).
export const LOCATION_LABELS = {
  S755: 'S755 — Central purchasing & storage',
  S821: 'S821',
  TLS: 'TLS',
};
