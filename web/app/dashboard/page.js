import { redirect } from "next/navigation";
import HeroKpi from "@/components/HeroKpi";
import PropertyCard from "@/components/PropertyCard";
import DataHealthPanel from "@/components/DataHealthPanel";
import SignOutButton from "@/components/SignOutButton";
import FilterBar from "@/components/FilterBar";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabaseClient";
import { getMonthlyRevenue, getOpenDataQualityFindings, getLastIngestedPerProperty } from "@/lib/queries";

const VALID_ENTITIES = ["CPG", "OGH"];
const MONTH_PARAM_RE = /^\d{4}-\d{2}$/;

export default async function DashboardPage({ searchParams }) {
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

  // Entity/date filters, driven entirely by the URL (?entity=CPG&month=2026-07)
  // so the filtered view is shareable and FilterBar (a client component) can
  // update it with router.push without any server-side session state.
  const requestedEntity = searchParams?.entity;
  const entity = VALID_ENTITIES.includes(requestedEntity) ? requestedEntity : null;

  const requestedMonth = searchParams?.month;
  const monthIsValid = typeof requestedMonth === "string" && MONTH_PARAM_RE.test(requestedMonth);
  const month = monthIsValid ? requestedMonth : new Date().toISOString().slice(0, 7);
  const hasCustomFilters = Boolean(entity) || monthIsValid;

  const currentPeriod = `${month}-01`;
  const [allProperties, findings, lastIngested] = await Promise.all([
    getMonthlyRevenue(currentPeriod, dataClient),
    getOpenDataQualityFindings(dataClient),
    getLastIngestedPerProperty(dataClient),
  ]);

  // Entity isn't its own query param on these tables at the row level (see
  // db/schema.sql — v_monthly_revenue joins it in from property_master), so
  // filtering in memory here is simpler than adding an entity-aware query
  // variant, and works the same way for both the real and mock data paths.
  const properties = entity ? allProperties.filter((p) => p.entity === entity) : allProperties;

  // data_quality_log rows only carry property_code, not entity — resolve it
  // via the (unfiltered) properties list. A finding for a property not in
  // that list (e.g. inactive) is left visible rather than silently hidden.
  const entityByPropertyCode = Object.fromEntries(allProperties.map((p) => [p.property_code, p.entity]));
  const openFindings = entity
    ? findings.filter((f) => {
        const propertyEntity = entityByPropertyCode[f.property_code];
        return !propertyEntity || propertyEntity === entity;
      })
    : findings;

  return (
    <main className="max-w-5xl mx-auto px-6 py-10">
      <div className="flex items-center justify-between mb-8">
        <p className="font-display text-lg">Revenue dashboard</p>
        {userEmail && (
          <div className="flex items-center gap-2 text-xs text-slate">
            <span>{userEmail}</span>
            <SignOutButton />
          </div>
        )}
      </div>

      <FilterBar entity={entity} month={month} hasCustomFilters={hasCustomFilters} />

      <HeroKpi properties={properties} />

      <p className="text-sm text-slate mb-4">By property</p>
      {properties.length === 0 ? (
        <p className="text-sm text-slate mb-8">
          No properties match this filter for {month}.
        </p>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mb-8">
          {properties.map((property) => (
            <PropertyCard
              key={property.property_code}
              property={property}
              lastIngestedAt={lastIngested[property.property_code]}
            />
          ))}
        </div>
      )}

      <DataHealthPanel findings={openFindings} />
    </main>
  );
}
