import SectionHeader from "./SectionHeader";

function formatCurrency(value, currency) {
  return new Intl.NumberFormat("en-LK", {
    style: "currency",
    currency: currency || "LKR",
    maximumFractionDigits: 0
  }).format(value);
}

function formatCompactCurrency(value, currency) {
  return new Intl.NumberFormat("en-LK", {
    style: "currency",
    currency: currency || "LKR",
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value);
}

function formatNumber(value) {
  return new Intl.NumberFormat("en-LK", {
    maximumFractionDigits: 0,
  }).format(value);
}

export default function HeroKpi({ properties, periodLabel }) {
  const totalActual = properties.reduce((sum, p) => sum + Number((p.room_revenue ?? p.actual_revenue) || 0), 0);
  const budgetedProperties = properties.filter((p) => p.budgeted_revenue !== null && p.budgeted_revenue !== undefined);
  const totalBudget = budgetedProperties.reduce((sum, p) => sum + Number(p.budgeted_revenue || 0), 0);
  const hasBudget = budgetedProperties.length > 0;
  const variance = totalActual - totalBudget;
  const deltaPct = totalBudget ? ((totalActual - totalBudget) / totalBudget) * 100 : 0;
  const currency = properties[0]?.currency || "LKR";
  const villaNights = properties.reduce((sum, p) => sum + Number(p.actual_room_nights || 0), 0);
  const arr = villaNights ? totalActual / villaNights : 0;
  const fnbRevenue = properties.reduce((sum, p) => sum + Number(p.fnb_revenue || 0), 0);
  const totalBookingValue = properties.reduce(
    (sum, p) => sum + Number(p.total_booking_value || Number((p.room_revenue ?? p.actual_revenue) || 0) + Number(p.fnb_revenue || 0)),
    0
  );

  return (
    <section className="border-b border-line pb-8 mb-8">
      <SectionHeader
        eyebrow="Revenue summary"
        title={periodLabel}
        subtitle="Room revenue includes taxes. FNB is tracked separately from room revenue."
      />
      <p className="text-sm text-slate mb-2">Room revenue</p>
      <div className="flex items-end gap-4 flex-wrap">
        <span className="font-display text-5xl md:text-6xl font-medium tabular-nums">
          {formatCurrency(totalActual, currency)}
        </span>
        {hasBudget ? (
          <span
            className={`text-sm font-medium mb-2 tabular-nums ${
              deltaPct >= 0 ? "text-brass" : "text-brick"
            }`}
          >
            {deltaPct >= 0 ? "+" : ""}
            {deltaPct.toFixed(1)}% vs budget
          </span>
        ) : (
          <span className="text-sm font-medium mb-2 text-slate">Budget pending</span>
        )}
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

      <div className="flex gap-8 mt-4 mb-5 text-sm text-slate">
        <span>
          Budget:{" "}
          <span className="tabular-nums text-ink">
            {hasBudget ? formatCurrency(totalBudget, currency) : "Pending"}
          </span>
        </span>
        <span>
          Properties reporting: <span className="tabular-nums text-ink">{properties.length}</span>
        </span>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-px border border-line rounded-lg overflow-hidden bg-line">
        <div className="bg-white/60 px-5 py-4">
          <p className="text-xs uppercase tracking-wide text-slate">Budget</p>
          <p className="font-display text-2xl mt-1 tabular-nums">
            {hasBudget ? formatCompactCurrency(totalBudget, currency) : "Pending"}
          </p>
        </div>
        <div className="bg-white/60 px-5 py-4">
          <p className="text-xs uppercase tracking-wide text-slate">Variance</p>
          <p className={`font-display text-2xl mt-1 tabular-nums ${variance >= 0 ? "text-brass" : "text-brick"}`}>
            {hasBudget ? formatCompactCurrency(variance, currency) : "Pending"}
          </p>
        </div>
        <div className="bg-white/60 px-5 py-4">
          <p className="text-xs uppercase tracking-wide text-slate">Villa nights</p>
          <p className="font-display text-2xl mt-1 tabular-nums">{formatNumber(villaNights)}</p>
        </div>
        <div className="bg-white/60 px-5 py-4">
          <p className="text-xs uppercase tracking-wide text-slate">ARR</p>
          <p className="font-display text-2xl mt-1 tabular-nums">{formatCompactCurrency(arr, currency)}</p>
        </div>
        <div className="bg-white/60 px-5 py-4">
          <p className="text-xs uppercase tracking-wide text-slate">Meal / FNB charges</p>
          <p className="font-display text-2xl mt-1 tabular-nums">{formatCompactCurrency(fnbRevenue, currency)}</p>
        </div>
        <div className="bg-white/60 px-5 py-4">
          <p className="text-xs uppercase tracking-wide text-slate">Total booking value</p>
          <p className="font-display text-2xl mt-1 tabular-nums">{formatCompactCurrency(totalBookingValue, currency)}</p>
        </div>
      </div>
    </section>
  );
}
