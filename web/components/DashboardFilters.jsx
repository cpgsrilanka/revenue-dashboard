"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";

export default function DashboardFilters({
  month,
  periodMode,
  financialYear,
  pickupDate,
  selectedProperty,
  propertyOptions,
  segmentOptions,
  selectedSegments,
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  function updateFilter(updates) {
    const params = new URLSearchParams(searchParams.toString());

    for (const [key, value] of Object.entries(updates)) {
      if (!value || value === "all") {
        params.delete(key);
      } else {
        params.set(key, value);
      }
    }

    const query = params.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  }

  function toggleSegment(segment) {
    const selected = new Set(selectedSegments);
    if (selected.has(segment)) {
      selected.delete(segment);
    } else {
      selected.add(segment);
    }
    updateFilter({ segments: [...selected].join(",") || "all" });
  }

  return (
    <div className="mb-8 space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <label className="text-xs text-slate">
            <span className="block mb-1">Period</span>
            <select
              value={periodMode}
              onChange={(event) => updateFilter({ period: event.target.value })}
              className="h-9 w-full rounded-lg border border-line bg-white/70 px-3 text-sm text-ink"
            >
              <option value="month">Month</option>
              <option value="ytd">Year to date</option>
              <option value="fy">Financial year</option>
            </select>
          </label>

          {periodMode === "fy" ? (
            <label className="text-xs text-slate">
              <span className="block mb-1">Financial year</span>
              <select
                value={financialYear}
                onChange={(event) => updateFilter({ fy: event.target.value })}
                className="h-9 w-full rounded-lg border border-line bg-white/70 px-3 text-sm text-ink"
              >
                {[2025, 2026, 2027].map((year) => (
                  <option key={year} value={year}>
                    FY {year}/{String(year + 1).slice(-2)}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <label className="text-xs text-slate">
              <span className="block mb-1">{periodMode === "ytd" ? "Through month" : "Month"}</span>
              <input
                type="month"
                value={month}
                onChange={(event) => updateFilter({ month: event.target.value })}
                className="h-9 w-full rounded-lg border border-line bg-white/70 px-3 text-sm text-ink"
              />
            </label>
          )}

          <label className="text-xs text-slate">
            <span className="block mb-1">Pickup date</span>
            <input
              type="date"
              value={pickupDate}
              onChange={(event) => updateFilter({ pickupDate: event.target.value })}
              className="h-9 w-full rounded-lg border border-line bg-white/70 px-3 text-sm text-ink"
            />
          </label>

          <label className="text-xs text-slate">
            <span className="block mb-1">Property</span>
            <select
              value={selectedProperty}
              onChange={(event) => updateFilter({ property: event.target.value })}
              className="h-9 w-full rounded-lg border border-line bg-white/70 px-3 text-sm text-ink"
            >
              <option value="all">All properties</option>
              {propertyOptions.map((property) => (
                <option key={property.property_code} value={property.property_code}>
                  {property.property_name}
                </option>
              ))}
            </select>
          </label>
      </div>

      {segmentOptions.length > 0 && (
        <div className="border border-line rounded-lg bg-white/50 p-3">
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => updateFilter({ segments: "all" })}
              className={`h-8 rounded-md border px-3 text-xs font-medium ${
                selectedSegments.length === 0
                  ? "border-ink bg-ink text-paper"
                  : "border-line bg-white/70 text-slate hover:text-ink"
              }`}
            >
              All segments
            </button>
            {segmentOptions.map((segment) => {
              const active = selectedSegments.includes(segment);
              return (
                <label
                  key={segment}
                  className={`inline-flex h-8 cursor-pointer items-center gap-2 rounded-md border px-3 text-xs font-medium ${
                    active ? "border-brass bg-brass/15 text-ink" : "border-line bg-white/70 text-slate"
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={active}
                    onChange={() => toggleSegment(segment)}
                    className="h-3.5 w-3.5 accent-ink"
                  />
                  {segment}
                </label>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
