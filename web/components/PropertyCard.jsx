"use client";

import { LineChart, Line, ResponsiveContainer } from "recharts";

function formatCurrency(value, currency) {
  return new Intl.NumberFormat("en-LK", {
    style: "currency",
    currency: currency || "LKR",
    notation: "compact",
    maximumFractionDigits: 1
  }).format(value);
}

export default function PropertyCard({ property, lastIngestedAt }) {
  const delta = property.actual_revenue - property.budgeted_revenue;
  const deltaPct = property.budgeted_revenue ? (delta / property.budgeted_revenue) * 100 : 0;
  const isOverBudget = delta >= 0;

  const isStale =
    lastIngestedAt && Date.now() - new Date(lastIngestedAt).getTime() > 36 * 60 * 60 * 1000;

  const sparklineData = (property.trend || []).map((v, i) => ({ i, v }));

  return (
    <div className="border border-line rounded-xl p-5 bg-white/40">
      <div className="flex items-start justify-between mb-1">
        <div>
          <p className="font-medium text-ink">{property.property_name}</p>
          <p className="text-xs text-slate">{property.entity}</p>
        </div>
        {isStale && (
          <span className="text-xs px-2 py-0.5 rounded-full bg-brick/10 text-brick font-medium">
            stale
          </span>
        )}
      </div>

      <p className="font-display text-2xl font-medium tabular-nums mt-3">
        {formatCurrency(property.actual_revenue, property.currency)}
      </p>

      <div className="flex items-center justify-between mt-2">
        <span
          className={`text-xs font-medium tabular-nums ${isOverBudget ? "text-brass" : "text-brick"}`}
        >
          {isOverBudget ? "+" : ""}
          {deltaPct.toFixed(1)}% vs budget
        </span>
        <span className="text-xs text-slate tabular-nums">
          {property.reservation_count} reservations
        </span>
      </div>

      {sparklineData.length > 1 && (
        <div className="h-8 mt-3">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={sparklineData}>
              <Line
                type="monotone"
                dataKey="v"
                stroke="#B8924A"
                strokeWidth={1.5}
                dot={false}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}
