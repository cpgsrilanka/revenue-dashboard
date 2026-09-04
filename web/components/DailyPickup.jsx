import { canonicalSegment } from "@/lib/segments";
import DataTableFrame from "./DataTableFrame";
import SectionHeader from "./SectionHeader";

function numberValue(value) {
  return Number(value || 0);
}

function formatCurrency(value, currency = "LKR", notation = "compact") {
  return new Intl.NumberFormat("en-LK", {
    style: "currency",
    currency,
    notation,
    maximumFractionDigits: notation === "compact" ? 1 : 0,
  }).format(numberValue(value));
}

function formatNumber(value) {
  return new Intl.NumberFormat("en-LK", {
    maximumFractionDigits: 1,
  }).format(numberValue(value));
}

function formatDate(value) {
  if (!value) return "";
  return new Intl.DateTimeFormat("en-LK", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${value}T00:00:00.000Z`));
}

function formatMonth(value) {
  if (!value) return "No segment entered";
  return new Intl.DateTimeFormat("en-LK", {
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${value}T00:00:00.000Z`));
}

function segmentName(value) {
  return canonicalSegment(value);
}

function aggregateRows(rows, keyForRow, seedForRow) {
  const byKey = new Map();

  for (const row of rows) {
    const key = keyForRow(row);
    const existing = byKey.get(key) || seedForRow(row);
    existing.room_revenue += numberValue(row.room_revenue ?? row.total_revenue);
    existing.fnb_revenue += numberValue(row.fnb_revenue);
    existing.total_revenue += numberValue(row.total_revenue);
    existing.nights += numberValue(row.nights);
    existing.reservationIds.add(row.reservation_id || `${row.property_code}-${row.period_month}-${existing.reservationIds.size}`);
    byKey.set(key, existing);
  }

  return [...byKey.values()].map((row) => ({
    ...row,
    reservation_count: row.reservationIds.size,
  }));
}

