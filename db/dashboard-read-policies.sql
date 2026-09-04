-- Dashboard read-only access for signed-in Supabase users.
-- Run this after db/schema.sql has created the tables and view.

alter view v_monthly_revenue set (security_invoker = true);
alter view v_monthly_segment_revenue set (security_invoker = true);
alter view v_daily_pickup set (security_invoker = true);

grant usage on schema public to authenticated;
grant select on property_master, ingestion_log, clean_reservations, data_quality_log, budget, monthly_segment_report, revenue_snapshot to authenticated;
grant select on v_monthly_revenue, v_monthly_segment_revenue, v_daily_pickup to authenticated;

drop policy if exists "authenticated can read property master" on property_master;
create policy "authenticated can read property master"
  on property_master for select
  to authenticated
  using (true);

drop policy if exists "authenticated can read ingestion log" on ingestion_log;
create policy "authenticated can read ingestion log"
  on ingestion_log for select
  to authenticated
  using (true);

drop policy if exists "authenticated can read clean reservations" on clean_reservations;
create policy "authenticated can read clean reservations"
  on clean_reservations for select
  to authenticated
  using (true);

drop policy if exists "authenticated can read data quality log" on data_quality_log;
create policy "authenticated can read data quality log"
  on data_quality_log for select
  to authenticated
  using (true);

drop policy if exists "authenticated can read budget" on budget;
create policy "authenticated can read budget"
  on budget for select
  to authenticated
  using (true);

drop policy if exists "authenticated can read monthly segment report" on monthly_segment_report;
create policy "authenticated can read monthly segment report"
  on monthly_segment_report for select
  to authenticated
  using (true);

drop policy if exists "authenticated can read revenue snapshots" on revenue_snapshot;
create policy "authenticated can read revenue snapshots"
  on revenue_snapshot for select
  to authenticated
  using (true);
