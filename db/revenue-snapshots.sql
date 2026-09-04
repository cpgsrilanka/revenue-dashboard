-- Daily pickup foundation.
-- Run this in Supabase SQL Editor after db/schema.sql for existing projects.

create table if not exists revenue_snapshot (
  id bigserial primary key,
  property_code text not null references property_master(property_code),
  snapshot_date date not null default current_date,
  period_month date not null,
  actual_revenue numeric(14,2) not null default 0,
  reservation_count integer not null default 0,
  currency text not null default 'LKR',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (property_code, snapshot_date, period_month)
);

create index if not exists idx_revenue_snapshot_lookup
  on revenue_snapshot(property_code, period_month, snapshot_date desc);

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

alter table revenue_snapshot enable row level security;

grant select on revenue_snapshot to authenticated;
grant select on v_daily_pickup to authenticated;

drop policy if exists "authenticated can read revenue snapshots" on revenue_snapshot;
create policy "authenticated can read revenue snapshots"
  on revenue_snapshot for select
  to authenticated
  using (true);
