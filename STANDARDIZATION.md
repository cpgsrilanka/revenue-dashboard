# Standardizing the reservation exports

## Status update: most of this is already done

Good news, discovered during the Phase 1 file audit: **every property except possibly one already exports on a single consistent template.** Crystal Sands, The Six, Sol House, Kirana Villa, and Leyn Baan were all independently confirmed to use the exact same "All Bookings" sheet with the exact same 29 columns. Asaya Sands is very likely the same (matching "Drop Downs" reference data, matching sheet count) but wasn't directly re-confirmed. Serenity Villa has no file yet.

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

- **Spot-check Asaya Sands.** Open its current-year file and confirm the `All Bookings` sheet matches this shape exactly. Everything points to yes; nobody's looked directly yet.
- **Extend the mapping if useful later.** `Room Type`, `Meal Charges`, `Nationality`, and a few others are real columns nobody's wired into the pipeline yet — natural candidates if a future dashboard feature wants room-type or nationality breakdowns.
- **No migration project needed.** The thing this document used to propose as future work turned out to already be current reality.
