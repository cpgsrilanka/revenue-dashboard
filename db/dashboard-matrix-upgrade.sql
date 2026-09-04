-- Dashboard matrix + meal/FNB upgrade.
-- Run this once in Supabase SQL Editor for the existing project.

alter table clean_reservations
  add column if not exists segment text;

create table if not exists monthly_segment_report (
  id bigserial primary key,
  property_code text not null references property_master(property_code),
  period_month date not null,
  segment text not null,
  budget_revenue numeric(14,2) not null default 0,
  budget_room_nights numeric(12,2) not null default 0,
  budget_arr numeric(14,2) not null default 0,
  actual_revenue numeric(14,2) not null default 0,
  actual_room_nights numeric(12,2) not null default 0,
  actual_arr numeric(14,2) not null default 0,
  balance_revenue numeric(14,2) not null default 0,
  balance_room_nights numeric(12,2) not null default 0,
  currency text not null default 'LKR',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (property_code, period_month, segment)
);

create index if not exists idx_monthly_segment_report_lookup
  on monthly_segment_report(property_code, period_month);

create or replace view v_monthly_revenue as
select
  cr.property_code,
  pm.name as property_name,
  pm.entity,
  date_trunc('month', cr.guest_arrival_date)::date as period_month,
  sum(coalesce(cr.room_revenue, cr.total_revenue)) as actual_revenue,
  count(*) as reservation_count,
  b.budgeted_revenue,
  cr.currency,
  sum(coalesce(cr.room_revenue, 0)) as room_revenue,
  sum(coalesce(cr.fnb_revenue, 0)) as fnb_revenue,
  sum(coalesce(cr.total_revenue, 0)) as total_booking_value
from clean_reservations cr
join property_master pm on pm.property_code = cr.property_code
left join budget b
  on b.property_code = cr.property_code
  and b.period_month = date_trunc('month', cr.guest_arrival_date)::date
where cr.is_quarantined = false
  and cr.guest_arrival_date is not null
group by cr.property_code, pm.name, pm.entity, date_trunc('month', cr.guest_arrival_date), b.budgeted_revenue, cr.currency;

alter view v_monthly_revenue set (security_invoker = true);

alter table monthly_segment_report enable row level security;

grant select on monthly_segment_report to authenticated;
grant select on v_monthly_revenue to authenticated;

drop policy if exists "authenticated can read monthly segment report" on monthly_segment_report;
create policy "authenticated can read monthly segment report"
  on monthly_segment_report for select
  to authenticated
  using (true);
