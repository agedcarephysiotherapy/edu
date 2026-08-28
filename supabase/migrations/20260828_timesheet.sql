-- Staff "Sign In / Sign Out" timesheet feature.
--
-- Both tables are written EXCLUSIVELY by the service-role key inside the
-- `timesheet` Edge Function — there are deliberately no insert/update RLS
-- policies for `authenticated`/`anon` at all, on either table. This is what
-- makes `raw_hours` (computed server-side from signed_in_at/signed_out_at)
-- immutable from the client: there is no client-reachable write path to
-- this table other than through the function, which never trusts a
-- client-sent raw_hours value.

create table if not exists public.timesheet_entries (
  id uuid primary key default gen_random_uuid(),
  staff_id uuid not null references public.profiles(id),
  signed_in_at timestamptz not null,
  signed_out_at timestamptz,
  in_lat numeric,
  in_lng numeric,
  out_lat numeric,
  out_lng numeric,
  in_address text,
  out_address text,
  -- Authoritative, server-computed (signed_out_at - signed_in_at) in hours,
  -- rounded to 2dp. Never accepted from the client.
  raw_hours numeric,
  -- Defaults to raw_hours but the staff member can adjust it at sign-out
  -- time (e.g. to exclude an unpaid lunch break).
  payable_hours numeric,
  status text not null default 'open' check (status in ('open', 'closed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists timesheet_entries_staff_signed_in_idx
  on public.timesheet_entries (staff_id, signed_in_at desc);

alter table public.timesheet_entries enable row level security;

create policy "staff can read their own timesheet entries"
  on public.timesheet_entries for select
  to authenticated
  using (staff_id = auth.uid());

create policy "managers can read all timesheet entries"
  on public.timesheet_entries for select
  to authenticated
  using (
    exists (
      select 1 from public.profiles
      where profiles.id = auth.uid() and profiles.role = 'manager'
    )
  );

-- No insert/update policies at all — all writes happen exclusively through
-- the service-role key inside the `timesheet` Edge Function.

create table if not exists public.timesheet_gps_failures (
  id uuid primary key default gen_random_uuid(),
  staff_id uuid not null references public.profiles(id),
  attempted_action text not null check (attempted_action in ('sign_in', 'sign_out')),
  error_type text not null check (error_type in ('permission_denied', 'position_unavailable', 'timeout')),
  created_at timestamptz not null default now()
);

alter table public.timesheet_gps_failures enable row level security;

create policy "staff can read their own gps failures"
  on public.timesheet_gps_failures for select
  to authenticated
  using (staff_id = auth.uid());

create policy "managers can read all gps failures"
  on public.timesheet_gps_failures for select
  to authenticated
  using (
    exists (
      select 1 from public.profiles
      where profiles.id = auth.uid() and profiles.role = 'manager'
    )
  );

-- No insert policy — service-role only, from the `timesheet` Edge
-- Function's report_gps_failure action.
