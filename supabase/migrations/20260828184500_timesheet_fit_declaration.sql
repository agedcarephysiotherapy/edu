-- Staff must tick a "fit to work today" declaration before signing in.
-- Recorded per-entry for audit purposes (not just enforced client-side) —
-- the Edge Function requires this to be true before it will create the
-- sign-in row, same as it requires a successful GPS fix.
alter table public.timesheet_entries
  add column if not exists fit_to_work_declared boolean not null default false;
