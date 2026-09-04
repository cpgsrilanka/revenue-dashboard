-- Align dashboard actual revenue with the workbook Revenue & Pickup Report.
--
-- The report tab's "Actual 26/27 / Revenue (Incl Taxes)" values match the
-- All Bookings sheet's Room Charges column, not Total Booking Value. Negative
-- cancelled rows are part of that net report total, so the dashboard view
-- includes them instead of filtering them out.

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

alter view v_monthly_revenue set (security_invoker = true);
grant select on v_monthly_revenue to authenticated;
