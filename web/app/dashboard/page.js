import { redirect } from "next/navigation";
import HeroKpi from "@/components/HeroKpi";
import DataHealthPanel from "@/components/DataHealthPanel";
import DashboardFilters from "@/components/DashboardFilters";
import ComparisonTable from "@/components/ComparisonTable";
import DailyPickup from "@/components/DailyPickup";
import DashboardCharts from "@/components/DashboardCharts";
import RevenueMatrix from "@/components/RevenueMatrix";
import MetricCardGroup from "@/components/MetricCardGroup";
import CumulativeProgress from "@/components/CumulativeProgress";
import SignOutButton from "@/components/SignOutButton";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabaseClient";
import {
  getMonthlyRevenue,
  getOpenDataQualityFindings,
  getSegmentMatrixForRange,
  getBookingPickupForDate,
} from "@/lib/queries";
import { canonicalSegment, isTotalSegment } from "@/lib/segments";

function normalizeMonth(value) {
  if (typeof value === "string" && /^\d{4}-\d{2}$/.test(value)) return value;
  return new Date().toISOString().slice(0, 7);
}

function normalizeDate(value) {
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  return new Date().toISOString().slice(0, 10);
}

function normalizePeriodMode(value) {
  return value === "fy" || value === "ytd" ? value : "month";
}

function financialYearStartForMonth(month) {
  const [year, monthNumber] = month.split("-").map(Number);
  return monthNumber >= 4 ? year : year - 1;
}

function monthStartForDate(date) {
  return `${date.slice(0, 7)}-01`;
}

function financialYearEndForMonth(month) {
  const startYear = financialYearStartForMonth(month);
  return `${startYear + 1}-03-01`;
}

function normalizeFinancialYear(value, fallbackMonth) {
  const parsed = Number(value);
  if (Number.isInteger(parsed) && parsed >= 2020 && parsed <= 2035) return parsed;
  return financialYearStartForMonth(fallbackMonth);
}

function periodBounds({ mode, month, financialYear }) {
  if (mode === "fy") {
    return {
      start: `${financialYear}-04-01`,
      end: `${financialYear + 1}-03-01`,
    };
  }

  if (mode === "ytd") {
    const startYear = financialYearStartForMonth(month);
    return {
      start: `${startYear}-04-01`,
      end: `${month}-01`,
    };
  }

  return {
    start: `${month}-01`,
    end: `${month}-01`,
  };
}

function cumulativeBounds({ mode, month, financialYear }) {
  const startYear = mode === "fy" ? financialYear : financialYearStartForMonth(month);
  return {
    start: `${startYear}-04-01`,
    end: mode === "fy" ? `${startYear + 1}-03-01` : `${month}-01`,
  };
}

function formatMonthLabel(month) {
  return new Intl.DateTimeFormat("en-LK", { month: "long", year: "numeric", timeZone: "UTC" }).format(
    new Date(`${month}-01T00:00:00.000Z`)
  );
}

function formatPeriodLabel({ mode, month, financialYear }) {
  if (mode === "fy") return `FY ${financialYear}/${String(financialYear + 1).slice(-2)}`;
  if (mode === "ytd") return `YTD through ${formatMonthLabel(month)}`;
  return formatMonthLabel(month);
}

function numberValue(value) {
  return Number(value || 0);
}

function aggregateProperties(rows) {
  const byProperty = new Map();

  for (const row of rows) {
    const existing = byProperty.get(row.property_code) || {
      property_code: row.property_code,
      property_name: row.property_name,
      entity: row.entity,
      currency: row.currency || "LKR",
      actual_revenue: 0,
      reservation_count: 0,
      budgeted_revenue: null,
      room_revenue: 0,
      fnb_revenue: 0,
      total_booking_value: 0,
      actual_room_nights: 0,
    };

    existing.actual_revenue += numberValue(row.actual_revenue);
    existing.reservation_count += numberValue(row.reservation_count);
    existing.room_revenue += numberValue(row.room_revenue ?? row.actual_revenue);
    existing.fnb_revenue += numberValue(row.fnb_revenue);
    existing.total_booking_value += numberValue(row.total_booking_value);
    existing.actual_room_nights += numberValue(row.actual_room_nights);
    if (row.budgeted_revenue !== null && row.budgeted_revenue !== undefined) {
      existing.budgeted_revenue = numberValue(existing.budgeted_revenue) + numberValue(row.budgeted_revenue);
    }

    byProperty.set(row.property_code, existing);
  }

  return [...byProperty.values()];
}

