# PMS Ingestion Cutover

## Purpose

The adapters support one source format per PMS while retaining the existing
property workbooks as a fallback. Do not enable a PMS adapter until its export
has passed a dry run and its totals have been reconciled to the PMS.

## SharePoint Intake Folders

Create these folders in the Databases drive:

```text
PMS Exports/
  OPERA/
  Exely/
  HotelTime/
```

Store only the latest full export for each property in its PMS folder. The
nightly job treats each enabled PMS file as the current snapshot.

Use stable file names:

```text
OPERA/Crystal Sands Reservation Detail.xml
OPERA/Asaya Sands Reservation Detail.xml
Exely/Sol House Reservation Report.xlsx
Exely/Leyn Baan Reservation Report.xlsx
Exely/Kirana Reservation Report.xlsx
Exely/Serenity Reservation Report.xlsx
HotelTime/The Six Reservation Report.xlsx
HotelTime/Rekawa Reach Reservation Report.xlsx
```

## Before Enabling A Property

1. Run `db/pms-source-adapters-upgrade.sql` in the Supabase SQL editor.
2. Upload a full export covering the previous 90 days and next 18 months.
3. Set that property's `pms.enabled` value to `true` in `config/properties.yaml`.
4. Run `npm run ingest:dry-run` and reconcile row counts, room nights,
   statuses, and each currency separately against the PMS report.
5. In a reviewed cutover change, set `pms.replace_legacy_clean_rows` to `true`.
   The first production run then upserts the PMS snapshot and deletes only that
   property's legacy **clean** rows, so the dashboard cannot double count it.
   Raw Excel rows and ingestion logs remain for audit.
6. Run one production ingestion and reconcile the dashboard again.

## Source Notes

- OPERA XML: uses `RESV_NAME_ID` as the stable record key. The current
  `res_detail` export has a rate amount but not a validated total-stay value,
  so its adapter ingests room nights and booking status but deliberately does
  not publish revenue totals until they are reconciled.
- Exely XLSX: uses `Booking No.` as the stable record key. `Total amount` is
  currently treated as the gross booking value and the Options sheet is not
  added again, preventing double counting.
- HotelTime XLSX: uses a composite reservation/stay/room key because a single
  reservation can have multiple rooms or split stays. `Total inc. VAT` is the
  gross booking value and `Total for accommodation` is room revenue.
- The dashboard must never sum different currencies directly. Each source
  amount remains in its source currency until a finance-approved FX rule is
  added.
