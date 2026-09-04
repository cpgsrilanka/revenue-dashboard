# Standardizing the reservation exports

## Status update: most of this is already done

Good news, discovered during the Phase 1 file audit and the live workbook dry-run: **the main properties already export on a shared `All Bookings` pattern.** Crystal Sands, The Six, Sol House, Kirana Villa, Leyn Baan, and Asaya Sands have current-year workbooks in the FY 26-27 SharePoint folder. Serenity Villa also now has a current-year workbook, but it is still treated separately until launch/active status is confirmed.

That means the standardization problem this document originally worried about — six properties, six bespoke formats — mostly doesn't exist. What follows documents the **real, already-live template** (not a hypothetical improved one), so a new property launches on it directly and nobody re-derives it from scratch.

## The template, as it actually exists today

One sheet named `All Bookings`, 29 columns, confirmed identically across five files:

| Column | Notes |
| --- | --- |
| `Agent` | Booking agent name; not currently mapped into the pipeline |
| `Confirmation Date` | |
| `Date of Reservation` | Mapped to `booking_date` |
| `Reservation No.` | Alphanumeric (e.g. `20260403-504092-1249892806`), **not unique per row** — see below |
| `Room Type` | Villa/room name, differs per property (e.g. "Entire Villa", "Master Suite") — not currently mapped |
| `Month`, `Financial Year`, `Week` | Derived/formula columns, not mapped |
| `Arrival`, `Departure` | Mapped to `guest_arrival_date` / `guest_departure_date`; formatted `16-Mar-26` (day-month name-year) |
| `Guest Name` | |
| `Source` | Mapped to `channel` |
| `Segment` | |
| `Booking Source Channel`, `Travel Agent`, `Nationality` | Not currently mapped |
| `Rooms`, `Room Nights`, `Adults`, `Children`, `Infants`, `Pax` | Not currently mapped |
| `Basis` | RO / BB / HB / FB |
| `Marketing Code` | |
| `Room Charges` | Mapped to `room_revenue` |
| `Meal Charges` | Not currently mapped (could feed `other_revenue` later) |
| `Total Booking Value` | Mapped to `total_revenue` |
| `Payment Status` | Mapped to `status` — real values: `Vouchered`, `Deposit Paid`, `Pending Payment`, `Full Payment`, `Cancelled` |
| `Remarks` | |

A hidden `Updated Budget (26-27)` sheet inside the same workbook holds budget data. A hidden or visible `Drop Downs` sheet holds the reference lists (payment statuses, room types, sources, nationalities) used for data entry — useful for confirming what values `Payment Status` etc. can actually take.

**Real quirks worth knowing, not flaws to fix:**
- **`Reservation No.` is not a unique key.** A multi-room booking spans several rows sharing one number; a rebooking to new dates can reuse the original number with a negative reversal row plus a new positive row. This is legitimate, not a data error — see the dedup logic in `qualityChecks.js`.
- **The sheet contains thousands of blank-ID forecast/room-blocking rows** mixed in with real bookings, running out to FY 2027-28. These aren't reservations — they're a planning/blocking template baked into the same sheet. Filtered automatically by the blank-`Reservation No.` rule.
- **A `#REF!` or `#VALUE!` occasionally appears** in formula-derived cells (`Financial Year`, `Remarks`) on real rows — cosmetic breakage in the source spreadsheet, doesn't affect any mapped column.

## What this means for a new property

Serenity Villa (or any future addition) should launch directly on this template — there's no legacy format to migrate away from, so its `properties.yaml` entry is just:

```yaml
SRN: *all_bookings_template
```

reusing the same YAML anchor every other property already points at. No new code, no new adapter logic — just a row in `property_master` and confirmation that the export follows the shape above.

## What's actually left to do

- **Resolve blank reservation numbers.** Asaya Sands dry-parses, but a handful of real-looking rows have no `Reservation No.`; the current parser skips blank-ID rows to avoid importing planning/blocking rows. Correct those rows in the workbook or add a deliberate synthetic-ID rule before production ingestion.
- **Extend the mapping if useful later.** `Room Type`, `Meal Charges`, `Nationality`, and a few others are real columns nobody's wired into the pipeline yet — natural candidates if a future dashboard feature wants room-type or nationality breakdowns.
- **No migration project needed.** The thing this document used to propose as future work turned out to already be current reality.

## Workbook governance pass

A repeatable governance tool now exists in `ingestion/workbookGovernance.js`. Its purpose is to make the `All Bookings` sheets harder to corrupt accidentally.

It does four things:

- Downloads each active property workbook from SharePoint and stores a local backup.
- Standardizes important `All Bookings` headers to the dashboard contract, for example `VN` / `RN` -> `Room Nights`, `Meal Charges(HB/FB/Other)` -> `Meal Charges`, and `Villa` -> `Room Type`.
- Adds dropdowns and validation rules for `Segment`, `Payment Status`, `Basis`, dates, stay dates, room nights, room revenue, meal/FNB revenue, and total booking value.
- Protects report/support sheets and lightly protects `All Bookings` while leaving booking-entry cells editable.

Run the safe local pass:

```bash
cd ingestion
npm run workbooks:standardize
```

The safe pass creates a timestamped folder under `ingestion/governance-runs/` with:

- `backups/`: original SharePoint files as downloaded
- `standardized/`: cleaned and protected local copies
- `summary.json`: row counts and parse status

The first full dry run on 20 Aug 2026 succeeded for all six active FY 26-27 files with zero dashboard parse errors:

| Property | Clean dashboard rows |
| --- | ---: |
| ASM | 364 |
| CRS | 931 |
| KIR | 40 |
| LYN | 57 |
| SIX | 301 |
| SOL | 61 |

Important safety note: this tool uses `openpyxl`, which can rewrite workbook files without preserving every Excel Online-only feature such as slicers and some advanced validation extensions. For that reason, live SharePoint replacement is blocked by default. Review the standardized copies first, or use an in-Excel/Office Script approach for live in-place locking when preserving workbook report objects is mandatory.

## Safe live-workbook locking

Use `ingestion/workbookGovernance.office-script.ts` for the live SharePoint files. Open each workbook in Excel Online, go to **Automate -> New Script**, paste the script, and run it.

This is safer than uploading the `standardized/` `.xlsx` files from the dry run because the script edits the workbook inside Excel itself. It preserves workbook objects that a file-rewrite library may not preserve, including pivots, slicers, and Excel Online extensions.

## Daily pickup field audit

The Excel report's visible `Date Selector` slicer does not use the same source field in every workbook:

| Property | Excel pickup date source |
| --- | --- |
| ASM | `Date of Reservation` |
| CRS | `Date of Reservation` |
| KIR | `Confirmation Date` |
| LYN | `Confirmation Date` |
| SIX | `Confirmation Date` |
| SOL | `Confirmation Date` plus a separate `Arrival` slicer |

The dashboard now supports a clean `pickup_date` column populated from each property's configured pickup source. Run `db/pickup-date-basis.sql`, then run ingestion again to make the live dashboard match the Excel report basis.
