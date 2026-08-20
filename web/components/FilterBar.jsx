"use client";

import { useRouter, usePathname, useSearchParams } from "next/navigation";

const ENTITY_OPTIONS = [
  { value: "", label: "All entities" },
  { value: "CPG", label: "CPG" },
  { value: "OGH", label: "OGH" }
];

// Query-param-driven filters (?entity=CPG&month=2026-07), per the "still to
// wire up" item in the web README. Reads/writes the URL directly rather than
// component state, so the filtered view is shareable/bookmarkable and the
// server component (dashboard/page.js) stays the source of truth for what
// data gets fetched.
export default function FilterBar({ entity, month, hasCustomFilters }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  function updateParam(key, value) {
    const params = new URLSearchParams(searchParams.toString());
    if (value) {
      params.set(key, value);
    } else {
      params.delete(key);
    }
    const query = params.toString();
    router.push(query ? `${pathname}?${query}` : pathname);
  }

  return (
    <div className="flex items-center gap-3 mb-6 flex-wrap">
      <label className="flex items-center gap-2 text-sm text-slate">
        Entity
        <select
          value={entity || ""}
          onChange={(e) => updateParam("entity", e.target.value)}
          className="border border-line rounded-lg px-2 py-1 bg-white/60 text-ink text-sm"
        >
          {ENTITY_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </label>

      <label className="flex items-center gap-2 text-sm text-slate">
        Month
        <input
          type="month"
          value={month}
          onChange={(e) => updateParam("month", e.target.value)}
          className="border border-line rounded-lg px-2 py-1 bg-white/60 text-ink text-sm tabular-nums"
        />
      </label>

      {hasCustomFilters && (
        <button
          type="button"
          onClick={() => router.push(pathname)}
          className="text-xs text-slate underline underline-offset-2 hover:text-ink"
        >
          Reset filters
        </button>
      )}
    </div>
  );
}
