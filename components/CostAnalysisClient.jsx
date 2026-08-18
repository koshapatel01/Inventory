'use client';

import { useMemo, useState } from 'react';
import {
  filterRecords,
  summarize,
  summarizeItem,
  buildMonthlySeries,
  buildCategoryTotals,
  rankItemsBySpend,
} from '@/lib/costAnalysis';
import { formatCurrency, formatNumber, formatMonth } from '@/lib/format';

// Coordinated colors for the two named categories; anything else (Manual Add,
// Uncategorized) gets a neutral gray so Office/Breakroom stay visually
// distinct everywhere they appear (KPI cards, chart bars, table dots).
const CATEGORY_COLOR = {
  'Office Supplies': '#c8102e',
  'Breakroom Supplies': '#2f6feb',
};
const FALLBACK_COLOR = '#8a93a6';
function colorFor(category) {
  return CATEGORY_COLOR[category] || FALLBACK_COLOR;
}

export default function CostAnalysisClient({ initialRecords, items, categories }) {
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [category, setCategory] = useState('all');
  const [rowId, setRowId] = useState('all');

  const filtered = useMemo(
    () => filterRecords(initialRecords, { from, to, category, rowId }),
    [initialRecords, from, to, category, rowId]
  );

  // Office vs Breakroom always reflects date range + item filter, but not the
  // category filter itself — otherwise picking one category would flatten the
  // very comparison this chart exists to show.
  const categoryScoped = useMemo(
    () => filterRecords(initialRecords, { from, to, rowId }),
    [initialRecords, from, to, rowId]
  );

  const summary = useMemo(() => summarize(filtered), [filtered]);
  const categoryTotals = useMemo(() => buildCategoryTotals(categoryScoped), [categoryScoped]);
  const officeTotal = categoryTotals.find((c) => c.category === 'Office Supplies')?.spend || 0;
  const breakroomTotal = categoryTotals.find((c) => c.category === 'Breakroom Supplies')?.spend || 0;

  const monthly = useMemo(() => buildMonthlySeries(filtered), [filtered]);
  const ranked = useMemo(() => rankItemsBySpend(filtered), [filtered]);
  const itemDetail = useMemo(
    () => (rowId !== 'all' ? summarizeItem(filtered) : null),
    [filtered, rowId]
  );
  const selectedItem = rowId !== 'all' ? items.find((i) => String(i.rowId) === String(rowId)) : null;

  const hasData = initialRecords.length > 0;

  return (
    <section>
      <div className="filters">
        <label>
          From
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </label>
        <label>
          To
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </label>
        <label>
          Category
          <select value={category} onChange={(e) => setCategory(e.target.value)}>
            <option value="all">All Categories</option>
            {categories.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        </label>
        <label className="grow">
          Item
          <select value={rowId} onChange={(e) => setRowId(e.target.value)}>
            <option value="all">All Items</option>
            {items.map((i) => (
              <option key={i.rowId} value={i.rowId}>
                {i.sku ? `${i.sku} — ${i.name}` : i.name}
              </option>
            ))}
          </select>
        </label>
      </div>

      {!hasData ? (
        <div className="empty">No orders have been placed yet — cost analysis will appear once orders exist.</div>
      ) : (
        <>
          <div className="kpi-grid">
            <KpiCard
              label="Total Supply Spending"
              value={formatCurrency(summary.totalSpend)}
              title="Sum of Extended Total across every placed order matching the current filters."
            />
            <KpiCard
              label="Office Supply Spending"
              value={formatCurrency(officeTotal)}
              accent={CATEGORY_COLOR['Office Supplies']}
              title="Office Supplies spend for the current date range and item filter (not affected by the Category filter)."
            />
            <KpiCard
              label="Breakroom Supply Spending"
              value={formatCurrency(breakroomTotal)}
              accent={CATEGORY_COLOR['Breakroom Supplies']}
              title="Breakroom Supplies spend for the current date range and item filter (not affected by the Category filter)."
            />
            <KpiCard
              label="Times Ordered"
              value={formatNumber(summary.totalOrders)}
              title="Count of Order Placed records matching the current filters. Receiving and transfer events are never counted."
            />
          </div>

          {summary.flaggedCount > 0 && (
            <div className="toast toast-error" style={{ marginTop: 14 }}>
              {summary.flaggedCount} order{summary.flaggedCount === 1 ? '' : 's'} in this view{' '}
              {summary.flaggedCount === 1 ? 'has' : 'have'} a $0.00 unit price — included in totals as $0, but
              flagged in the ranked table below since a missing price can silently understate spend.
            </div>
          )}

          {itemDetail && (
            <div className="chart-card" style={{ marginTop: 18 }}>
              <h3 className="chart-title">
                {selectedItem?.name || 'Selected Item'}
                {selectedItem?.sku ? ` (${selectedItem.sku})` : ''}
              </h3>
              <div className="kpi-grid kpi-grid-compact">
                <KpiCard compact label="Total Spent" value={formatCurrency(itemDetail.totalSpent)} />
                <KpiCard compact label="Total Qty Ordered" value={formatNumber(itemDetail.totalQuantity)} />
                <KpiCard compact label="Times Ordered" value={formatNumber(itemDetail.timesOrdered)} />
                <KpiCard
                  compact
                  label="Avg Unit Price"
                  value={formatCurrency(itemDetail.avgUnitPrice)}
                  title="Total spent ÷ total quantity ordered."
                />
                <KpiCard
                  compact
                  label="Avg Cost / Order"
                  value={formatCurrency(itemDetail.avgCostPerOrder)}
                  title="Total spent ÷ number of times ordered."
                />
              </div>
            </div>
          )}

          <div className="chart-card" style={{ marginTop: 18 }}>
            <h3 className="chart-title" title="Spending and order count for each month, based on the order date, within the current filters.">
              Monthly Spending &amp; Order Count
            </h3>
            {monthly.length === 0 ? (
              <div className="empty">No orders in this range.</div>
            ) : (
              <MonthlyChart data={monthly} />
            )}
          </div>

          <div className="chart-card" style={{ marginTop: 18 }}>
            <h3
              className="chart-title"
              title="Office Supplies vs Breakroom Supplies spend for the current date range and item filter."
            >
              Office vs Breakroom Spending
            </h3>
            <CategoryComparison office={officeTotal} breakroom={breakroomTotal} />
          </div>

          <div className="table-wrap" style={{ marginTop: 18 }}>
            <table>
              <thead>
                <tr>
                  <th>Item</th>
                  <th>Category</th>
                  <th className="num">Total Spent</th>
                  <th className="num">Qty Ordered</th>
                  <th className="num">Times Ordered</th>
                  <th className="num">Avg Unit Price</th>
                </tr>
              </thead>
              <tbody>
                {ranked.length === 0 && (
                  <tr><td colSpan={6} className="empty">No orders match the current filters.</td></tr>
                )}
                {ranked.map((row) => (
                  <tr key={row.rowId}>
                    <td>
                      <span className="cat-dot" style={{ background: colorFor(row.category) }} />
                      {row.item}
                      {row.itemNumber && <span className="mono" style={{ marginLeft: 6 }}>({row.itemNumber})</span>}
                      {row.flaggedCount > 0 && (
                        <span
                          className="status-badge status-low"
                          style={{ marginLeft: 8 }}
                          title={`${row.flaggedCount} order${row.flaggedCount === 1 ? '' : 's'} with a $0.00 unit price`}
                        >
                          {row.flaggedCount} flagged
                        </span>
                      )}
                    </td>
                    <td>{row.category}</td>
                    <td className="num">{formatCurrency(row.totalSpent)}</td>
                    <td className="num">{formatNumber(row.totalQuantity)}</td>
                    <td className="num">{formatNumber(row.timesOrdered)}</td>
                    <td className="num">{formatCurrency(row.avgUnitPrice)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <p className="footnote">
            Only Order Placed records count toward spending and order frequency — receiving a delivery or
            transferring stock between locations moves stock that&apos;s already been paid for, so those events
            are excluded to avoid double-counting. Cancelled orders remain included: cancelling doesn&apos;t undo
            the fact that an order was placed.
          </p>
        </>
      )}
    </section>
  );
}

function KpiCard({ label, value, accent, title, compact }) {
  return (
    <div className={`kpi-card${compact ? ' kpi-card-compact' : ''}`} style={accent ? { '--kpi-accent': accent } : undefined} title={title}>
      <div className="kpi-label">{label}</div>
      <div className="kpi-value">{value}</div>
    </div>
  );
}

function MonthlyChart({ data }) {
  const width = 640;
  const height = 220;
  const padding = { top: 10, right: 10, bottom: 28, left: 46 };
  const plotW = width - padding.left - padding.right;
  const plotH = height - padding.top - padding.bottom;

  const maxSpend = Math.max(1, ...data.map((d) => d.spend));
  const maxOrders = Math.max(1, ...data.map((d) => d.orders));
  const barSlot = plotW / data.length;
  const barW = Math.min(36, barSlot * 0.55);

  const points = data.map((d, i) => {
    const x = padding.left + barSlot * i + barSlot / 2;
    const y = padding.top + plotH - (d.orders / maxOrders) * plotH;
    return `${x},${y}`;
  });

  return (
    <svg viewBox={`0 0 ${width} ${height}`} width="100%" height={height} role="img" aria-label="Monthly spending and order count">
      {data.map((d, i) => {
        const x = padding.left + barSlot * i + (barSlot - barW) / 2;
        const barH = (d.spend / maxSpend) * plotH;
        const y = padding.top + plotH - barH;
        return (
          <g key={d.month} className="chart-bar-group">
            <rect x={x} y={y} width={barW} height={Math.max(barH, 1)} rx="3" className="chart-bar">
              <title>{`${formatMonth(d.month)}: ${formatCurrency(d.spend)} across ${d.orders} order${d.orders === 1 ? '' : 's'}`}</title>
            </rect>
            <text x={x + barW / 2} y={height - 8} textAnchor="middle" className="chart-axis-label">
              {formatMonth(d.month).replace(' ', '’').slice(0, 6)}
            </text>
          </g>
        );
      })}
      <polyline points={points.join(' ')} className="chart-line" fill="none" />
      {data.map((d, i) => {
        const [x, y] = points[i].split(',');
        return (
          <circle key={d.month} cx={x} cy={y} r="3.5" className="chart-line-dot">
            <title>{`${formatMonth(d.month)}: ${d.orders} order${d.orders === 1 ? '' : 's'}`}</title>
          </circle>
        );
      })}
    </svg>
  );
}

function CategoryComparison({ office, breakroom }) {
  const max = Math.max(1, office, breakroom);
  return (
    <div className="cat-compare">
      <CompareBar label="Office Supplies" value={office} max={max} color={CATEGORY_COLOR['Office Supplies']} />
      <CompareBar label="Breakroom Supplies" value={breakroom} max={max} color={CATEGORY_COLOR['Breakroom Supplies']} />
    </div>
  );
}

function CompareBar({ label, value, max, color }) {
  const pct = max > 0 ? (value / max) * 100 : 0;
  return (
    <div className="cat-compare-row">
      <div className="cat-compare-label">{label}</div>
      <div className="cat-compare-track">
        <div className="cat-compare-fill" style={{ width: `${pct}%`, background: color }} title={formatCurrency(value)} />
      </div>
      <div className="cat-compare-value">{formatCurrency(value)}</div>
    </div>
  );
}
