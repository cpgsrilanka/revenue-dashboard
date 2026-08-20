function formatCurrency(value, currency) {
  return new Intl.NumberFormat("en-LK", {
    style: "currency",
    currency: currency || "LKR",
    maximumFractionDigits: 0
  }).format(value);
}

export default function HeroKpi({ properties }) {
  const totalActual = properties.reduce((sum, p) => sum + p.actual_revenue, 0);
  const totalBudget = properties.reduce((sum, p) => sum + p.budgeted_revenue, 0);
  const deltaPct = totalBudget ? ((totalActual - totalBudget) / totalBudget) * 100 : 0;
  const currency = properties[0]?.currency || "LKR";

  return (
    <div className="border-b border-line pb-8 mb-8">
      <p className="text-sm text-slate mb-2">Group revenue, month to date</p>
      <div className="flex items-end gap-4 flex-wrap">
        <span className="font-display text-5xl md:text-6xl font-medium tabular-nums">
          {formatCurrency(totalActual, currency)}
        </span>
        <span
          className={`text-sm font-medium mb-2 tabular-nums ${
            deltaPct >= 0 ? "text-brass" : "text-brick"
          }`}
        >
          {deltaPct >= 0 ? "+" : ""}
          {deltaPct.toFixed(1)}% vs budget
        </span>
      </div>

      {/* Signature element: the tideline — a quiet nod to the coastal
          property names (Sands, Sol, ...) beneath the headline number. */}
      <div
        className="h-px mt-6 w-full"
        style={{
          background:
            "linear-gradient(90deg, transparent 0%, #B8924A 15%, #B8924A 85%, transparent 100%)"
        }}
        aria-hidden="true"
      />

      <div className="flex gap-8 mt-4 text-sm text-slate">
        <span>
          Budget: <span className="tabular-nums text-ink">{formatCurrency(totalBudget, currency)}</span>
        </span>
        <span>
          Properties reporting: <span className="tabular-nums text-ink">{properties.length}</span>
        </span>
      </div>
    </div>
  );
}