function segmentOptionsFrom(rows) {
  return [...new Set(
    rows
      .map((row) => canonicalSegment(row.segment))
      .filter((segment) => segment && !isTotalSegment(segment))
  )].sort((a, b) => a.localeCompare(b));
}

function selectedSegmentsFrom(value, options) {
  if (typeof value !== "string" || value.trim() === "") return [];
  const allowed = new Set(options);
  return value
    .split(",")
    .map((segment) => segment.trim())
    .filter((segment) => allowed.has(segment));
}

function allocatePropertyLevelBudgets(rows) {
  const grouped = new Map();

  for (const row of rows) {
    const key = `${row.property_code}||${row.period_month}`;
    const group = grouped.get(key) || { total: null, segments: [] };

    if (isTotalSegment(row.segment)) {
      group.total = row;
    } else {
      group.segments.push(row);
    }

    grouped.set(key, group);
  }

  return [...grouped.values()].flatMap(({ total, segments }) => {
    const segmentBudgetRevenue = segments.reduce((sum, row) => sum + numberValue(row.budget_revenue), 0);
    const segmentBudgetNights = segments.reduce((sum, row) => sum + numberValue(row.budget_room_nights), 0);
    const totalBudgetRevenue = numberValue(total?.budget_revenue);
    const totalBudgetNights = numberValue(total?.budget_room_nights);

    if (!total || segmentBudgetRevenue > 0 || segmentBudgetNights > 0 || (totalBudgetRevenue === 0 && totalBudgetNights === 0)) {
      return segments;
    }

    const actualRevenueTotal = segments.reduce((sum, row) => sum + Math.max(0, numberValue(row.actual_revenue)), 0);
    const actualNightsTotal = segments.reduce((sum, row) => sum + Math.max(0, numberValue(row.actual_room_nights)), 0);
    const equalShare = segments.length ? 1 / segments.length : 0;

    return segments.map((row) => {
      const revenueShare = actualRevenueTotal
        ? Math.max(0, numberValue(row.actual_revenue)) / actualRevenueTotal
        : equalShare;
      const nightsShare = actualNightsTotal
        ? Math.max(0, numberValue(row.actual_room_nights)) / actualNightsTotal
        : revenueShare;
      const budgetRevenue = totalBudgetRevenue * revenueShare;
      const budgetNights = totalBudgetNights * nightsShare;
      const actualRevenue = numberValue(row.actual_revenue);
      const actualNights = numberValue(row.actual_room_nights);

      return {
        ...row,
        budget_revenue: budgetRevenue,
        budget_room_nights: budgetNights,
        budget_arr: budgetNights ? budgetRevenue / budgetNights : 0,
        balance_revenue: actualRevenue - budgetRevenue,
        balance_room_nights: actualNights - budgetNights,
      };
    });
  });
}

function normalizeSegments(rows) {
  return rows.map((row) => ({
    ...row,
    segment: canonicalSegment(row.segment),
  }));
}

function totalsFromMatrixRows(rows) {
  const total = rows.reduce(
    (sum, row) => ({
      currency: row.currency || sum.currency || "LKR",
      actualRevenue: sum.actualRevenue + numberValue(row.actual_revenue),
      budgetRevenue: sum.budgetRevenue + numberValue(row.budget_revenue),
      villaNights: sum.villaNights + numberValue(row.actual_room_nights),
    }),
    { currency: "LKR", actualRevenue: 0, budgetRevenue: 0, villaNights: 0 }
  );

  return {
    ...total,
    variance: total.actualRevenue - total.budgetRevenue,
    achievement: total.budgetRevenue ? (total.actualRevenue / total.budgetRevenue) * 100 : 0,
  };
}

