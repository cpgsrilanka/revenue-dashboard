"use client";

import { canonicalSegment, isTotalSegment } from "@/lib/segments";
import SectionHeader from "./SectionHeader";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

const SEGMENT_COLORS = ["#12302B", "#B8924A", "#C1544A", "#3F7D6B", "#6B7280", "#8A6F3E", "#2F5D7C"];

function numberValue(value) {
  return Number(value || 0);
}

function formatCompact(value, currency = "LKR") {
  return new Intl.NumberFormat("en-LK", {
    style: "currency",
    currency,
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(numberValue(value));
}

function aggregateSegments(rows) {
  const bySegment = new Map();

  for (const row of rows) {
    const segment = canonicalSegment(row.segment);
    if (isTotalSegment(segment)) continue;

    const existing = bySegment.get(segment) || {
      segment,
      actual_revenue: 0,
    };
    existing.actual_revenue += Math.max(0, numberValue(row.actual_revenue));
    bySegment.set(segment, existing);
  }

  return [...bySegment.values()]
    .filter((row) => row.actual_revenue > 0)
    .sort((a, b) => b.actual_revenue - a.actual_revenue);
}

export default function DashboardCharts({ properties, segmentRows }) {
  const currency = properties[0]?.currency || segmentRows[0]?.currency || "LKR";
  const propertyData = properties
    .map((property) => ({
      name: property.property_name,
      actual: numberValue(property.actual_revenue),
      budget: numberValue(property.budgeted_revenue),
    }))
    .filter((row) => row.actual > 0 || row.budget > 0)
    .sort((a, b) => b.actual - a.actual);
  const segmentData = aggregateSegments(segmentRows);

  if (propertyData.length === 0 && segmentData.length === 0) return null;

  return (
    <section className="mb-8">
      <SectionHeader
        eyebrow="Revenue mix"
        title="Property and segment view"
        subtitle="Room revenue includes taxes. Use this section to compare where revenue is coming from."
      />
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="border border-line rounded-lg bg-white/55 p-5">
          <div className="mb-4">
            <p className="text-xs uppercase tracking-wide text-slate">Property view</p>
            <h3 className="font-display text-xl">Actual vs budget</h3>
          </div>
        {propertyData.length === 0 ? (
          <p className="text-sm text-slate">No property revenue for this filter.</p>
        ) : (
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={propertyData} margin={{ top: 8, right: 8, left: 0, bottom: 32 }}>
                <CartesianGrid stroke="#E8E0D2" vertical={false} />
                <XAxis dataKey="name" tick={{ fontSize: 11, fill: "#445A56" }} angle={-20} textAnchor="end" height={52} />
                <YAxis tick={{ fontSize: 11, fill: "#445A56" }} tickFormatter={(value) => formatCompact(value, currency)} width={68} />
                <Tooltip formatter={(value) => formatCompact(value, currency)} cursor={{ fill: "#F4EFE6" }} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Bar dataKey="actual" name="Actual" fill="#12302B" radius={[4, 4, 0, 0]} />
                <Bar dataKey="budget" name="Budget" fill="#B8924A" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
        </div>

        <div className="border border-line rounded-lg bg-white/55 p-5">
          <div className="mb-4">
            <p className="text-xs uppercase tracking-wide text-slate">Segment view</p>
            <h3 className="font-display text-xl">Room revenue mix</h3>
          </div>
        {segmentData.length === 0 ? (
          <p className="text-sm text-slate">No segment revenue for this filter.</p>
        ) : (
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Tooltip formatter={(value) => formatCompact(value, currency)} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Pie
                  data={segmentData}
                  dataKey="actual_revenue"
                  nameKey="segment"
                  innerRadius="48%"
                  outerRadius="78%"
                  paddingAngle={2}
                >
                  {segmentData.map((entry, index) => (
                    <Cell key={entry.segment} fill={SEGMENT_COLORS[index % SEGMENT_COLORS.length]} />
                  ))}
                </Pie>
              </PieChart>
            </ResponsiveContainer>
          </div>
        )}
        </div>
      </div>
    </section>
  );
}
