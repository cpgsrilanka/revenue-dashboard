import { isTotalSegment } from "@/lib/segments";
import DataTableFrame from "./DataTableFrame";
import SectionHeader from "./SectionHeader";

function numberValue(value) {
  return Number(value || 0);
}

function formatCurrency(value, currency = "LKR") {
  return new Intl.NumberFormat("en-LK", {
    style: "currency",
    currency,
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(numberValue(value));
}

function formatNumber(value) {
  return new Intl.NumberFormat("en-LK", {
    maximumFractionDigits: 0,
  }).format(numberValue(value));
}

function aggregateBySegment(rows) {
  const bySegment = new Map();

  for (const row of rows) {
    if (isTotalSegment(row.segment)) continue;

    const existing = bySegment.get(row.segment) || {
      segment: row.segment,
      currency: row.currency || "LKR",
      budget_revenue: 0,
      budget_room_nights: 0,
      actual_revenue: 0,
      actual_room_nights: 0,
      balance_revenue: 0,
      balance_room_nights: 0,
    };

    existing.budget_revenue += numberValue(row.budget_revenue);
    existing.budget_room_nights += numberValue(row.budget_room_nights);
    existing.actual_revenue += numberValue(row.actual_revenue);
    existing.actual_room_nights += numberValue(row.actual_room_nights);
    existing.balance_revenue += numberValue(row.balance_revenue);
    existing.balance_room_nights += numberValue(row.balance_room_nights);
    bySegment.set(row.segment, existing);
  }

  return [...bySegment.values()].map((row) => ({
    ...row,
    budget_arr: row.budget_room_nights ? row.budget_revenue / row.budget_room_nights : 0,
    actual_arr: row.actual_room_nights ? row.actual_revenue / row.actual_room_nights : 0,
  }));
}

function totalsFor(rows) {
  const total = rows.reduce(
    (sum, row) => ({
      budget_revenue: sum.budget_revenue + numberValue(row.budget_revenue),
      budget_room_nights: sum.budget_room_nights + numberValue(row.budget_room_nights),
      actual_revenue: sum.actual_revenue + numberValue(row.actual_revenue),
      actual_room_nights: sum.actual_room_nights + numberValue(row.actual_room_nights),
      balance_revenue: sum.balance_revenue + numberValue(row.balance_revenue),
      balance_room_nights: sum.balance_room_nights + numberValue(row.balance_room_nights),
    }),
    {
      budget_revenue: 0,
      budget_room_nights: 0,
      actual_revenue: 0,
      actual_room_nights: 0,
      balance_revenue: 0,
      balance_room_nights: 0,
    }
  );

  return {
    ...total,
    budget_arr: total.budget_room_nights ? total.budget_revenue / total.budget_room_nights : 0,
    actual_arr: total.actual_room_nights ? total.actual_revenue / total.actual_room_nights : 0,
  };
}

function achievement(actual, budget) {
  return budget ? (actual / budget) * 100 : 0;
}

export default function RevenueMatrix({ rows, propertyLabel }) {
  const matrixRows = aggregateBySegment(rows);
  const totals = totalsFor(matrixRows);
  const currency = matrixRows[0]?.currency || "LKR";

  if (matrixRows.length === 0) {
    return (
      <section className="border border-line rounded-lg bg-white/50 p-5 mb-8">
        <SectionHeader
          eyebrow="Segment performance"
          title="Budget, actual and balance"
          subtitle="Room revenue includes taxes."
          action={propertyLabel}
        />
        <p className="text-sm text-slate">
          Segment performance will appear after the operational-truth upgrade is run and the import refreshes the bookings.
        </p>
      </section>
    );
  }

  return (
    <section className="mb-8">
      <SectionHeader
        eyebrow="Segment performance"
        title="Budget, actual and balance"
        subtitle="Clean booking-row actuals by segment. Room revenue includes taxes."
        action={propertyLabel}
      />

      <DataTableFrame>
        <table className="w-full min-w-[920px] border-collapse text-sm">
          <thead>
            <tr className="text-center">
              <th className="border-b border-r border-line bg-white px-3 py-2 text-left" />
              <th colSpan={3} className="border-b border-r border-line bg-sky-100 px-3 py-2 font-semibold">
                Budget 26/27
              </th>
              <th colSpan={3} className="border-b border-r border-line bg-blue-100 px-3 py-2 font-semibold">
                Actual 26/27
              </th>
              <th colSpan={2} className="border-b border-line bg-rose-100 px-3 py-2 font-semibold">
                Balance To Earn
              </th>
            </tr>
            <tr className="text-xs uppercase text-slate">
              <th className="border-b border-r border-line px-3 py-2 text-left">Segment</th>
              <th className="border-b border-r border-line px-3 py-2 text-right">Revenue</th>
              <th className="border-b border-r border-line px-3 py-2 text-right">Villa nights</th>
              <th className="border-b border-r border-line px-3 py-2 text-right">Budget ARR</th>
              <th className="border-b border-r border-line px-3 py-2 text-right">Revenue</th>
              <th className="border-b border-r border-line px-3 py-2 text-right">Villa nights</th>
              <th className="border-b border-r border-line px-3 py-2 text-right">Actual ARR</th>
              <th className="border-b border-r border-line px-3 py-2 text-right">Revenue</th>
              <th className="border-b border-line px-3 py-2 text-right">VN</th>
            </tr>
          </thead>
          <tbody>
            {matrixRows.map((row) => (
              <tr key={row.segment} className="odd:bg-white/50">
                <td className="border-b border-r border-line px-3 py-2 font-medium">{row.segment}</td>
                <td className="border-b border-r border-line px-3 py-2 text-right tabular-nums">
                  {formatCurrency(row.budget_revenue, currency)}
                </td>
                <td className="border-b border-r border-line px-3 py-2 text-right tabular-nums">
                  {formatNumber(row.budget_room_nights)}
                </td>
                <td className="border-b border-r border-line px-3 py-2 text-right tabular-nums">
                  {formatCurrency(row.budget_arr, currency)}
                </td>
                <td className="border-b border-r border-line px-3 py-2 text-right tabular-nums">
                  {formatCurrency(row.actual_revenue, currency)}
                </td>
                <td className="border-b border-r border-line px-3 py-2 text-right tabular-nums">
                  {formatNumber(row.actual_room_nights)}
                </td>
                <td className="border-b border-r border-line px-3 py-2 text-right tabular-nums">
                  {formatCurrency(row.actual_arr, currency)}
                </td>
                <td
                  className={`border-b border-r border-line px-3 py-2 text-right tabular-nums ${
                    row.balance_revenue < 0 ? "text-brick" : "text-brass"
                  }`}
                >
                  {formatCurrency(row.balance_revenue, currency)}
                </td>
                <td
                  className={`border-b border-line px-3 py-2 text-right tabular-nums ${
                    row.balance_room_nights < 0 ? "text-brick" : "text-brass"
                  }`}
                >
                  {formatNumber(row.balance_room_nights)}
                </td>
              </tr>
            ))}
            <tr className="bg-sky-100 font-semibold">
              <td className="border-r border-line px-3 py-2">Grand Total</td>
              <td className="border-r border-line px-3 py-2 text-right tabular-nums">
                {formatCurrency(totals.budget_revenue, currency)}
              </td>
              <td className="border-r border-line px-3 py-2 text-right tabular-nums">
                {formatNumber(totals.budget_room_nights)}
              </td>
              <td className="border-r border-line px-3 py-2 text-right tabular-nums">
                {formatCurrency(totals.budget_arr, currency)}
              </td>
              <td className="border-r border-line px-3 py-2 text-right tabular-nums">
                {formatCurrency(totals.actual_revenue, currency)}
              </td>
              <td className="border-r border-line px-3 py-2 text-right tabular-nums">
                {formatNumber(totals.actual_room_nights)}
              </td>
              <td className="border-r border-line px-3 py-2 text-right tabular-nums">
                {formatCurrency(totals.actual_arr, currency)}
              </td>
              <td className="border-r border-line px-3 py-2 text-right tabular-nums">
                {formatCurrency(totals.balance_revenue, currency)}
              </td>
              <td className="px-3 py-2 text-right tabular-nums">
                {formatNumber(totals.balance_room_nights)}
              </td>
            </tr>
          </tbody>
        </table>
      </DataTableFrame>

      <div className="mt-4">
        <p className="text-xs uppercase tracking-wide text-slate mb-2">Achievement metrics</p>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="rounded-lg border border-line bg-green-50 px-4 py-3">
            <span className="block text-xs uppercase tracking-wide text-slate">RN Achievement</span>
            <strong className="mt-1 block text-xl font-display tabular-nums">
              {achievement(totals.actual_room_nights, totals.budget_room_nights).toFixed(1)}%
            </strong>
          </div>
          <div className="rounded-lg border border-line bg-green-50 px-4 py-3">
            <span className="block text-xs uppercase tracking-wide text-slate">Revenue Achievement</span>
            <strong className="mt-1 block text-xl font-display tabular-nums">
              {achievement(totals.actual_revenue, totals.budget_revenue).toFixed(1)}%
            </strong>
          </div>
          <div className="rounded-lg border border-line bg-green-50 px-4 py-3">
            <span className="block text-xs uppercase tracking-wide text-slate">ARR Achievement</span>
            <strong className="mt-1 block text-xl font-display tabular-nums">
              {achievement(totals.actual_arr, totals.budget_arr).toFixed(1)}%
            </strong>
          </div>
        </div>
      </div>
    </section>
  );
}
