import Link from 'next/link';
import HelpTourButton from '@/components/HelpTourButton';

export const metadata = { title: 'Help Center — UHD Supply Inventory' };

const SECTIONS = [
  { id: 'overview', label: 'Overview' },
  { id: 'inventory', label: 'The Inventory Page' },
  { id: 'ordering', label: 'Placing an Order' },
  { id: 'upload', label: 'Uploading an Invoice' },
  { id: 'receiving', label: 'Receiving & Cancelling' },
  { id: 'transfers', label: 'Transferring Stock' },
  { id: 'logs', label: 'Order / Transfer / Receiving Logs' },
  { id: 'cost-analysis', label: 'Cost Analysis Dashboard' },
  { id: 'tips', label: 'Good to Know' },
];

export default function HelpPage() {
  return (
    <main className="container">
      <header className="app-header">
        <h1>Help Center</h1>
        <p className="subtitle"><Link href="/">← Back to inventory</Link></p>
      </header>

      <div className="filters" style={{ marginBottom: 18 }}>
        <div className="grow">
          <div style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: 8 }}>
            On this page
          </div>
          <div className="stats" style={{ marginBottom: 0 }}>
            {SECTIONS.map((s) => (
              <a key={s.id} className="chip" href={`#${s.id}`}>{s.label}</a>
            ))}
          </div>
        </div>
        <HelpTourButton />
      </div>

      <p className="footnote" style={{ marginTop: 0, marginBottom: 18 }}>
        Prefer to learn by clicking through the real screens? The guided tour above walks you through
        every page with live spotlights. This page is the written reference to come back to anytime.
      </p>

      <section id="overview" className="chart-card" style={{ marginBottom: 18 }}>
        <h2 className="chart-title">Overview</h2>
        <p>
          This app tracks office and breakroom supplies across three locations: <strong>S755</strong> (central
          storage and where all purchasing happens), and two breakrooms, <strong>S821</strong> and{' '}
          <strong>TLS</strong>. Every item belongs to a category — <strong>Office Supplies</strong>,{' '}
          <strong>Breakroom Supplies</strong>, or <strong>Manual Add</strong> (an item created directly from an
          invoice that wasn&apos;t already in the catalog).
        </p>
        <p>
          Each item has a <strong>minimum</strong> (reorder point). Its status is never set by hand — it&apos;s{' '}
          <strong>Ordered</strong> while a placed order for it hasn&apos;t fully arrived yet, otherwise{' '}
          <strong>OK</strong> or <strong>Low</strong> depending on whether its total quantity across all three
          locations meets that minimum.
        </p>
        <details>
          <summary style={{ cursor: 'pointer', color: 'var(--muted)', fontSize: 13 }}>Where the data actually lives (technical)</summary>
          <p style={{ marginTop: 10 }}>
            The item catalog (names, SKUs, categories, minimums) comes from a Smartsheet, and this app only ever
            <em> reads</em> it — it&apos;s never written back to. Live stock quantities and the full order/transfer
            history are this app&apos;s own database, which is the source of truth for everything you do here. Every
            order, receipt, and transfer is also mirrored, best-effort, into a separate audit-log Smartsheet purely
            for record-keeping — that mirror never affects what you see in the app itself.
          </p>
        </details>
      </section>

      <section id="inventory" className="chart-card" style={{ marginBottom: 18 }}>
        <h2 className="chart-title">The Inventory Page</h2>
        <p>The home page is a live view of every item. From here you can:</p>
        <ul>
          <li>Filter by category, search by SKU or name, or check <strong>Low stock only</strong>.</li>
          <li>
            Edit any quantity cell directly — click in, type a new number, click away. It saves immediately; there&apos;s
            no separate &quot;save&quot; button.
          </li>
          <li>Transfer stock from S755 to a breakroom, or place an order — both from the same row.</li>
          <li>Click <strong>History</strong> on any row to see just that item&apos;s past orders.</li>
        </ul>
      </section>

      <section id="ordering" className="chart-card" style={{ marginBottom: 18 }}>
        <h2 className="chart-title">Placing an Order</h2>
        <p>Click <strong>Place Order</strong> on any item's row on the home page, then fill in:</p>
        <ul>
          <li><strong>Quantity</strong> and <strong>unit price</strong> — required, so spending can always be analyzed later.</li>
          <li><strong>Vendor</strong> — Gateway, Tejas, or Amazon.</li>
          <li><strong>Order link</strong> — prefilled if the catalog already has one for that vendor; otherwise enter it by hand.</li>
          <li><strong>Ordered by</strong> — who's placing the order.</li>
        </ul>
        <p>
          Placing an order does <strong>not</strong> add stock — it only records the purchase and flips the item&apos;s
          status to Ordered. Stock updates when the order is later received (see{' '}
          <a href="#receiving">Receiving &amp; Cancelling</a>).
        </p>
      </section>

      <section id="upload" className="chart-card" style={{ marginBottom: 18 }}>
        <h2 className="chart-title">Uploading an Invoice</h2>
        <p>
          Instead of entering orders one by one, go to <strong>Order History → Upload Invoice / PO</strong> and drop
          in a PDF from Gateway, Tejas, or Amazon. The app extracts the vendor, every line item, quantities, and
          prices automatically.
        </p>
        <p>Before creating orders, review the parsed table:</p>
        <ul>
          <li>Rows that matched an existing catalog item are checked and ready to go.</li>
          <li>
            Unmatched rows let you either pick the right catalog item from a dropdown, or type a name to create a
            brand-new item on the spot (tagged <strong>Manual Add</strong>).
          </li>
          <li>Every field — quantity, price, vendor, notes — is editable before you submit.</li>
          <li>
            The invoice&apos;s printed total is compared against the sum of parsed lines, so a mismatch (a missed or
            misread line) is obvious immediately instead of silently going unnoticed.
          </li>
        </ul>
        <p>Pick who&apos;s ordering, then create every checked line as an order in one click.</p>
      </section>

      <section id="receiving" className="chart-card" style={{ marginBottom: 18 }}>
        <h2 className="chart-title">Receiving &amp; Cancelling</h2>
        <p>
          From <strong>Order History</strong>, click <strong>Receive</strong> on any order that&apos;s still Ordered or
          Partially Received. Enter the quantity that arrived (it doesn&apos;t have to be the full order — receive part
          now and the rest later) and a date. This is the step that actually adds stock back to S755 and logs the
          delivery in the Receiving Log.
        </p>
        <p>
          <strong>Cancel Order</strong> is available any time before an order is fully received. A cancelled order
          still shows up in Order History and still counts toward cost analysis — cancelling doesn&apos;t undo the fact
          that the order was placed.
        </p>
      </section>

      <section id="transfers" className="chart-card" style={{ marginBottom: 18 }}>
        <h2 className="chart-title">Transferring Stock</h2>
        <p>
          Click <strong>Transfer</strong> on any item's row on the home page to move stock from S755 out to S821 or
          TLS. Enter a quantity (capped at what&apos;s actually available at S755), pick a destination, and who&apos;s
          moving it. Transfers move stock that&apos;s already been paid for, so they never show up as spending —
          only the original order does.
        </p>
      </section>

      <section id="logs" className="chart-card" style={{ marginBottom: 18 }}>
        <h2 className="chart-title">Order / Transfer / Receiving Logs</h2>
        <p>Three different histories, each answering a different question:</p>
        <ul>
          <li><strong><Link href="/orders">Order History</Link></strong> — every order ever placed, its status, and its receive/cancel actions.</li>
          <li><strong><Link href="/transfers">Transfer History</Link></strong> — every move of stock from S755 to a breakroom.</li>
          <li><strong><Link href="/receiving-log">Receiving Log</Link></strong> — every delivery actually received against an order.</li>
        </ul>
      </section>

      <section id="cost-analysis" className="chart-card" style={{ marginBottom: 18 }}>
        <h2 className="chart-title">Cost Analysis Dashboard</h2>
        <p>
          <Link href="/cost-analysis">Cost Analysis</Link> turns order history into spending insight. Filter by date
          range, category, or a single item, then see:
        </p>
        <ul>
          <li>Total, Office, and Breakroom spending, plus how many orders were placed.</li>
          <li>For a selected item: total spent, total quantity ordered, times ordered, average unit price, and average cost per order.</li>
          <li>A monthly chart of spend and order count, and an Office-vs-Breakroom comparison.</li>
          <li>Every item ranked by total spend.</li>
        </ul>
        <p>
          Only orders that were <em>placed</em> count toward spend and order frequency — receiving a delivery or
          transferring stock never double-counts a purchase. Orders with a $0 unit price are included in totals as
          $0 but flagged in the ranked table, since a missing price could otherwise make spending look lower than it
          really was.
        </p>
      </section>

      <section id="tips" className="chart-card" style={{ marginBottom: 18 }}>
        <h2 className="chart-title">Good to Know</h2>
        <ul>
          <li>An item exactly at its minimum quantity reads as <strong>OK</strong>, not Low — the minimum is the level stock is meant to be kept at.</li>
          <li>The daily low-stock email to ITPMO@UHD.EDU is handled by Smartsheet&apos;s own alert rules, separate from this app.</li>
          <li>Transfer History shows each item&apos;s SKU alongside its name, for exact identification.</li>
          <li>You can restart this tour, or come back to this page, anytime from the ? button in the bottom-right corner of any screen.</li>
        </ul>
      </section>
    </main>
  );
}
