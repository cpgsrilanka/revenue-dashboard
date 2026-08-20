# Revenue Dashboard — Web App Shell

Next.js app implementing the dashboard from the architecture plan: hero KPI band, per-property cards with budget delta + trend sparkline, and a Data Health panel surfacing open data-quality findings.

## Design

- **Palette:** deep teal-ink (`#12302B`) for text/dark accents, warm ivory (`#FBF9F4`) page background, brass (`#B8924A`) for the accent/positive figures, muted brick (`#C1544A`) for alerts and negative deltas.
- **Type:** Fraunces (serif display, for the big revenue numerals), Inter (UI text), IBM Plex Mono available for tabular data if you want stricter numeric alignment later.
- **Signature element:** the "tideline" — a thin brass gradient rule beneath the hero revenue number, in `components/HeroKpi.jsx`.

## Runs with mock data out of the box

`lib/mockData.js` has data shaped exactly like the real Supabase tables. `lib/queries.js` falls back to it automatically whenever Supabase isn't configured or returns no rows — so you can run this today and see the full shell before the ingestion pipeline has produced anything real:

```bash
cd web
npm install
npm run dev
```
Visit `/login`, then `/dashboard` directly — with no Supabase env vars set, auth is bypassed entirely and the dashboard renders on mock data (see `middleware.js`: it lets everything through when `NEXT_PUBLIC_SUPABASE_URL` isn't set).

## Wiring up real data

1. Copy `.env.example` to `.env.local`, fill in your Supabase project URL and **anon** key (not service_role — this is the browser-facing client).
2. In Supabase, enable Row Level Security on `clean_reservations`, `data_quality_log`, `budget`, and set a policy allowing `select` for authenticated users. The ingestion job writes with the service_role key, so it bypasses RLS — this app only ever reads.
3. Once `clean_reservations` has rows, `getMonthlyRevenue()` in `lib/queries.js` will return real data automatically — no component changes needed, since the mock data was shaped to match.

## Authentication — how it actually works

Route protection is real, not stubbed. Three pieces work together:

- **`middleware.js`** runs on every request to `/dashboard/*` and `/login`. It refreshes the Supabase session cookie and redirects unauthenticated visitors away from `/dashboard` to `/login` (and signed-in visitors away from `/login` to `/dashboard`).
- **`app/auth/callback/route.js`** is where the magic-link email actually points (not straight to `/dashboard`). This matters for SSR: Supabase's magic link carries a one-time code that has to be exchanged for a session *on the server* so the resulting cookie exists before the next request's middleware check runs. Redirecting straight to `/dashboard` would only set the session in the browser's in-memory state, which middleware running on the server can't see.
- **`lib/supabase/client.js`** (browser) and **`lib/supabase/server.js`** (Server Components) both use `@supabase/ssr` instead of a plain `@supabase/supabase-js` client — that's what makes the session live in cookies instead of just `localStorage`, which is what middleware needs to read it.

The dashboard page also re-checks the session itself (`app/dashboard/page.js`) as defense in depth, and passes the authenticated client into `lib/queries.js` so Row Level Security policies apply as the signed-in user rather than as an anonymous request.

## Still to wire up before this is production-ready

- **Entity/date filters:** the hero and grid currently show the current month for all properties. Add query-param-driven filters once you're ready (e.g. `?entity=CPG&month=2026-07`).
- **Export to Excel/PDF:** mentioned in the architecture plan as a Phase 4 item, not built here yet.
- **Deploy:** `vercel deploy` from the `web/` directory once env vars are set in the Vercel project settings. Also set the Supabase project's **Auth → URL Configuration → Redirect URLs** to include your deployed domain's `/auth/callback` — magic links will fail silently otherwise.
