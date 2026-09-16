import { supabase as anonClient, isSupabaseConfigured } from "./supabaseClient";
import { mockMonthlyRevenue, mockDataQualityLog, mockLastIngested } from "./mockData";

// Every function here falls back to mock data only when Supabase isn't
// configured, or if a live query errors. Once Supabase is connected, an empty
// result means "no live data for that filter", not "show sample data".
//
// Each function takes an optional `client` — pass the authenticated
// server client from lib/supabase/server.js when calling from a Server
// Component behind the /dashboard auth wall, so Row Level Security applies
// as the signed-in user rather than as an anonymous request. Falls back to
// the plain anon client if none is passed (keeps this usable in contexts
// without a session, e.g. local scripts).

export async function getMonthlyRevenue(periodStart, periodEnd = periodStart, client = anonClient) {
  if (periodEnd && typeof periodEnd === "object" && typeof periodEnd.from === "function") {
    client = periodEnd;
    periodEnd = periodStart;
  }

  if (!isSupabaseConfigured) return mockMonthlyRevenue;

  const { data, error } = await client
    .from("v_monthly_revenue")
    .select("*")
    .gte("period_month", periodStart)
    .lte("period_month", periodEnd);

  if (error) {
    console.error("getMonthlyRevenue failed, falling back to mock data:", error.message);
    return mockMonthlyRevenue;
  }

  return data || [];
}

export async function getSegmentMatrix(periodMonth, client = anonClient) {
  return getSegmentMatrixForRange(periodMonth, periodMonth, client);
}

export async function getSegmentMatrixForRange(periodStart, periodEnd = periodStart, client = anonClient) {
  if (periodEnd && typeof periodEnd === "object" && typeof periodEnd.from === "function") {
    client = periodEnd;
    periodEnd = periodStart;
  }

  if (!isSupabaseConfigured) return [];

  const { data, error } = await client
    .from("v_monthly_segment_revenue")
    .select("*")
    .gte("period_month", periodStart)
    .lte("period_month", periodEnd)
    .order("segment", { ascending: true });

  if (error) {
    console.error("getSegmentMatrix failed:", error.message);
    return [];
  }

  return data || [];
}

export async function getDailyPickup(periodMonth, client = anonClient) {
  return getDailyPickupForRange(periodMonth, periodMonth, null, client);
}

export async function getBookingPickupForDate(pickupDate, periodStart, periodEnd, client = anonClient) {
  if (!isSupabaseConfigured || !pickupDate) return [];

  const query = client
    .from("clean_reservations")
    .select("property_code,period_month,booking_date,pickup_date,room_revenue,fnb_revenue,total_revenue,nights,segment,currency,reservation_id,status")
    .eq("pickup_date", pickupDate)
    .eq("is_quarantined", false)
    .gte("period_month", periodStart)
    .lte("period_month", periodEnd)
    .order("period_month", { ascending: true })
    .order("segment", { ascending: true });

  const { data, error } = await query;

  if (error && error.message?.includes("pickup_date")) {
    console.warn("pickup_date column is not active yet; falling back to booking_date. Run db/pickup-date-basis.sql and ingestion to match Excel pickup slicers.");
    return getBookingPickupForDateLegacy(pickupDate, periodStart, periodEnd, client);
  }

  if (error) {
    console.error("getBookingPickupForDate failed:", error.message);
    return [];
  }

  return data || [];
}

async function getBookingPickupForDateLegacy(pickupDate, periodStart, periodEnd, client = anonClient) {
  const { data, error } = await client
    .from("clean_reservations")
    .select("property_code,period_month,booking_date,room_revenue,fnb_revenue,total_revenue,nights,segment,currency,reservation_id,status")
    .eq("booking_date", pickupDate)
    .eq("is_quarantined", false)
    .gte("period_month", periodStart)
    .lte("period_month", periodEnd)
    .order("period_month", { ascending: true })
    .order("segment", { ascending: true });

  if (error) {
    console.error("getBookingPickupForDate legacy fallback failed:", error.message);
    return [];
  }

  return data || [];
}

