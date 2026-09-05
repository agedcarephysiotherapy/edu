-- Timesheet event notifications for managers.
-- Creates an in-app notification record for every successful sign-in and
-- sign-out. The frontend can subscribe to this table with Supabase Realtime
-- and surface it as a browser push/notification without sending an email
-- for every normal timesheet event.

create table if not exists public.staff_notifications (
  id uuid primary key default gen_random_uuid(),
  recipient_id uuid not null references public.profiles(id) on delete cascade,
  event_type text not null check (event_type in ('timesheet_sign_in', 'timesheet_sign_out')),
  title text not null,
  body text not null,
  timesheet_entry_id uuid references public.timesheet_entries(id) on delete cascade,
  created_at timestamptz not null default now(),
  read_at timestamptz
);

create index if not exists staff_notifications_recipient_created_idx
  on public.staff_notifications(recipient_id, created_at desc);

alter table public.staff_notifications enable row level security;

create policy "Users can read their own notifications"
  on public.staff_notifications
  for select
  to authenticated
  using (recipient_id = auth.uid());

create policy "Users can mark their own notifications read"
  on public.staff_notifications
  for update
  to authenticated
  using (recipient_id = auth.uid())
  with check (recipient_id = auth.uid());

create or replace function public.notify_managers_of_timesheet_event()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  staff_name text;
  event_type_value text;
  title_value text;
  body_value text;
begin
  select coalesce(full_name, email, 'A staff member')
    into staff_name
  from public.profiles
  where id = new.staff_id;

  if TG_OP = 'INSERT' and new.status = 'open' then
    event_type_value := 'timesheet_sign_in';
    title_value := 'Staff member signed in';
    body_value := staff_name || ' signed in at ' || to_char(new.signed_in_at at time zone 'Australia/Melbourne', 'd Mon yyyy, h:mi am');
  elsif TG_OP = 'UPDATE' and new.status = 'closed' and old.status is distinct from 'closed' then
    event_type_value := 'timesheet_sign_out';
    title_value := 'Staff member signed out';
    body_value := staff_name || ' signed out at ' || to_char(new.signed_out_at at time zone 'Australia/Melbourne', 'd Mon yyyy, h:mi am')
      || ' (' || coalesce(new.payable_hours, new.raw_hours, 0)::text || ' payable hours).';
  else
    return new;
  end if;

  insert into public.staff_notifications (recipient_id, event_type, title, body, timesheet_entry_id)
  select id, event_type_value, title_value, body_value, new.id
  from public.profiles
  where role = 'manager' and status = 'approved';

  return new;
end;
$$;

drop trigger if exists timesheet_event_manager_notification on public.timesheet_entries;
create trigger timesheet_event_manager_notification
after insert or update of status on public.timesheet_entries
for each row execute function public.notify_managers_of_timesheet_event();

-- Enable Realtime delivery for the new notification table. If the table is
-- already present in the publication, this statement may be skipped by the
-- deployment tool; the notification rows remain the source of truth.
do $$
begin
  begin
    alter publication supabase_realtime add table public.staff_notifications;
  exception when duplicate_object then
    null;
  end;
end $$;
