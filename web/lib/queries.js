import { supabase as anonClient, isSupabaseConfigured } from "./supabaseClient";
import { mockMonthlyRevenue, mockDataQualityLog, mockLastIngested } from "./mockData";

// Every function here falls back to mock data if Supabase isn't configured
// OR returns no rows yet (e.g. Phase 1/2 pipeline hasn't run for a property).
// This lets the dashboard shell be built and reviewed before real data exists
// — swap MOCK_MODE off once `clean_reservations` actually has rows.
//
// Each function takes an optional `client` — pass the authenticated
// server client from lib/supabase/server.js when calling from a Server
// Component behind the /dashboard auth wall, so Row Level Security applies
// as the signed-in user rather than as an anonymous request. Falls back to
// the plain anon client if none is passed (keeps this usable in contexts
// without a session, e.g. local scripts).

export async function getMonthlyRevenue(periodMonth, client = anonClient) {
  if (!isSupabaseConfigured) return mockMonthlyRevenue;

  const { data, error } = await client
    .from("v_monthly_revenue")
    .select("*")
    .eq("period_month", periodMonth);

  if (error) {
    console.error("getMonthlyRevenue failed, falling back to mock data:", error.message);
    return mockMonthlyRevenue;
  }

  return data?.length ? data : mockMonthlyRevenue;
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

  return data?.length ? data : mockDataQualityLog;
}

export async function getLastIngestedPerProperty(client = anonClient) {
  if (!isSupabaseConfigured) return mockLastIngested;

  const { data, error } = await client
    .from("ingestion_log")
    .select("property_code, ingested_at")
    .order("ingested_at", { ascending: false });

  if (error || !data?.length) {
    console.error("getLastIngestedPerProperty failed, falling back to mock data:", error?.message);
    return mockLastIngested;
  }

  const latest = {};
  for (const row of data) {
    if (!latest[row.property_code]) latest[row.property_code] = row.ingested_at;
  }
  return latest;
}
