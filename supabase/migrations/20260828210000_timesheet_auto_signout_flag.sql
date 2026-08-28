alter table public.timesheet_entries
  add column if not exists auto_signed_out boolean not null default false;

comment on column public.timesheet_entries.auto_signed_out is
  'true when this entry was closed automatically after 9 hours open (staff forgot to sign out), rather than by the staff member signing out themselves. out_lat/out_lng/out_address are expected to be null for these — no GPS was captured because there was no client action.';
