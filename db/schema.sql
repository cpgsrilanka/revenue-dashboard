-- ============================================================================
-- Revenue Dashboard — Data Warehouse Schema
-- Run this in the Supabase SQL editor (or via `supabase db push`) to set up
-- the raw + clean + data-quality layers described in the architecture plan.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Property master — the single source of truth for "what properties exist"
--    Adding a new property is a row here, not a code change.
-- ----------------------------------------------------------------------------
create table property_master (
  property_code             text primary key,          -- short code, e.g. 'CRS', 'SIX', 'ASM'
  name                      text not null,              -- display name, e.g. 'Crystal Sands'
  entity                    text not null check (entity in ('CPG', 'OGH')),
  currency                  text not null default 'LKR',
  pms_type                  text,                       -- e.g. 'Opera Cloud', 'manual', etc. (informational)
  -- Real layout confirmed: all properties' files sit in one shared SharePoint
  -- folder (Databases/FY {year}/), one workbook per property, matched by
  -- filename rather than a per-property subfolder.
  sharepoint_filename_match text not null,              -- substring to match, e.g. 'Crystal Sands Database'
  format_standardized       boolean not null default false, -- true once this property's export follows the standard template (see STANDARDIZATION.md)
  active                    boolean not null default true,
  created_at                timestamptz not null default now()
);

comment on table property_master is 'Registry of properties. New property = new row here + adapter config, no deploy needed.';

-- ----------------------------------------------------------------------------
-- 2. Ingestion log — tracks every file we've processed, for idempotency and audit
-- ----------------------------------------------------------------------------
create table ingestion_log (
  id                      bigserial primary key,
  property_code           text not null references property_master(property_code),
  file_name               text not null,
  file_hash               text not null,          -- content hash, so re-uploads of identical files are no-ops
  sharepoint_modified_at  timestamptz,
  ingested_at             timestamptz not null default now(),
  row_count               integer,
  status                  text not null check (status in ('success', 'failed', 'partial')),
  error_message           text,
  unique (property_code, file_name, file_hash)
);

create index idx_ingestion_log_property on ingestion_log(property_code, ingested_at desc);

-- ----------------------------------------------------------------------------
-- 3. Raw reservations — landed data, essentially untouched. One row per
--    source spreadsheet row, stored as JSONB so schema drift never breaks
--    ingestion — it just shows up oddly in the raw JSON and fails downstream
--    validation, where we want it to fail loudly.
-- ----------------------------------------------------------------------------
create table raw_reservations (
  id                  bigserial primary key,
  property_code       text not null references property_master(property_code),
  ingestion_log_id    bigint not null references ingestion_log(id),
  source_file         text not null,
  source_row_number   integer,
  raw_row             jsonb not null,             -- the original row, column-name-as-key
  ingested_at         timestamptz not null default now()
);

create index idx_raw_reservations_property on raw_reservations(property_code, ingested_at desc);
create index idx_raw_reservations_ingestion on raw_reservations(ingestion_log_id);

-- ----------------------------------------------------------------------------
-- 4. Clean reservations — the unified schema every property's data gets
--    mapped into. This is what the dashboard queries.
-- ----------------------------------------------------------------------------
create table clean_reservations (
  id                      bigserial primary key,
  reservation_id          text not null,
  property_code           text not null references property_master(property_code),
  raw_reservation_id      bigint references raw_reservations(id),
  guest_arrival_date      date,
  guest_departure_date    date,
  booking_date            date,
  pickup_date             date,
  period_month            date,
  nights                  numeric(12,2),
  room_revenue            numeric(14,2),
  fnb_revenue             numeric(14,2),
  other_revenue           numeric(14,2),
  total_revenue           numeric(14,2),
  currency                text,
  revenue_base_currency   numeric(14,2),          -- converted to group reporting currency, if applicable
  source_system           text,                    -- legacy_excel / opera / exely / hoteltime
  source_record_id        text,                    -- stable source booking-line key
  source_updated_at       date,
  source_snapshot_id      text,
  source_rate_amount      numeric(14,2),
  source_deposit_paid     numeric(14,2),
  source_outstanding_balance numeric(14,2),
  status                  text check (status in ('confirmed', 'pending', 'cancelled', 'no_show', 'checked_out', 'unknown')),
  channel                 text,                    -- OTA / direct / walk-in, if available
  segment                 text,                    -- DMC / FIT - Local / OTA / Owner, if available
  is_quarantined          boolean not null default false,
  quarantine_reason       text,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  -- Reservation numbers are not unique per property: multi-room bookings and
  -- rebookings can legitimately repeat the same ID. This matches the duplicate
  -- detector's structural key while still making repeat ingestion idempotent.
  unique nulls not distinct (property_code, reservation_id, guest_arrival_date, guest_departure_date, total_revenue),
  unique (property_code, source_system, source_record_id)
);

