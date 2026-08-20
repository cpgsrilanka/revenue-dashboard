import { createClient } from "@supabase/supabase-js";

// Uses the anon key — safe to expose to the browser. Row Level Security on
// Supabase should be configured so authenticated users can only read (never
// write) clean_reservations, data_quality_log, and budget. Writes only ever
// happen from the ingestion job, which uses the service_role key server-side.
export const isSupabaseConfigured = Boolean(
  process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

// createClient throws immediately on an empty/invalid URL rather than
// failing lazily — only construct it when real config is present, so the
// app can still build and run on mock data with no env vars set at all.
export const supabase = isSupabaseConfigured
  ? createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)
  : null;