function cumulativeFromPropertyRows(rows) {
  const byMonth = new Map();

  for (const row of rows) {
    const key = row.period_month;
    if (!key) continue;
    const existing = byMonth.get(key) || {
      period_month: key,
      currency: row.currency || "LKR",
      actual: 0,
      budget: 0,
    };
    existing.actual += numberValue(row.room_revenue ?? row.actual_revenue);
    existing.budget += numberValue(row.budgeted_revenue);
    byMonth.set(key, existing);
  }

  let cumulativeActual = 0;
  let cumulativeBudget = 0;
  let cumulativeVariance = 0;
  return [...byMonth.values()]
    .sort((a, b) => String(a.period_month).localeCompare(String(b.period_month)))
    .map((row) => {
      const variance = row.actual - row.budget;
      cumulativeActual += row.actual;
      cumulativeBudget += row.budget;
      cumulativeVariance += variance;
      return {
        ...row,
        variance,
        cumulativeActual,
        cumulativeBudget,
        cumulativeVariance,
      };
    });
}

export default async function DashboardPage({ searchParams = {} }) {
  // Belt-and-suspenders: middleware.js already redirects unauthenticated
  // visitors away from /dashboard, but checking again here means this
  // page is safe even if it's ever reached a different way (e.g. a
  // future server action, or middleware config drifting out of sync).
  let userEmail = null;
  let dataClient; // authenticated Supabase client when signed in, undefined otherwise (queries.js falls back to its own anon client)

  if (isSupabaseConfigured) {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      redirect("/login");
    }
    userEmail = user.email;
    dataClient = supabase;
  }

  const selectedMonth = normalizeMonth(searchParams.month);
  const periodMode = normalizePeriodMode(searchParams.period);
  const selectedFinancialYear = normalizeFinancialYear(searchParams.fy, selectedMonth);
  const selectedPickupDate = normalizeDate(searchParams.pickupDate);
  const period = periodBounds({
    mode: periodMode,
    month: selectedMonth,
    financialYear: selectedFinancialYear,
  });
  const cumulativePeriod = cumulativeBounds({
    mode: periodMode,
    month: selectedMonth,
    financialYear: selectedFinancialYear,
  });
  const pickupPeriodStart = monthStartForDate(selectedPickupDate);
  const pickupPeriodEnd = financialYearEndForMonth(pickupPeriodStart.slice(0, 7));
  const periodLabel = formatPeriodLabel({
    mode: periodMode,
    month: selectedMonth,
    financialYear: selectedFinancialYear,
  });
  const pickupWindowLabel = `${formatMonthLabel(pickupPeriodStart.slice(0, 7))} to ${formatMonthLabel(pickupPeriodEnd.slice(0, 7))}`;
  const cumulativePeriodLabel =
    periodMode === "month" ? `FY-to-date through ${periodLabel}` : periodLabel;

  const [
    allProperties,
    allFindings,
    allMatrixRows,
    allPickupRows,
    cumulativeProperties,
  ] = await Promise.all([
    getMonthlyRevenue(period.start, period.end, dataClient),
    getOpenDataQualityFindings(dataClient),
    getSegmentMatrixForRange(period.start, period.end, dataClient),
    getBookingPickupForDate(selectedPickupDate, pickupPeriodStart, pickupPeriodEnd, dataClient),
    getMonthlyRevenue(cumulativePeriod.start, cumulativePeriod.end, dataClient),
  ]);

  const propertyRows = aggregateProperties(allProperties);
  const selectedProperty = propertyRows.some(
    (property) => property.property_code === searchParams.property
  )
    ? searchParams.property
    : "all";
  const properties =
    selectedProperty === "all"
      ? propertyRows
      : propertyRows.filter((property) => property.property_code === selectedProperty);
  const visiblePropertyCodes = new Set(properties.map((property) => property.property_code));
  const findings = allFindings.filter((finding) => visiblePropertyCodes.has(finding.property_code));
  const visibleMatrixRows = allocatePropertyLevelBudgets(
    normalizeSegments(allMatrixRows.filter((row) => visiblePropertyCodes.has(row.property_code)))
  );
  const pickupPropertyRows = normalizeSegments(
    allPickupRows.filter((row) => visiblePropertyCodes.has(row.property_code))
  );
  const segmentOptions = segmentOptionsFrom([...visibleMatrixRows, ...pickupPropertyRows]);
  const selectedSegments = selectedSegmentsFrom(searchParams.segments, segmentOptions);
  const matrixRows =
    selectedSegments.length === 0
      ? visibleMatrixRows
      : visibleMatrixRows.filter((row) => selectedSegments.includes(row.segment));
  const currentFilterTotals = totalsFromMatrixRows(matrixRows);
  const cumulativeRows = cumulativeFromPropertyRows(
    cumulativeProperties.filter((row) => visiblePropertyCodes.has(row.property_code))
  );
  const pickupRows =
    selectedSegments.length === 0
      ? pickupPropertyRows
      : pickupPropertyRows.filter((row) =>
          selectedSegments.includes(canonicalSegment(row.segment))
        );
  const propertyLabel =
    selectedProperty === "all"
      ? "All properties"
      : properties[0]?.property_name || selectedProperty;
  const segmentScopeLabel =
    selectedSegments.length === 0 ? "All segments" : selectedSegments.join(", ");
  const filterScopeLabel = `${propertyLabel} / ${segmentScopeLabel}`;

  return (
    <main className="max-w-5xl mx-auto px-6 py-10">
      <div className="flex items-center justify-between mb-8">
        <p className="font-display text-lg">Revenue dashboard</p>
        <div className="flex items-center gap-4">
          <p className="text-xs text-slate">
            {periodLabel}
          </p>
          {userEmail && (
            <div className="flex items-center gap-2 text-xs text-slate">
              <span>{userEmail}</span>
              <SignOutButton />
            </div>
          )}
        </div>
      </div>

      <DashboardFilters
        month={selectedMonth}
        periodMode={periodMode}
        financialYear={selectedFinancialYear}
        pickupDate={selectedPickupDate}
        selectedProperty={selectedProperty}
        propertyOptions={propertyRows}
        segmentOptions={segmentOptions}
        selectedSegments={selectedSegments}
      />

      <HeroKpi properties={properties} periodLabel={periodLabel} />
      <DailyPickup rows={pickupRows} pickupDate={selectedPickupDate} pickupWindowLabel={pickupWindowLabel} />
      {selectedSegments.length > 0 && (
        <MetricCardGroup
          eyebrow="Current filter"
          title="Segment-filter snapshot"
          caption={`Honours property, period and segment filters: ${filterScopeLabel}. Room revenue includes taxes. FNB is not split by segment in the source data yet.`}
          currency={currentFilterTotals.currency}
          items={[
            { label: "Room revenue", value: currentFilterTotals.actualRevenue },
            { label: "Budget", value: currentFilterTotals.budgetRevenue },
            {
              label: "Variance",
              value: currentFilterTotals.variance,
              intent: currentFilterTotals.variance >= 0 ? "good" : "bad",
            },
            { label: "Villa nights", value: currentFilterTotals.villaNights, format: "number" },
          ]}
        />
      )}
      <CumulativeProgress
        rows={cumulativeRows}
        periodLabel={cumulativePeriodLabel}
        scopeLabel={`${propertyLabel}, all segments`}
        note={
          selectedSegments.length === 0
            ? "Excel-style overall monthly summary."
            : "Overall only; segment filters stay in the segment table."
        }
      />
      <RevenueMatrix rows={matrixRows} propertyLabel={propertyLabel} />
      <DashboardCharts properties={properties} segmentRows={matrixRows} />
      <ComparisonTable properties={properties} />

      <details className="border-t border-line pt-5">
        <summary className="cursor-pointer text-sm font-medium text-ink">
          Admin data health
        </summary>
        <div className="mt-4">
          <DataHealthPanel findings={findings} />
        </div>
      </details>
    </main>
  );
}
