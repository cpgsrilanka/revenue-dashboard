# Revenue Dashboard

This project pulls property reservation Excel workbooks from SharePoint, cleans them into Supabase, and powers a signed-in revenue dashboard.

Current status: the SharePoint and Supabase connections are working, the six active FY 26-27 workbooks ingest successfully, monthly budgets are loaded, and the web dashboard can read Supabase after login. The dashboard now treats the `All Bookings` sheet as the operational source of truth: room revenue comes from `Room Charges`, meal/FNB is tracked separately from `Meal Charges`, and segment performance is calculated from clean booking rows rather than copied from the visible Excel matrix. A workbook-governance dry run also exists to standardize and lock local copies of the live SharePoint workbooks before any live replacement is considered.

See `DASHBOARD_ROADMAP.md` for the detailed feature plan.

## PMS export adapters

The legacy property workbooks remain the live source until a property is deliberately cut over. The ingestion service now also has adapters for scheduled PMS exports:

- **OPERA Cloud** (`.xml`) for Crystal Sands and Asaya Sands. The supplied reservation-detail report gives status and room nights reliably, but its rate field is not yet a validated total-stay revenue amount. OPERA rows therefore start in `rate_only` mode and do not publish revenue totals.
- **Exely** (`.xlsx`) for Leyn Baan, Sol House, Kirana, and Serenity Villa. The adapter maps a daily full booking snapshot, including booking status, room nights, total amount, and prepaid amount.
- **HotelTime** (`.xlsx`) for The Six and, once it is registered in `property_master`, Rekawa Reach. The adapter preserves its one-line-per-room reporting model and maps accommodation and total-with-VAT separately.

All adapters are **disabled by default** in `config/properties.yaml`. They use a stable PMS record key so amended or cancelled bookings update correctly instead of becoming duplicates. Before enabling any property, follow the reversible cutover guide in `PMS_INGESTION_CUTOVER.md` and run `db/pms-source-adapters-upgrade.sql` in Supabase.

## What's here

```
db/schema.sql              Supabase/Postgres schema — run this first
db/dashboard-read-policies.sql  RLS read policies for the signed-in dashboard
db/revenue-snapshots.sql   Existing-project migration for daily pickup
db/dashboard-matrix-upgrade.sql Existing-project migration for the segment matrix and meal/FNB fields
db/operational-truth-upgrade.sql Existing-project migration for clean booking-row actuals
config/properties.yaml     Per-property column mappings (adapter configs)
ingestion/
  ingest.js                Main orchestrator — the nightly job entry point
  graphClient.js            SharePoint access via Microsoft Graph
  parseExcel.js              Excel → unified schema mapping
  parseBudget.js             Revenue pickup report → monthly budget rows
  parseReportMatrix.js        Revenue pickup report → segment matrix rows
  parsePmsExport.js           OPERA, Exely, and HotelTime export adapters
  qualityChecks.js           Data quality check suite
  workbookGovernance.js       Workbook cleanup / validation / protection dry run
  standardizeWorkbook.py      Excel workbook standardization helper
  package.json
  .env.example
web/                       Next.js dashboard with Supabase Auth
.github/workflows/ingest.yml  Nightly scheduled run target (21:30 UTC / 03:00 SL time)
```

## Current dashboard limits

The dashboard has real room revenue, real budget data, clean segment performance, FNB/meal tracking, daily pickup cards, property comparison, and visual charts. It is not yet feature-complete.

- **Budget comparison:** working. The importer reads the workbook revenue pickup report sheets and fills the `budget` table with 12 months per active property.
- **Segment performance:** working from clean `All Bookings` rows. The old extracted workbook matrix remains useful for segment budget targets and reconciliation, but it is no longer the actual-revenue source.
- **Meal/FNB tracking:** added. `Meal Charges` now load into `fnb_revenue` so room revenue and meal/FNB revenue can be shown separately.
- **Daily pickup:** UI added with a pickup-date selector. The dashboard supports a clean `pickup_date` field so pickup can follow each workbook's Excel report basis.
- **Property comparison:** first version is working. The comparison table shows actual, budget, variance, variance percent, and reservations for the currently visible properties.
- **Charts:** added. The dashboard shows actual-vs-budget by property and room-revenue mix by segment.
- **Filters:** current filters are `period`, `month`, `fy`, `pickupDate`, `entity`, `property`, and `segments`, stored in the URL. Example: `/dashboard?period=fy&fy=2026&entity=OGH&segments=OTA,FIT%20-%20Local`.

## What's real vs still placeholder (as of the Phase 1 file audit)

The real SharePoint layout has been confirmed: **all properties' files sit in one shared folder** (`Databases/FY 26-27/`, with older data in `Databases/FY 25-26/`), one workbook per property, matched by filename — not a per-property subfolder.

**Even better news: everyone shares one template.** Crystal Sands, The Six, Sol House, Kirana Villa, and Leyn Baan were all independently confirmed to export from a single `All Bookings` sheet with the same 29 columns, a real `Payment Status` column, and dates like `16-Mar-26`. `config/properties.yaml` defines this once as a reusable YAML anchor (`&all_bookings_template`) and every property points at it — see `STANDARDIZATION.md` for the full column reference.