create index idx_clean_reservations_property_dates on clean_reservations(property_code, guest_arrival_date);
create index idx_clean_reservations_property_period on clean_reservations(property_code, period_month);
create index idx_clean_reservations_pickup_date on clean_reservations(pickup_date);
create index idx_clean_reservations_quarantined on clean_reservations(is_quarantined) where is_quarantined = true;

-- ----------------------------------------------------------------------------
-- 5. Data quality log — every check result, surfaced on the dashboard's
--    "Data Health" panel.
-- ----------------------------------------------------------------------------
create table data_quality_log (
  id                      bigserial primary key,
  property_code           text references property_master(property_code),
  check_type              text not null check (check_type in
                             ('completeness', 'referential', 'range', 'duplicate',
                              'cross_check', 'currency', 'schema_drift')),
  severity                text not null check (severity in ('info', 'warning', 'critical')),
  message                 text not null,
  related_reservation_id  text,
  detected_at             timestamptz not null default now(),
  resolved                boolean not null default false,
  resolved_at             timestamptz
);

create index idx_dq_log_property_open on data_quality_log(property_code, resolved) where resolved = false;

-- ----------------------------------------------------------------------------
-- 6. Budget — actuals-vs-budget comparison data
-- ----------------------------------------------------------------------------
create table budget (
  id                  bigserial primary key,
  property_code       text not null references property_master(property_code),
  period_month        date not null,              -- first-of-month, e.g. 2026-08-01
  budgeted_revenue    numeric(14,2) not null,
  currency            text not null,
  created_at          timestamptz not null default now(),
  unique (property_code, period_month)
);

-- ----------------------------------------------------------------------------
-- 7. Monthly segment report — the screenshot-style matrix from the workbook's
--    Revenue & Pickup Report sheet.
-- ----------------------------------------------------------------------------
create table monthly_segment_report (
  id                    bigserial primary key,
  property_code         text not null references property_master(property_code),
  period_month          date not null,
  segment               text not null,
  budget_revenue        numeric(14,2) not null default 0,
  budget_room_nights    numeric(12,2) not null default 0,
  budget_arr            numeric(14,2) not null default 0,
  actual_revenue        numeric(14,2) not null default 0,
  actual_room_nights    numeric(12,2) not null default 0,
  actual_arr            numeric(14,2) not null default 0,
  balance_revenue       numeric(14,2) not null default 0,
  balance_room_nights   numeric(12,2) not null default 0,
  currency              text not null default 'LKR',
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  unique (property_code, period_month, segment)
);

create index idx_monthly_segment_report_lookup on monthly_segment_report(property_code, period_month);

-- ----------------------------------------------------------------------------
-- 8. Revenue snapshots — saved after each ingestion run so the dashboard can
--    calculate daily pickup by comparing today's totals against the previous
--    snapshot for the same property/month.
-- ----------------------------------------------------------------------------
create table revenue_snapshot (
  id                  bigserial primary key,
  property_code       text not null references property_master(property_code),
  snapshot_date       date not null default current_date,
  period_month        date not null,
  actual_revenue      numeric(14,2) not null default 0,
  reservation_count   integer not null default 0,
  currency            text not null default 'LKR',
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (property_code, snapshot_date, period_month, currency)
);

create index idx_revenue_snapshot_lookup on revenue_snapshot(property_code, period_month, snapshot_date desc);

