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
  nights                  integer,
  room_revenue            numeric(14,2),
  fnb_revenue             numeric(14,2),
  other_revenue           numeric(14,2),
  total_revenue           numeric(14,2),
  currency                text,
  revenue_base_currency   numeric(14,2),          -- converted to group reporting currency, if applicable
  status                  text check (status in ('confirmed', 'cancelled', 'no_show', 'checked_out', 'unknown')),
  channel                 text,                    -- OTA / direct / walk-in, if available
  is_quarantined          boolean not null default false,
  quarantine_reason       text,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  unique (property_code, reservation_id)
);

create index idx_clean_reservations_property_dates on clean_reservations(property_code, guest_arrival_date);
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
-- 7. Convenience view for the dashboard: monthly revenue by property,
--    excluding quarantined rows, with budget joined in.
-- ----------------------------------------------------------------------------
create view v_monthly_revenue as
select
  cr.property_code,
  pm.name as property_name,
  pm.entity,
  date_trunc('month', cr.guest_arrival_date)::date as period_month,
  sum(cr.total_revenue) filter (where cr.status not in ('cancelled', 'no_show')) as actual_revenue,
  count(*) filter (where cr.status not in ('cancelled', 'no_show')) as reservation_count,
  b.budgeted_revenue,
  cr.currency
from clean_reservations cr
join property_master pm on pm.property_code = cr.property_code
left join budget b
  on b.property_code = cr.property_code
  and b.period_month = date_trunc('month', cr.guest_arrival_date)::date
where cr.is_quarantined = false
group by cr.property_code, pm.name, pm.entity, date_trunc('month', cr.guest_arrival_date), b.budgeted_revenue, cr.currency;

-- ----------------------------------------------------------------------------
-- Seed the property master — filenames confirmed against the real
-- CPG-Reservations SharePoint site (Databases/FY 26-27/ folder), Aug 2026.
-- Kotiyagala had a database file but the property was terminated — not
-- seeded here. Serenity Villa is upcoming; seeded inactive until its file
-- and adapter config are confirmed live.
-- ----------------------------------------------------------------------------
insert into property_master (property_code, name, entity, sharepoint_filename_match, pms_type, active) values
  ('CRS', 'Crystal Sands',  'CPG', 'Crystal Sands Database', 'Opera Cloud', true),
  ('SIX', 'The Six',        'CPG', 'The Six Database',       'Opera Cloud', true),
  ('ASM', 'Asaya Sands',    'OGH', 'Asaya Sands Database',   'Opera Cloud', true),
  ('LYN', '77 Leyn Baan',   'OGH', 'Leyn Baan Database',     null,          true),
  ('KIR', 'Kirana Villa',   'OGH', 'Kirana Database',        null,          true),
  ('SOL', 'Sol House',      'OGH', 'Sol House Database',     null,          true),
  ('SRN', 'Serenity Villa', 'OGH', 'Serenity Villa Database', null,        false);
