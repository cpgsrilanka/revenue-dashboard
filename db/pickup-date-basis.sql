-- Pickup date basis upgrade.
-- Run this once in Supabase SQL Editor, then run ingestion again.
--
-- The Excel reports are not consistent:
--   - ASM / CRS Date Selector uses Date of Reservation
--   - KIR / LYN / SIX Date Selector uses Confirmation Date
--   - SOL has a Confirmation Date slicer and an Arrival slicer; pickup uses Confirmation Date
--
-- The importer now writes clean_reservations.pickup_date from each property's
-- configured Excel pickup field.

alter table clean_reservations
  add column if not exists pickup_date date;

update clean_reservations
set pickup_date = booking_date
where pickup_date is null;

create index if not exists idx_clean_reservations_pickup_date
  on clean_reservations(pickup_date);

grant select on clean_reservations to authenticated;
