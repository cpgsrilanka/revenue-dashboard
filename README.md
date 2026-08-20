# Revenue Dashboard — Phase 1 Scaffold

This is the starting scaffold for the ingestion pipeline: SharePoint (Excel) → Supabase (raw + clean + data quality). It's built to run for 1–2 properties first, per the Phase 1 plan, before extending to all 6.

## What's here

```
db/schema.sql              Supabase/Postgres schema — run this first
config/properties.yaml     Per-property column mappings (adapter configs)
ingestion/
  ingest.js                Main orchestrator — the nightly job entry point
  graphClient.js            SharePoint access + nightly alert email via Microsoft Graph
  parseExcel.js              Excel → unified schema mapping
  qualityChecks.js           Data quality check suite
  alerting.js                Nightly alert email — decides whether to send, builds the summary
  package.json
  .env.example
.github/workflows/ingest.yml  Nightly scheduled run (21:30 UTC / 03:00 SL time)
```

## What's real vs still placeholder (as of the Phase 1 file audit)

The real SharePoint layout has been confirmed: **all properties' files sit in one shared folder** (`Databases/FY 26-27/`, with older data in `Databases/FY 25-26/`), one workbook per property, matched by filename — not a per-property subfolder.

**Even better news: everyone shares one template.** Crystal Sands, The Six, Sol House, Kirana Villa, and Leyn Baan were all independently confirmed to export from a single `All Bookings` sheet with the same 29 columns, a real `Payment Status` column, and dates like `16-Mar-26`. `config/properties.yaml` defines this once as a reusable YAML anchor (`&all_bookings_template`) and every property points at it — see `STANDARDIZATION.md` for the full column reference.

- **Crystal Sands (CRS), The Six (SIX), Sol House (SOL), Kirana Villa (KIR), 77 Leyn Baan (LYN)** — confirmed against real files, all on the shared template. (Leyn Baan was expected to still be on an older per-month layout — it turned out to have already migrated.)
- **Asaya Sands (ASM)** — very likely the same template (matching reference data, matching sheet count), but not independently re-confirmed for the current-year file — a copy-paste slip re-fetched Sol House instead of Asaya on the last attempt. Spot-check before trusting it in production.
- **Serenity Villa (SRN)** — new property, no live file yet. Seeded `active = false` in `property_master`. Points at the same shared template — see `STANDARDIZATION.md`.
- **Kotiyagala** — had a database file in SharePoint, but the property was terminated. Deliberately not seeded.

**Real-world quirks the shared template's config and parser now handle:**
- Reservation numbers repeat legitimately (multi-room bookings, rebookings to new dates) — duplicate detection keys on `(reservation_id, arrival, departure, total_revenue)` together, not the ID alone, so it only catches genuine copy-paste duplicates.
- Thousands of blank-reservation-ID forecast/room-blocking rows are mixed into the same sheet as real bookings, running out to FY 2027-28 — filtered by the blank-ID rule.
- Dates are text like `16-Mar-26`, with a few numeric-slash outliers observed too — the parser tries several formats per cell.

## Setup — do this in order

### 1. Supabase
1. Create a project at supabase.com.
2. Open the SQL editor, paste in `db/schema.sql`, run it. This creates all tables and seeds `property_master` with the confirmed real filenames.
3. Grab your project URL and **service_role key** (Settings → API) — you'll need these for `.env`. Never expose the service_role key to a frontend; it's server-side only.

### 2. Azure AD app registration (for SharePoint access)
1. In the Entra ID admin center, register a new app (any name, e.g. "Revenue Dashboard Ingestion").
2. Under API permissions, add **Application permissions** (not delegated): `Sites.Read.All` and `Files.Read.All`. Have an admin grant consent — as tenant admin, this should be you.
   - Tighter alternative once things work: switch to `Sites.Selected` and grant access to only the Reservations site specifically, rather than all of SharePoint.
