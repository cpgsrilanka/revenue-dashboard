# Revenue Dashboard — Web App Shell

Next.js app implementing the dashboard from the architecture plan: hero KPI band, meal/FNB breakdown, daily pickup, clean segment performance, property comparison, per-property cards, and an admin-only Data Health panel.

## Design

- **Palette:** deep teal-ink (`#12302B`) for text/dark accents, warm ivory (`#FBF9F4`) page background, brass (`#B8924A`) for the accent/positive figures, muted brick (`#C1544A`) for alerts and negative deltas.
- **Type:** Fraunces (serif display, for the big revenue numerals), Inter (UI text), IBM Plex Mono available for tabular data if you want stricter numeric alignment later.
- **Signature element:** the "tideline" — a thin brass gradient rule beneath the hero revenue number, in `components/HeroKpi.jsx`.

## Runs with mock data when Supabase is not configured

`lib/mockData.js` has data shaped exactly like the real Supabase tables. `lib/queries.js` falls back to it automatically when Supabase isn't configured, or if a live query errors. Once Supabase is connected, an empty result stays empty so the dashboard does not mix sample numbers into live reporting.

```bash
cd web
npm install
npm run dev
```
Visit `/login`, then `/dashboard` directly — with no Supabase env vars set, auth is bypassed entirely and the dashboard renders on mock data (see `middleware.js`: it lets everything through when `NEXT_PUBLIC_SUPABASE_URL` isn't set).

## Wiring up real data

1. Copy `.env.example` to `.env.local`, fill in your Supabase project URL and **anon** key (not service_role — this is the browser-facing client).
2. In Supabase, enable Row Level Security on `clean_reservations`, `data_quality_log`, `budget`, and set a policy allowing `select` for authenticated users. The ingestion job writes with the service_role key, so it bypasses RLS — this app only ever reads.
3. Run `db/dashboard-matrix-upgrade.sql` once in Supabase if the segment budget table is not already created.
4. Run `db/revenue-snapshots.sql` once in Supabase for daily pickup snapshots.
5. Run `db/operational-truth-upgrade.sql` once in Supabase so actuals come from clean booking rows.
6. Run ingestion again. Once `clean_reservations`, `budget`, and snapshots have rows, the dashboard will show real actual-vs-budget, pickup, segment data, and charts automatically.

## Current filters

The filter UI lives in `components/DashboardFilters.jsx`. The dashboard page reads the URL values in `app/dashboard/page.js`.

Current filters:

- `period` — `month`, `ytd`, or `fy`, e.g. `/dashboard?period=ytd&month=2026-08`
- `month` — reporting month when `period=month`, e.g. `/dashboard?month=2026-08`
- `month` — through month when `period=ytd`; `2026-08` means April 2026 through August 2026
- `fy` — April-March financial year start, e.g. `2026` for FY 2026/27
- `pickupDate` — snapshot date for daily pickup, e.g. `/dashboard?pickupDate=2026-08-20`
- `entity` — `CPG`, `OGH`, or all, e.g. `/dashboard?entity=CPG`
- `property` — one property code or all, e.g. `/dashboard?property=CRS`
- `segments` — comma-separated segment filter, e.g. `/dashboard?segments=OTA,FIT%20-%20Local`

These can be combined:

```text
/dashboard?period=fy&fy=2026&entity=OGH&segments=OTA
```

## Comparison

The main comparison surfaces are the property comparison table and the clean segment performance matrix.

Current behavior:

- `All properties` compares every property with data for the selected month.
- `entity=CPG` compares the CPG properties.
- `entity=OGH` compares the OGH properties.
- `property=CRS` narrows the view to one property.

The segment matrix includes budget revenue, budget villa nights, budget ARR, actual room revenue, actual villa nights, actual ARR, and balance to earn by segment. Actuals are calculated from `All Bookings` via `v_monthly_segment_revenue`; the parsed workbook matrix is used only for segment budget targets and reconciliation.

Recommended next UI layer:

- Add `compare=CRS,SIX,ASM` as a URL filter.
- Add a multi-property picker for comparison mode.
- Add a variance chart for over/under budget ranking.

## Budget and pickup dependencies

Budget comparison is wired end to end. The ingestion job parses the Excel revenue pickup report sheets and fills the `budget` table with 12 months per active property.

Daily pickup needs one Supabase migration before it is live in the current project:

```text
db/revenue-snapshots.sql
```

After that, the ingestion job will record month totals after each run. The first snapshot is only the baseline; pickup becomes meaningful after the next dated snapshot. The UI reads snapshots directly so the pickup-date selector can view earlier snapshot dates.

## Authentication — how it actually works

Route protection is real, not stubbed. Three pieces work together:

- **`middleware.js`** runs on every request to `/dashboard/*` and `/login`. It refreshes the Supabase session cookie and redirects unauthenticated visitors away from `/dashboard` to `/login` (and signed-in visitors away from `/login` to `/dashboard`).
- **`app/auth/callback/route.js`** is where the magic-link email actually points (not straight to `/dashboard`). This matters for SSR: Supabase's magic link carries a one-time code that has to be exchanged for a session *on the server* so the resulting cookie exists before the next request's middleware check runs. Redirecting straight to `/dashboard` would only set the session in the browser's in-memory state, which middleware running on the server can't see.
- **`lib/supabase/client.js`** (browser) and **`lib/supabase/server.js`** (Server Components) both use `@supabase/ssr` instead of a plain `@supabase/supabase-js` client — that's what makes the session live in cookies instead of just `localStorage`, which is what middleware needs to read it.

The dashboard page also re-checks the session itself (`app/dashboard/page.js`) as defense in depth, and passes the authenticated client into `lib/queries.js` so Row Level Security policies apply as the signed-in user rather than as an anonymous request.

## Still to wire up before this is production-ready

- **Comparison picker:** add a custom multi-property picker beyond entity/property filtering.
- **Admin section:** Data Health is intentionally collapsed under an admin drawer so normal dashboard users see the revenue view first.
- **Export to Excel/PDF:** mentioned in the architecture plan as a Phase 4 item, not built here yet.
- **Deploy:** `vercel deploy` from the `web/` directory once env vars are set in the Vercel project settings. Also set the Supabase project's **Auth → URL Configuration → Redirect URLs** to include your deployed domain's `/auth/callback` — magic links will fail silently otherwise.