export default function DailyPickup({ rows, pickupDate, pickupWindowLabel }) {
  const currency = rows[0]?.currency || "LKR";
  const roomRevenue = rows.reduce((sum, row) => sum + numberValue(row.room_revenue ?? row.total_revenue), 0);
  const fnbRevenue = rows.reduce((sum, row) => sum + numberValue(row.fnb_revenue), 0);
  const totalValue = rows.reduce((sum, row) => sum + numberValue(row.total_revenue), 0);
  const nights = rows.reduce((sum, row) => sum + numberValue(row.nights), 0);
  const reservationCount = new Set(rows.map((row, index) => row.reservation_id || `row-${index}`)).size;

  const bySegment = aggregateRows(
    rows,
    (row) => segmentName(row.segment),
    (row) => ({
      segment: segmentName(row.segment),
      room_revenue: 0,
      fnb_revenue: 0,
      total_revenue: 0,
      nights: 0,
      reservationIds: new Set(),
    })
  ).sort((a, b) => b.room_revenue - a.room_revenue);

  const byMonthSegment = aggregateRows(
    rows,
    (row) => `${row.period_month}||${segmentName(row.segment)}`,
    (row) => ({
      period_month: row.period_month,
      segment: segmentName(row.segment),
      room_revenue: 0,
      fnb_revenue: 0,
      total_revenue: 0,
      nights: 0,
      reservationIds: new Set(),
    })
  ).sort((a, b) => {
    if (a.period_month !== b.period_month) return String(a.period_month || "").localeCompare(String(b.period_month || ""));
    return b.room_revenue - a.room_revenue;
  });

  const maxSegmentRevenue = Math.max(...bySegment.map((row) => Math.abs(row.room_revenue)), 1);

  return (
    <section className="border-b border-line pb-8 mb-8">
      <SectionHeader
        eyebrow="Daily pickup"
        title={`Bookings made on ${formatDate(pickupDate)}`}
        subtitle={`Stay months: ${pickupWindowLabel}. Room revenue includes taxes.`}
        action="Based on each workbook's pickup date field"
      />

      <div className="grid grid-cols-1 sm:grid-cols-4 gap-px border border-line rounded-lg overflow-hidden bg-line mb-5">
        <div className="bg-white/65 px-5 py-4">
          <p className="text-xs uppercase tracking-wide text-slate">Room revenue pickup</p>
          <p className="font-display text-2xl mt-1 tabular-nums">{formatCurrency(roomRevenue, currency)}</p>
        </div>
        <div className="bg-white/65 px-5 py-4">
          <p className="text-xs uppercase tracking-wide text-slate">Reservations</p>
          <p className="font-display text-2xl mt-1 tabular-nums">{reservationCount}</p>
        </div>
        <div className="bg-white/65 px-5 py-4">
          <p className="text-xs uppercase tracking-wide text-slate">Villa nights</p>
          <p className="font-display text-2xl mt-1 tabular-nums">{formatNumber(nights)}</p>
        </div>
        <div className="bg-white/65 px-5 py-4">
          <p className="text-xs uppercase tracking-wide text-slate">Meal / FNB charges</p>
          <p className="font-display text-2xl mt-1 tabular-nums">{formatCurrency(fnbRevenue, currency)}</p>
        </div>
      </div>

      {rows.length === 0 ? (
        <p className="text-sm text-slate">
          No bookings were entered on {formatDate(pickupDate)} for present or future stay months.
        </p>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-[0.9fr_1.1fr] gap-4">
          <div className="border border-line rounded-lg bg-white/45 p-4">
            <div className="flex items-center justify-between gap-3 mb-4">
              <div>
                <p className="text-xs uppercase tracking-wide text-slate">Segment pickup</p>
                <h3 className="font-display text-xl">Room revenue mix</h3>
              </div>
              <p className="text-xs text-slate tabular-nums">{formatCurrency(totalValue, currency)} total value</p>
            </div>
            <div className="space-y-3">
              {bySegment.map((row) => {
                const width = `${Math.max(4, (Math.abs(row.room_revenue) / maxSegmentRevenue) * 100)}%`;
                return (
                  <div key={row.segment}>
                    <div className="flex items-center justify-between gap-3 text-xs mb-1">
                      <span className="font-medium text-ink">{row.segment}</span>
                      <span className="tabular-nums text-slate">{formatCurrency(row.room_revenue, currency)}</span>
                    </div>
                    <div className="h-2 rounded-full bg-line overflow-hidden">
                      <div
                        className={`h-full rounded-full ${row.room_revenue < 0 ? "bg-brick" : "bg-ink"}`}
                        style={{ width }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <DataTableFrame>
            <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-line">
              <div>
                <p className="text-xs uppercase tracking-wide text-slate">Pickup detail</p>
                <h3 className="font-display text-xl">By stay month and segment</h3>
              </div>
              <p className="text-xs text-slate">{byMonthSegment.length} rows</p>
            </div>
              <table className="w-full min-w-[620px] text-sm">
                <thead className="bg-sky-50 text-xs uppercase tracking-wide text-slate">
                  <tr>
                    <th className="px-4 py-2 text-left">Stay month</th>
                    <th className="px-4 py-2 text-left">Segment</th>
                    <th className="px-4 py-2 text-right">Room revenue</th>
                    <th className="px-4 py-2 text-right">VN</th>
                    <th className="px-4 py-2 text-right">Reservations</th>
                  </tr>
                </thead>
                <tbody>
                  {byMonthSegment.map((row) => (
                    <tr key={`${row.period_month}-${row.segment}`} className="border-t border-line/70 odd:bg-white/45">
                      <td className="px-4 py-2 whitespace-nowrap">{formatMonth(row.period_month)}</td>
                      <td className="px-4 py-2 whitespace-nowrap font-medium">{row.segment}</td>
                      <td className="px-4 py-2 text-right tabular-nums">{formatCurrency(row.room_revenue, currency)}</td>
                      <td className="px-4 py-2 text-right tabular-nums">{formatNumber(row.nights)}</td>
                      <td className="px-4 py-2 text-right tabular-nums">{row.reservation_count}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
          </DataTableFrame>
        </div>
      )}
    </section>
  );
}