-- ----------------------------------------------------------------------------
-- 9. Convenience view for the dashboard: monthly revenue by property,
--    excluding quarantined rows, with budget joined in.
-- ----------------------------------------------------------------------------
create view v_monthly_revenue as
select
  cr.property_code,
  pm.name as property_name,
  pm.entity,
  coalesce(cr.period_month, date_trunc('month', cr.guest_arrival_date)::date) as period_month,
  -- Matches the workbook Revenue & Pickup Report: this report's actual
  -- revenue values come from Room Charges, not Total Booking Value. Negative
  -- cancelled rows are kept because the workbook includes those adjustments.
  sum(coalesce(cr.room_revenue, cr.total_revenue)) as actual_revenue,
  count(*) as reservation_count,
  b.budgeted_revenue,
  cr.currency,
  sum(coalesce(cr.room_revenue, 0)) as room_revenue,
  sum(coalesce(cr.fnb_revenue, 0)) as fnb_revenue,
  sum(coalesce(cr.total_revenue, 0)) as total_booking_value,
  sum(coalesce(cr.nights, 0)) as actual_room_nights
from clean_reservations cr
join property_master pm on pm.property_code = cr.property_code
left join budget b
  on b.property_code = cr.property_code
  and b.period_month = coalesce(cr.period_month, date_trunc('month', cr.guest_arrival_date)::date)
where cr.is_quarantined = false
  and coalesce(cr.period_month, date_trunc('month', cr.guest_arrival_date)::date) is not null
group by
  cr.property_code,
  pm.name,
  pm.entity,
  coalesce(cr.period_month, date_trunc('month', cr.guest_arrival_date)::date),
  b.budgeted_revenue,
  cr.currency;

-- ----------------------------------------------------------------------------
-- 10. Segment-level revenue matrix: actuals are calculated from clean
--     All Bookings rows, while segment budgets come from the workbook budget
--     pivot/table parsed into monthly_segment_report.
-- ----------------------------------------------------------------------------
create view v_monthly_segment_revenue as
with actuals as (
  select
    cr.property_code,
    coalesce(cr.period_month, date_trunc('month', cr.guest_arrival_date)::date) as period_month,
    coalesce(nullif(trim(cr.segment), ''), 'Unassigned') as segment,
    sum(coalesce(cr.room_revenue, cr.total_revenue, 0)) as actual_revenue,
    sum(coalesce(cr.nights, 0)) as actual_room_nights,
    cr.currency
  from clean_reservations cr
  where cr.is_quarantined = false
    and coalesce(cr.period_month, date_trunc('month', cr.guest_arrival_date)::date) is not null
  group by
    cr.property_code,
    coalesce(cr.period_month, date_trunc('month', cr.guest_arrival_date)::date),
    coalesce(nullif(trim(cr.segment), ''), 'Unassigned'),
    cr.currency
),
budgets as (
  select
    property_code,
    period_month,
    coalesce(nullif(trim(segment), ''), 'Unassigned') as segment,
    sum(budget_revenue) as budget_revenue,
    sum(budget_room_nights) as budget_room_nights,
    max(currency) as currency
  from monthly_segment_report
  -- Keep property-level Total rows so the dashboard can allocate monthly budgets
  -- when a workbook does not provide segment-level budget rows.
  where lower(coalesce(segment, '')) <> 'grand total'
  group by property_code, period_month, coalesce(nullif(trim(segment), ''), 'Unassigned')
)
select
  coalesce(a.property_code, b.property_code) as property_code,
  pm.name as property_name,
  pm.entity,
  coalesce(a.period_month, b.period_month) as period_month,
  coalesce(a.segment, b.segment) as segment,
  coalesce(b.budget_revenue, 0) as budget_revenue,
  coalesce(b.budget_room_nights, 0) as budget_room_nights,
  case
    when coalesce(b.budget_room_nights, 0) = 0 then 0
    else coalesce(b.budget_revenue, 0) / nullif(b.budget_room_nights, 0)
  end as budget_arr,
  coalesce(a.actual_revenue, 0) as actual_revenue,
  coalesce(a.actual_room_nights, 0) as actual_room_nights,
  case
    when coalesce(a.actual_room_nights, 0) = 0 then 0
    else coalesce(a.actual_revenue, 0) / nullif(a.actual_room_nights, 0)
  end as actual_arr,
  coalesce(a.actual_revenue, 0) - coalesce(b.budget_revenue, 0) as balance_revenue,
  coalesce(a.actual_room_nights, 0) - coalesce(b.budget_room_nights, 0) as balance_room_nights,
  coalesce(a.currency, b.currency, 'LKR') as currency
from actuals a
full outer join budgets b
  on b.property_code = a.property_code
  and b.period_month = a.period_month
  and b.segment = a.segment
