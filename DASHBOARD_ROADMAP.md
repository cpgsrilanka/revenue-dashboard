# Revenue Dashboard Roadmap

## Current state

The project is now connected end to end for the first revenue layer:

- Microsoft Graph can read the SharePoint Excel workbooks from `CPG-Reservations / Databases / FY 26-27`.
- The ingestion job downloads the latest workbook for each active property.
- The `All Bookings` sheet parses into Supabase with zero parse errors for the six active properties.
- Monthly budgets are parsed from each workbook's revenue pickup report and loaded into Supabase.
- The web dashboard signs in with Supabase Auth and reads from Supabase.

The dashboard is still early, but it now shows:

- Monthly actual revenue by property.
- Monthly budget and actual-vs-budget variance.
- Segment performance by budget, actual, ARR, and balance.
- Meal/FNB charges separately from room revenue.
- Daily pickup cards from saved snapshots.
- A pickup-date selector for snapshot-based pickup.
- Reservation count by property.
- A side-by-side property comparison table.
- Actual-vs-budget charts and segment revenue mix charts.
- Open data-quality findings collapsed under an admin section.
- Month/FY, pickup-date, entity, property, and segment filters.

The key source-of-truth rule is now: **actual revenue comes from clean `All Bookings` rows, not from the visible Excel matrix.** The Excel pivot logic was inspected and its actuals use `Room Charges`, `Room Nights`/`VN`, `Month`, and `Segment`. The dashboard mirrors those fields from the raw booking rows, while using the parsed workbook matrix only for segment budget targets and reconciliation.

## Budget status

Budget ingestion is now working.

The importer reads the workbook's `Revenue & Pickup Report` / `Revenue Pickup Report` sheet and stores one row per property per month in the `budget` table. Current live load:

- 72 budget rows total.
- 6 active properties.
- 12 months per property.

For August 2026, `v_monthly_revenue` now returns both actual and budget values for ASM, CRS, KIR, LYN, SIX, and SOL.

## Where filters are set

Dashboard filters live in:

```text
web/components/DashboardFilters.jsx
```

The dashboard page reads the filter values from the URL in:

```text
web/app/dashboard/page.js
```

Current supported URL filters:

```text
/dashboard?month=2026-08
/dashboard?period=fy&fy=2026
/dashboard?pickupDate=2026-08-20
/dashboard?entity=CPG
/dashboard?property=CRS
/dashboard?segments=OTA,FIT%20-%20Local
/dashboard?period=fy&fy=2026&entity=OGH&segments=OTA
```

Current behavior:

- `period` switches between `month` and `fy`.
- `month` selects one reporting month when `period=month`.
- `fy` selects an April-March financial year when `period=fy`.
- `pickupDate` selects which snapshot date daily pickup should use.
- `entity` filters to `CPG`, `OGH`, or all entities.
- `property` filters to one property or all properties.
- `segments` filters the segment breakdown and segment chart.

## How property comparison works now

The main dashboard view now prioritizes clean segment performance. It compares Budget 26/27, Actual 26/27, and Balance To Earn by segment for the currently visible property group.

Current behavior:

- Select `All properties` to compare every reporting property.
- Select `entity=CPG` to compare Crystal Sands against The Six.
- Select `entity=OGH` to compare the OGH properties.
- Select one property when you want that property alone.

The matrix shows:

- Segment
- Budget revenue
- Budget villa nights
- Budget ARR
- Actual revenue
- Actual villa nights
- Actual ARR
- Balance revenue
- Balance villa nights

Actual-side values are calculated from `clean_reservations`:

- `actual_revenue` = sum of `Room Charges`
- `actual_room_nights` = sum of workbook `Room Nights` / `VN`
- `actual_arr` = room revenue divided by room nights
- exact copy-paste duplicates are quarantined out
- negative cancellation/adjustment rows are included and flagged for admin review

Useful next comparison layer:

- Add a true multi-property picker driven by a URL param:

  ```text
  /dashboard?month=2026-08&compare=CRS,SIX,ASM
  ```

- Add a variance chart showing over/under budget.
- Add a "rank by" control: revenue, variance, reservations, findings.

## Daily pickup

Daily pickup is not the same thing as monthly revenue.

Monthly revenue answers:

```text
How much revenue is currently on the books for this month?
```

Daily pickup answers:

```text
How much did that number change since yesterday's file?
```

Snapshot schema has been added to:

```text
db/schema.sql
db/revenue-snapshots.sql
```

For the existing Supabase project, run this helper query once:

```text
db/revenue-snapshots.sql
```

The dashboard now has a daily pickup section and a pickup-date filter. The first snapshot displays as the baseline; pickup revenue and reservation pickup become meaningful after the next dated snapshot/import.

## Existing-project SQL still to run

Run this once in Supabase SQL Editor:

```text
db/operational-truth-upgrade.sql
```

Then run ingestion again. This adds `period_month`, refreshes the clean monthly revenue view, and creates `v_monthly_segment_revenue`, where actuals come from booking rows and budget targets come from the parsed workbook matrix.

After that, each ingestion run will save current monthly totals into `revenue_snapshot`. The `v_daily_pickup` view compares the latest snapshot against the previous snapshot for the same property and month. Pickup will be blank on the first snapshot and meaningful once there are at least two dated snapshots.

Dashboard fields:

- Pickup today
- Pickup since last ingest
- Month-to-date actual
- Budget remaining
- Pace versus budget

## Feature build order

Build in this order:

1. **Budget ingestion - done**
   The existing `budget` table is now filled from the Excel workbooks.

2. **Budget UI - done**
   KPI cards, hero totals, and the comparison table now show real budget, variance, and percent variance.

3. **Property comparison - partly done**
   The matrix, comparison table, and actual-vs-budget chart exist for the currently visible properties. A custom multi-property picker is still next.

4. **Revenue snapshots**
   SQL and importer support are added. Run `db/revenue-snapshots.sql` in Supabase, then run ingestion again to start collecting snapshots.

5. **Daily pickup UI - done**
   Snapshot-backed pickup cards and a pickup-date selector are wired. Pickup remains a baseline until there is more than one dated snapshot.

6. **Data-quality review workflow**
   Add filters and grouping for critical/warning findings so operations can fix source spreadsheet issues.

7. **Exports**
   Add Excel/PDF export after the dashboard numbers and comparisons are trusted.

8. **Automation**
   Move the local ingestion command to a scheduled GitHub Action or another trusted runner.

## Known data issues to resolve

- July Crystal Sands has a known LKR 37,000 difference between the cleaned dashboard number and the workbook report because the workbook report includes a duplicate reservation row that the cleaned layer excludes. This is intentionally parked for later review.
- Several workbooks have critical quality findings such as departure-before-arrival or negative confirmed revenue.
- Some Asaya Sands rows look like real bookings but have blank reservation numbers. The current parser skips blank reservation numbers to avoid importing planning rows.
- Duplicate copy-paste rows are logged as data-quality findings and the duplicate copy is not stored in clean dashboard rows.

## Practical next step

The next concrete engineering task should be:

```text
Add a multi-property comparison picker and variance chart.
```

Once that is done, the dashboard can compare custom property sets more cleanly than entity/property filtering alone.
