-- New lookup table for staff categories, replacing the hardcoded JS
-- CATEGORIES/CATEGORY_LABELS constants as the source of truth. Managers can
-- add new categories and rename labels from the "Manage Staff" tab without
-- a code change. `key` is immutable once created (existing profiles /
-- course_categories rows reference it by string) — only `label` is editable
-- from the UI.
create table if not exists public.staff_categories (
  id uuid primary key default gen_random_uuid(),
  key text unique not null,
  label text not null,
  sort_order int not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

alter table public.staff_categories enable row level security;

-- Every authenticated user (not just approved staff) can read this — the
-- "which best describes your role" category picker on first sign-in runs
-- before a profile is approved.
create policy "authenticated can read staff categories"
  on public.staff_categories for select
  to authenticated
  using (true);

create policy "managers can add staff categories"
  on public.staff_categories for insert
  to authenticated
  with check (is_manager());

create policy "managers can edit staff categories"
  on public.staff_categories for update
  to authenticated
  using (is_manager())
  with check (is_manager());

insert into public.staff_categories (key, label, sort_order) values
  ('support_worker', 'Support Worker', 1),
  ('personal_care_worker', 'Personal Care Worker', 2),
  ('physiotherapist', 'Physiotherapist', 3)
on conflict (key) do nothing;

-- profiles.staff_categories and course_categories.category turned out to be
-- a Postgres enum (`staff_category`) rather than free text as assumed going
-- in — confirmed via list_tables before writing this migration. An enum
-- can't grow at runtime from a client insert, which is exactly what "add a
-- new category from the UI" requires, so both columns are converted to
-- text/text[] here. Existing values cast across unchanged (enum labels are
-- their own text representation), so current profiles.staff_categories
-- arrays and course_categories.category rows keep matching the seeded keys
-- above with no data change needed. The now-unused `staff_category` enum
-- type is left in place rather than dropped, to avoid touching anything
-- that might still reference it outside this migration's visibility.
alter table public.profiles
  alter column staff_categories type text[] using staff_categories::text[],
  alter column staff_categories set default '{}'::text[];

alter table public.course_categories
  alter column category type text using category::text;