join property_master pm on pm.property_code = coalesce(a.property_code, b.property_code);

-- ----------------------------------------------------------------------------
-- 11. Daily pickup view: latest snapshot minus the previous snapshot for the
--    same property/month.
-- ----------------------------------------------------------------------------
create view v_daily_pickup as
with latest as (
  select distinct on (property_code, period_month, currency)
    property_code,
    snapshot_date,
    period_month,
    actual_revenue,
    reservation_count,
    currency
  from revenue_snapshot
  order by property_code, period_month, currency, snapshot_date desc, updated_at desc
)
select
  latest.property_code,
  pm.name as property_name,
  pm.entity,
  latest.period_month,
  latest.snapshot_date,
  latest.actual_revenue,
  previous.actual_revenue as previous_revenue,
  case
    when previous.actual_revenue is null then null
    else latest.actual_revenue - previous.actual_revenue
  end as pickup_revenue,
  latest.reservation_count,
  previous.reservation_count as previous_reservation_count,
  case
    when previous.reservation_count is null then null
    else latest.reservation_count - previous.reservation_count
  end as pickup_reservations,
  latest.currency
from latest
join property_master pm on pm.property_code = latest.property_code
left join lateral (
  select actual_revenue, reservation_count
  from revenue_snapshot prior
  where prior.property_code = latest.property_code
    and prior.period_month = latest.period_month
    and prior.currency = latest.currency
    and prior.snapshot_date < latest.snapshot_date
  order by prior.snapshot_date desc, prior.updated_at desc
  limit 1
) previous on true;

-- ----------------------------------------------------------------------------
-- 11. Dashboard read access
--
-- The ingestion job writes with a server-side secret key. The web dashboard
-- reads as a signed-in Supabase Auth user, so keep RLS enabled and grant only
-- read access to the dashboard-facing tables/views.
-- ----------------------------------------------------------------------------
alter view v_monthly_revenue set (security_invoker = true);
alter view v_monthly_segment_revenue set (security_invoker = true);
alter view v_daily_pickup set (security_invoker = true);

grant usage on schema public to authenticated;
grant select on property_master, ingestion_log, clean_reservations, data_quality_log, budget, monthly_segment_report, revenue_snapshot to authenticated;
grant select on v_monthly_revenue, v_monthly_segment_revenue, v_daily_pickup to authenticated;

create policy "authenticated can read property master"
  on property_master for select
  to authenticated
  using (true);

create policy "authenticated can read ingestion log"
  on ingestion_log for select
  to authenticated
  using (true);

create policy "authenticated can read clean reservations"
  on clean_reservations for select
  to authenticated
  using (true);

create policy "authenticated can read data quality log"
  on data_quality_log for select
  to authenticated
  using (true);

create policy "authenticated can read budget"
  on budget for select
  to authenticated
  using (true);

create policy "authenticated can read monthly segment report"
  on monthly_segment_report for select
  to authenticated
  using (true);

create policy "authenticated can read revenue snapshots"
  on revenue_snapshot for select
  to authenticated
  using (true);

-- ----------------------------------------------------------------------------
-- Seed the property master — filenames confirmed against the real
-- CPG-Reservations SharePoint site (Databases/FY 26-27/ folder), Aug 2026.
-- Kotiyagala had a database file but the property was terminated — not
-- seeded here. Serenity Villa is upcoming; seeded inactive until its file
-- and adapter config are confirmed live.
-- ----------------------------------------------------------------------------
insert into property_master (property_code, name, entity, sharepoint_filename_match, pms_type, active) values
  ('CRS', 'Crystal Sands',  'CPG', 'Crystal Sands Database', 'Opera Cloud', true),
  ('SIX', 'The Six',        'CPG', 'The Six Database',       'HotelTime', true),
  ('ASM', 'Asaya Sands',    'OGH', 'Asaya Sands Database',   'Opera Cloud', true),
  ('LYN', '77 Leyn Baan',   'OGH', 'Leyn Baan Database',     'Exely',       true),
  ('KIR', 'Kirana Villa',   'OGH', 'Kirana Database',        'Exely',       true),
  ('SOL', 'Sol House',      'OGH', 'Sol House Database',     'Exely',       true),
  ('SRN', 'Serenity Villa', 'OGH', 'Serenity Villa Database', 'Exely',     false);
