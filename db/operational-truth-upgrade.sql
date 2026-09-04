-- Operational truth upgrade.
-- Run this once in Supabase SQL Editor, then run the ingestion again.
--
-- Actuals are calculated from clean All Bookings rows:
--   - revenue = Room Charges
--   - FNB/meal = Meal Charges, kept separate
--   - month = workbook Month column when available
--   - villa/room nights = workbook Room Nights/VN column when available
--
-- The workbook matrix remains useful for segment budgets, but it is no
-- longer the source for actual revenue.

drop view if exists v_daily_pickup;
drop view if exists v_monthly_segment_revenue;
drop view if exists v_monthly_revenue;

alter table clean_reservations
  add column if not exists period_month date,
  add column if not exists segment text,
  add column if not exists fnb_revenue numeric(14,2),
  add column if not exists room_revenue numeric(14,2);

alter table clean_reservations
  alter column nights type numeric(12,2)
  using nights::numeric;

create index if not exists idx_clean_reservations_property_period
  on clean_reservations(property_code, period_month);

create or replace view v_monthly_revenue as
select
  cr.property_code,
  pm.name as property_name,
  pm.entity,
  coalesce(cr.period_month, date_trunc('month', cr.guest_arrival_date)::date) as period_month,
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

create or replace view v_monthly_segment_revenue as
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

alter view v_monthly_revenue set (security_invoker = true);
alter view v_monthly_segment_revenue set (security_invoker = true);

grant select on v_monthly_revenue, v_monthly_segment_revenue to authenticated;
grant select on clean_reservations, monthly_segment_report, budget to authenticated;

create or replace view v_daily_pickup as
with latest as (
  select distinct on (property_code, period_month)
    property_code,
    snapshot_date,
    period_month,
    actual_revenue,
    reservation_count,
    currency
  from revenue_snapshot
  order by property_code, period_month, snapshot_date desc, updated_at desc
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
    and prior.snapshot_date < latest.snapshot_date
  order by prior.snapshot_date desc, prior.updated_at desc
  limit 1
) previous on true;

alter view v_daily_pickup set (security_invoker = true);
grant select on v_daily_pickup to authenticated;