export async function getDailyPickupForRange(periodStart, periodEnd = periodStart, pickupDate = null, client = anonClient) {
  if (periodEnd && typeof periodEnd === "object" && typeof periodEnd.from === "function") {
    client = periodEnd;
    periodEnd = periodStart;
    pickupDate = null;
  }
  if (pickupDate && typeof pickupDate === "object" && typeof pickupDate.from === "function") {
    client = pickupDate;
    pickupDate = null;
  }

  if (!isSupabaseConfigured) return [];

  const query = client
    .from("revenue_snapshot")
    .select("property_code,period_month,snapshot_date,actual_revenue,reservation_count,currency,updated_at")
    .gte("period_month", periodStart)
    .lte("period_month", periodEnd)
    .order("property_code", { ascending: true })
    .order("period_month", { ascending: true })
    .order("snapshot_date", { ascending: false })
    .order("updated_at", { ascending: false });

  const { data, error } = await query;

  if (error) {
    console.error("getDailyPickup failed:", error.message);
    return [];
  }

  const rowsByPeriod = new Map();

  for (const row of data || []) {
    const key = `${row.property_code}||${row.period_month}||${row.currency}`;
    const rows = rowsByPeriod.get(key) || [];
    rows.push(row);
    rowsByPeriod.set(key, rows);
  }

  const latestByPeriod = new Map();
  const previousByPeriod = new Map();

  for (const [key, rows] of rowsByPeriod.entries()) {
    const sorted = [...rows].sort((a, b) => {
      if (a.snapshot_date !== b.snapshot_date) return b.snapshot_date.localeCompare(a.snapshot_date);
      return String(b.updated_at || "").localeCompare(String(a.updated_at || ""));
    });
    const latest =
      (pickupDate ? sorted.find((row) => row.snapshot_date <= pickupDate) : null) || sorted[0];

    latestByPeriod.set(key, {
      ...latest,
      requested_pickup_date: pickupDate,
      used_fallback_snapshot: Boolean(pickupDate && latest.snapshot_date > pickupDate),
    });

    const previous = sorted.find((row) => row.snapshot_date < latest.snapshot_date);
    if (previous) previousByPeriod.set(key, previous);
  }

  return [...latestByPeriod.entries()].map(([key, latest]) => {
    const previous = previousByPeriod.get(key);
    return {
      ...latest,
      previous_revenue: previous?.actual_revenue ?? null,
      pickup_revenue:
        previous?.actual_revenue === undefined || previous?.actual_revenue === null
          ? null
          : Number(latest.actual_revenue || 0) - Number(previous.actual_revenue || 0),
      previous_reservation_count: previous?.reservation_count ?? null,
      pickup_reservations:
        previous?.reservation_count === undefined || previous?.reservation_count === null
          ? null
          : Number(latest.reservation_count || 0) - Number(previous.reservation_count || 0),
    };
  });
}

export async function getOpenDataQualityFindings(client = anonClient) {
  if (!isSupabaseConfigured) return mockDataQualityLog;

  const { data, error } = await client
    .from("data_quality_log")
    .select("*")
    .eq("resolved", false)
    .order("detected_at", { ascending: false });

  if (error) {
    console.error("getOpenDataQualityFindings failed, falling back to mock data:", error.message);
    return mockDataQualityLog;
  }

  return data || [];
}

export async function getLastIngestedPerProperty(client = anonClient) {
  if (!isSupabaseConfigured) return mockLastIngested;

  const { data, error } = await client
    .from("ingestion_log")
    .select("property_code, ingested_at")
    .order("ingested_at", { ascending: false });

  if (error) {
    console.error("getLastIngestedPerProperty failed, falling back to mock data:", error?.message);
    return mockLastIngested;
  }

  const latest = {};
  for (const row of data || []) {
    if (!latest[row.property_code]) latest[row.property_code] = row.ingested_at;
  }
  return latest;
}
