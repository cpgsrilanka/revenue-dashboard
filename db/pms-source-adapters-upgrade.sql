-- PMS source-adapter upgrade.
-- Run once in the existing Supabase project before enabling a PMS source.
-- It adds stable PMS record keys so a daily snapshot updates amendments and
-- cancellations instead of creating duplicate clean reservation rows.

alter table clean_reservations
  add column if not exists source_system text,
  add column if not exists source_record_id text,
  add column if not exists source_updated_at date,
  add column if not exists source_snapshot_id text,
  add column if not exists source_rate_amount numeric(14,2),
  add column if not exists source_deposit_paid numeric(14,2),
  add column if not exists source_outstanding_balance numeric(14,2);

-- Existing workbook rows remain traceable and continue using their current
-- conflict key. A synthetic source identifier prevents null legacy rows from
-- colliding with future PMS records.
update clean_reservations
set
  source_system = coalesce(source_system, 'legacy_excel'),
  source_record_id = coalesce(source_record_id, 'legacy:' || id::text)
where source_system is null or source_record_id is null;

alter table clean_reservations
  drop constraint if exists clean_reservations_source_record_key;

alter table clean_reservations
  add constraint clean_reservations_source_record_key
  unique (property_code, source_system, source_record_id);

create index if not exists idx_clean_reservations_source_snapshot
  on clean_reservations (property_code, source_system, source_snapshot_id);

update property_master
set pms_type = case property_code
  when 'CRS' then 'Opera Cloud'
  when 'ASM' then 'Opera Cloud'
  when 'SIX' then 'HotelTime'
  when 'LYN' then 'Exely'
  when 'KIR' then 'Exely'
  when 'SOL' then 'Exely'
  when 'SRN' then 'Exely'
  else pms_type
end;

comment on column clean_reservations.source_system is
  'Origin adapter, for example legacy_excel, opera, exely, or hoteltime.';
comment on column clean_reservations.source_record_id is
  'Stable source record key. PMS feeds use this for amendment-safe upserts.';
