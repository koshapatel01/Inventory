// The guided product tour's script — a pure, framework-free list consumed by
// components/Guide.jsx. Each step names the route it belongs to and a CSS
// selector for the real element to spot light on that route; the tour engine
// navigates between routes as needed while walking through the list.
//
// `selector: null` means "no specific element" — shown as a centered card
// with no spotlight (used only for the opening/closing steps). Every other
// selector targets either an element that's always present on that page
// regardless of data/filters (so the tour never breaks on an empty table),
// or a `data-tour="..."` attribute added specifically to disambiguate an
// element from others sharing the same class on that page (see
// components/InvoiceUpload.jsx and components/CostAnalysisClient.jsx).

export const TOUR_STEPS = [
  {
    id: 'welcome',
    path: '/',
    selector: null,
    placement: 'center',
    title: 'Welcome to the Supply Inventory Tracker',
    body: "This is a quick tour of everything the app can do — tracking stock, placing and receiving orders, transferring stock between locations, and analyzing what's been spent. It takes about two minutes. You can restart it anytime from the ? button in the corner, or skip it now and explore on your own.",
  },
  {
    id: 'home-stats',
    path: '/',
    selector: '.stats',
    placement: 'bottom',
    title: 'At a glance',
    body: "These chips total how many items are tracked, how many are OK, and how many are Low — below their reorder minimum. Low-stock rows are also highlighted in red in the table below.",
  },
  {
    id: 'home-filters',
    path: '/',
    selector: '.filters',
    placement: 'bottom',
    title: 'Find anything fast',
    body: "Filter by category — Office Supplies, Breakroom Supplies, or Manual Add (items created straight from an invoice that weren't already in the catalog) — search by SKU or name, or check 'Low stock only' to see just what needs reordering.",
  },
  {
    id: 'home-table',
    path: '/',
    selector: '.table-wrap',
    placement: 'top',
    title: 'The inventory table',
    body: "Every item's quantity at each location: S755 (central storage & purchasing), S821, and TLS. Click any quantity cell and type a new number — it saves the moment you click away. Status is never set by hand: it reads 'Ordered' while a placed order hasn't fully arrived, otherwise it's OK or Low based on quantity vs. minimum.",
  },
  {
    id: 'home-transfer',
    path: '/',
    selector: '[data-tour="transfer-header"]',
    placement: 'bottom',
    title: 'Moving stock between locations',
    body: "Click 'Transfer' on any row to move stock out of S755 to S821 or TLS — pick a quantity, destination, and who's doing it. Every transfer is logged permanently in Transfer History.",
  },
  {
    id: 'home-orders',
    path: '/',
    selector: '[data-tour="orders-header"]',
    placement: 'bottom',
    title: 'Placing an order',
    body: "Click 'Place Order' on any row to record a purchase — vendor, quantity, unit price, and who ordered it. This doesn't add stock yet; stock only changes once the order is marked received. Click 'History' to see every past order for that one item.",
  },
  {
    id: 'orders-history',
    path: '/orders',
    selector: '.table-wrap',
    placement: 'top',
    title: 'Order History',
    body: "Every order ever placed, across every item. Once an order arrives, click 'Receive' to log the delivery — partial deliveries are supported, so you can receive part of an order now and the rest later. That's the moment stock actually gets added back to S755. 'Cancel Order' stays available until an order is fully received.",
  },
  {
    id: 'orders-upload',
    path: '/orders/upload',
    selector: '[data-tour="upload-form"]',
    placement: 'bottom',
    title: 'Upload an invoice instead of typing it in',
    body: "Drop in a Gateway, Tejas, or Amazon PDF and the app reads it for you — vendor, line items, quantities, and prices. Review the parsed rows on the next screen (fix anything that didn't match a catalog item, or add a brand-new item on the spot), pick who's ordering, then create every line as an order in one click — much faster than entering them one by one.",
  },
  {
    id: 'transfers',
    path: '/transfers',
    selector: '.table-wrap',
    placement: 'top',
    title: 'Transfer History',
    body: 'A running log of every transfer out of S755 to the breakrooms — date, item, SKU, quantity, and who moved it.',
  },
  {
    id: 'receiving-log',
    path: '/receiving-log',
    selector: '.table-wrap',
    placement: 'top',
    title: 'Receiving Log',
    body: "Every delivery that's been received against an order, showing exactly what arrived and when — this is what feeds the stock increases you see back on the inventory page.",
  },
  {
    id: 'cost-filters',
    path: '/cost-analysis',
    selector: '[data-tour="cost-filters"]',
    placement: 'bottom',
    title: 'Cost Analysis Dashboard',
    body: "This is where purchasing spend gets analyzed. Filter by date range, category, or a single item — everything below updates instantly. Only orders that were placed count toward spend, so receiving a delivery or transferring stock never double-counts the same purchase.",
  },
  {
    id: 'cost-kpis',
    path: '/cost-analysis',
    selector: '[data-tour="kpi-main"]',
    placement: 'bottom',
    title: 'Spending at a glance',
    body: 'Total spend, the Office vs. Breakroom split, and how many orders were placed — for whatever is currently filtered. The Office and Breakroom cards always compare both categories directly, even if the Category filter is narrowed to just one.',
  },
  {
    id: 'cost-monthly',
    path: '/cost-analysis',
    selector: '[data-tour="monthly-chart"]',
    placement: 'top',
    title: 'Spending over time',
    body: 'Bars show monthly spend; the line shows how many orders were placed each month. Hover any bar or dot for exact numbers.',
  },
  {
    id: 'cost-compare',
    path: '/cost-analysis',
    selector: '[data-tour="category-compare"]',
    placement: 'top',
    title: 'Office vs. Breakroom',
    body: 'A direct side-by-side of the two supply categories, so you can see at a glance which is driving spend.',
  },
  {
    id: 'cost-ranked',
    path: '/cost-analysis',
    selector: '[data-tour="ranked-table"]',
    placement: 'top',
    title: 'Ranked by spend',
    body: "Every item ever ordered, ranked by total spend, with quantity, times ordered, and average unit price. A 'flagged' badge means one or more of that item's orders had no real price on record — treat that item's total as a floor, not the full picture. Pick a single item from the filter above to see its own total spent, quantity, order count, average unit price, and average cost per order.",
  },
  {
    id: 'finish',
    path: '/cost-analysis',
    selector: null,
    placement: 'center',
    title: "That's the whole app",
    body: 'From tracking stock and placing orders to analyzing what’s been spent. Come back to this tour anytime with the ? button in the corner, or visit the Help Center for written, step-by-step guides you can reference on your own.',
  },
];
