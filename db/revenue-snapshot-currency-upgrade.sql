-- Currency-safe daily pickup snapshots.
-- Run once in the existing Supabase project before the next ingestion run.

alter table revenue_snapshot
  drop constraint if exists revenue_snapshot_property_code_snapshot_date_period_month_key;

alter table revenue_snapshot
  drop constraint if exists revenue_snapshot_property_currency_snapshot_key;

alter table revenue_snapshot
  add constraint revenue_snapshot_property_currency_snapshot_key
  unique (property_code, snapshot_date, period_month, currency);

drop view if exists v_daily_pickup;

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

alter view v_daily_pickup set (security_invoker = true);
grant select on v_daily_pickup to authenticated;
