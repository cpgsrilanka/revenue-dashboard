import DataTableFrame from "./DataTableFrame";
import SectionHeader from "./SectionHeader";

function numberValue(value) {
  return Number(value || 0);
}

function formatCurrency(value, currency) {
  return new Intl.NumberFormat("en-LK", {
    style: "currency",
    currency: currency || "LKR",
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(numberValue(value));
}

function formatPercent(value) {
  if (value === null) return "Pending";
  return `${value >= 0 ? "+" : ""}${value.toFixed(1)}%`;
}

export default function ComparisonTable({ properties }) {
  const rows = [...properties]
    .map((property) => {
      const actual = numberValue(property.actual_revenue);
      const budget =
        property.budgeted_revenue === null || property.budgeted_revenue === undefined
          ? null
          : numberValue(property.budgeted_revenue);
      const variance = budget === null ? null : actual - budget;
      const variancePct = budget ? (variance / budget) * 100 : budget === null ? null : 0;

      return {
        ...property,
        actual,
        budget,
        variance,
        variancePct,
      };
    })
    .sort((a, b) => b.actual - a.actual);

  if (rows.length === 0) {
    return (
      <section className="border-y border-line py-6 mb-8">
        <p className="text-sm text-slate">No live data for this filter yet.</p>
      </section>
    );
  }

  return (
    <section className="mb-8">
      <SectionHeader
        eyebrow="Property comparison"
        title="Actual vs budget by property"
        subtitle="Room revenue includes taxes. Use this table for property-level comparison."
        action={<span className="tabular-nums">{rows.length} properties</span>}
      />

      <DataTableFrame>
        <table className="w-full min-w-[680px] text-left text-sm">
          <thead className="bg-sky-50 text-xs uppercase tracking-wide text-slate">
            <tr className="border-b border-line">
              <th className="py-3 pl-4 pr-4 font-medium">Property</th>
              <th className="py-3 px-4 font-medium text-right">Actual</th>
              <th className="py-3 px-4 font-medium text-right">Budget</th>
              <th className="py-3 px-4 font-medium text-right">Variance</th>
              <th className="py-3 px-4 font-medium text-right">Variance %</th>
              <th className="py-3 px-4 font-medium text-right">Reservations</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const isOverBudget = (row.variance || 0) >= 0;
              return (
                <tr key={row.property_code} className="border-b border-line/70 odd:bg-white/45 last:border-0">
                  <td className="py-3 pl-4 pr-4">
                    <span className="block font-medium text-ink">{row.property_name}</span>
                    <span className="block text-xs text-slate">{row.entity}</span>
                  </td>
                  <td className="py-3 px-4 text-right tabular-nums">
                    {formatCurrency(row.actual, row.currency)}
                  </td>
                  <td className="py-3 px-4 text-right tabular-nums">
                    {row.budget === null ? "Pending" : formatCurrency(row.budget, row.currency)}
                  </td>
                  <td
                    className={`py-3 px-4 text-right tabular-nums ${
                      row.variance === null ? "text-slate" : isOverBudget ? "text-brass" : "text-brick"
                    }`}
                  >
                    {row.variance === null ? "Pending" : formatCurrency(row.variance, row.currency)}
                  </td>
                  <td
                    className={`py-3 px-4 text-right tabular-nums ${
                      row.variancePct === null ? "text-slate" : isOverBudget ? "text-brass" : "text-brick"
                    }`}
                  >
                    {formatPercent(row.variancePct)}
                  </td>
                  <td className="py-3 px-4 text-right tabular-nums">
                    {row.reservation_count}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </DataTableFrame>
    </section>
  );
}