- **Crystal Sands (CRS), The Six (SIX), Sol House (SOL), Kirana Villa (KIR), 77 Leyn Baan (LYN)** — confirmed against real files, all on the shared template. (Leyn Baan was expected to still be on an older per-month layout — it turned out to have already migrated.)
- **Asaya Sands (ASM)** — current-year file directly confirmed in SharePoint (`Databases/FY 26-27/Asaya Sands Database (26-27).xlsx`) and dry-parsed successfully. One data-rule issue remains: a handful of real-looking Asaya rows have blank reservation numbers, so the current blank-ID skip rule may exclude some revenue until those rows are corrected or the parser gets a safe synthetic-ID rule.
- **Serenity Villa (SRN)** — new property, no live file yet. Seeded `active = false` in `property_master`. Points at the same shared template — see `STANDARDIZATION.md`.
- **Kotiyagala** — had a database file in SharePoint, but the property was terminated. Deliberately not seeded.

**Real-world quirks the shared template's config and parser now handle:**
- Reservation numbers repeat legitimately (multi-room bookings, rebookings to new dates) — duplicate detection keys on `(reservation_id, arrival, departure, total_revenue)` together, not the ID alone, so it only catches genuine copy-paste duplicates.
- Thousands of blank-reservation-ID forecast/room-blocking rows are mixed into the same sheet as real bookings, running out to FY 2027-28 — filtered by the blank-ID rule.
- Dates are text like `16-Mar-26`, with a few numeric-slash outliers observed too — the parser tries several formats per cell.
- Reporting month and villa/room nights are preserved from the workbook's own `Month` and `Room Nights`/`VN` columns instead of being guessed from arrival/departure dates.
- Negative cancellation/adjustment rows are included in operational totals and flagged for admin review. Exact copy-paste duplicates are quarantined out of totals.

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

### 3. Review blank reservation numbers
The remaining data-rule gap is no longer Asaya's template shape. Asaya's current-year workbook is confirmed and parses, but it has a small number of real-looking booking rows with blank `Reservation No.` values. Decide whether those should be corrected in the source workbook or ingested with a synthetic reservation ID before trusting production totals.

Run `npm test` in `ingestion/` after any change. The tests cover the shared template, the legacy per-month/suffix-status pattern, the duplicate-detection fix, budget parsing, report-matrix parsing, and all three PMS adapters.

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

### 4a. Enable daily pickup snapshots
For the existing Supabase project, run this once in the Supabase SQL Editor:

```text
db/revenue-snapshots.sql
```

Then run ingestion again. The first snapshot creates the baseline; daily pickup becomes meaningful after the next dated snapshot.

If a property reports in more than one currency, also run this once before the next ingestion:

```text
db/revenue-snapshot-currency-upgrade.sql
```

This stores pickup snapshots separately by currency rather than combining or discarding them.

### 4b. Enable clean operational-truth views
For the existing Supabase project, run this once in the Supabase SQL Editor:

```text
db/operational-truth-upgrade.sql
```

Then run ingestion again. This fills the new `period_month` values and refreshes the clean monthly and segment views used by the dashboard.

### 4c. Enable Excel-matched pickup date logic
For the existing Supabase project, run this once in the Supabase SQL Editor:

```text
db/pickup-date-basis.sql
```

Then run ingestion again. The importer fills `clean_reservations.pickup_date` from the workbook field that drives each property's Excel pickup report:

- ASM / CRS: `Date of Reservation`
- KIR / LYN / SIX / SOL: `Confirmation Date`

Until this SQL has been run, the dashboard falls back to the older `booking_date` / `Date of Reservation` behavior.

### 5. Automate it
Once a manual run works cleanly:
1. Push this repo to GitHub.
2. Add the `.env` values as repository secrets (Settings → Secrets and variables → Actions) — same names as in `.env.example`.
3. The workflow in `.github/workflows/ingest.yml` will then run nightly automatically. You can also trigger it manually from the Actions tab (`workflow_dispatch`) to test the full pipeline end to end without waiting for the schedule.

## Standardizing the formats long-term

`STANDARDIZATION.md` proposes a common export template every property should move onto over time, so the per-property special-casing in `properties.yaml` shrinks instead of growing as more properties get added. Serenity Villa, having no legacy file, is the easiest place to start.

## Notes on what's intentionally NOT built yet

- **Cross-check and outlier checks** (comparing against a property-reported total row, flagging revenue outliers vs trailing average) — these need a data baseline to compare against, which you won't have until Phase 2. The `qualityChecks.js` structure is built so adding these later is a new function, not a redesign.
- **Alerting** (Teams/Outlook nightly summary) — stubbed as a TODO in `ingest.js`. Straightforward to add via the Microsoft 365 Graph mail-send API once the pipeline itself is stable.
- **Currency conversion** (`revenue_base_currency`) — column exists in the schema but isn't populated yet; wire in an FX rate source if/when OGH's international bookings need it.
- **Pace views** — daily pickup is surfaced, but pacing forecasts are still future work.