3. Under Certificates & secrets, create a client secret. Copy it immediately — it's shown once.
4. Note the **Tenant ID**, **Application (client) ID**, and the secret — these go in `.env`.
5. Find your site ID and drive ID:
   ```
   GET https://graph.microsoft.com/v1.0/sites/{tenant}.sharepoint.com:/sites/Reservations
   GET https://graph.microsoft.com/v1.0/sites/{site-id}/drive
   ```
   (Easiest via Graph Explorer, signed in as yourself, since you're tenant admin.)

### 3. Spot-check Asaya Sands
Everything else is confirmed. The one remaining gap: open Asaya Sands' current-year file and confirm its `All Bookings` sheet matches the shared template exactly (see `STANDARDIZATION.md` for the full column reference). It's very likely already correct — no config change expected — this is just closing out the one file that wasn't directly re-confirmed.

Run `npm test` in `ingestion/` after any change — three test suites cover the shared template, the (now unused, but still protected) legacy per-month/suffix-status pattern, and the duplicate-detection fix.

**A mapping mistake already happened twice here, worth knowing about:** the first version of Crystal Sands' config filtered footer rows by matching cell text like `"FIT - Local"` — which also happens to be a legitimate segment value on real reservation rows, so it silently dropped a real booking. Fixed by filtering on blank `reservation_id` instead. Separately, the first duplicate-detection check flagged any repeated reservation number as an error — but The Six and Sol House showed that a single reservation can legitimately span multiple rows (multi-room bookings) or get rebooked to new dates under the same number. Fixed by keying duplicate detection on `(reservation_id, arrival, departure, total_revenue)` together. Both lessons point the same direction: prefer structural signals (a blank field, an exact match across several columns) over content signals (a specific phrase, an ID alone) — real spreadsheets collide with content-based heuristics eventually.

### 4. Run it locally first
```bash
cd ingestion
cp .env.example .env   # fill in the values from steps 1–2
npm install
npm run ingest:dry-run   # parses + validates, but writes nothing — safe to run repeatedly
```
Check the console output: row counts and quality findings per property. Fix `properties.yaml` mappings until a dry run for your first 1–2 properties looks right, *then* drop `--dry-run` and run for real:
```bash
npm run ingest
```
Check `data_quality_log` and `clean_reservations` in the Supabase table editor afterward.

### 5. Automate it
Once a manual run works cleanly:
1. Push this repo to GitHub.
2. Add the `.env` values as repository secrets (Settings → Secrets and variables → Actions) — same names as in `.env.example`.
3. The workflow in `.github/workflows/ingest.yml` will then run nightly automatically. You can also trigger it manually from the Actions tab (`workflow_dispatch`) to test the full pipeline end to end without waiting for the schedule.

## Standardizing the formats long-term

`STANDARDIZATION.md` proposes a common export template every property should move onto over time, so the per-property special-casing in `properties.yaml` shrinks instead of growing as more properties get added. Serenity Villa, having no legacy file, is the easiest place to start.

## Notes on what's intentionally NOT built yet

- **Cross-check and outlier checks** (comparing against a property-reported total row, flagging revenue outliers vs trailing average) — these need a data baseline to compare against, which you won't have until Phase 2. The `qualityChecks.js` structure is built so adding these later is a new function, not a redesign.
- **Currency conversion** (`revenue_base_currency`) — column exists in the schema but isn't populated yet; wire in an FX rate source if/when OGH's international bookings need it.
- **The web app itself** — this scaffold only covers ingestion. Next step after Phase 1/2 data is trustworthy: Next.js + Supabase Auth (magic link) + Recharts, per the architecture plan.

## Alerting

`ingest.js` now sends a nightly summary email via Microsoft Graph (`graphClient.js`'s `sendMail`, decision + formatting logic in `alerting.js`) instead of just logging a warning to the console. By default it only emails when something needs attention — a critical data-quality finding, or a SharePoint access error — so a clean run stays quiet; set `ALERT_ALWAYS=true` in `.env` to get a summary every run instead.

To turn it on:
1. Add the `Mail.Send` **application permission** to the same Azure AD app used for SharePoint access (Entra ID admin center → your app → API permissions), and grant admin consent.
2. Set `ALERT_EMAIL_FROM` (a real mailbox in your tenant — app-only auth sends "as" this mailbox) and `ALERT_EMAIL_TO` (comma-separated recipients) in `.env`.
3. Leave both blank to disable email alerts entirely — findings still land in `data_quality_log` and the console either way, so this is optional, not load-bearing.

`npm test` in `ingestion/` now runs four suites — the three original ones plus `test-alerting.mjs`, which covers the send/skip decision and the email content (including that finding messages get HTML-escaped).
