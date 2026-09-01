-- Defensive RLS lockdown for the course-catalog tables (`courses`,
-- `course_categories`, `course_assignments`, `course_exclusions`).
--
-- These tables predate the migrations folder (created directly via the
-- Supabase SQL editor/dashboard before schema changes were tracked in
-- git), so there's no earlier migration file to diff against to confirm
-- what RLS state they're currently in. index.html lets any manager
-- insert/update/delete rows in all four tables straight from the client
-- (course details, per-course category tags, per-staff assignment and
-- exclusion overrides) and any signed-in staff member read them (to see
-- which courses apply to them) — but that's only actually safe if write
-- access is restricted to managers at the database level too, not just
-- hidden behind the manager-only UI.
--
-- Written to be safe to (re-)apply regardless of current live state:
-- `enable row level security` is idempotent, and every policy is dropped
-- before being recreated rather than assumed absent.

alter table public.courses enable row level security;
alter table public.course_categories enable row level security;
alter table public.course_assignments enable row level security;
alter table public.course_exclusions enable row level security;

-- courses: any authenticated (approved) user can read the catalog; only
-- managers can add/edit courses.
drop policy if exists "authenticated can read courses" on public.courses;
create policy "authenticated can read courses"
  on public.courses for select
  to authenticated
  using (true);

drop policy if exists "managers can insert courses" on public.courses;
create policy "managers can insert courses"
  on public.courses for insert
  to authenticated
  with check (
    exists (
      select 1 from public.profiles
      where profiles.id = auth.uid() and profiles.role = 'manager'
    )
  );

drop policy if exists "managers can update courses" on public.courses;
create policy "managers can update courses"
  on public.courses for update
  to authenticated
  using (
    exists (
      select 1 from public.profiles
      where profiles.id = auth.uid() and profiles.role = 'manager'
    )
  )
  with check (
    exists (
      select 1 from public.profiles
      where profiles.id = auth.uid() and profiles.role = 'manager'
    )
  );

drop policy if exists "managers can delete courses" on public.courses;
create policy "managers can delete courses"
  on public.courses for delete
  to authenticated
  using (
    exists (
      select 1 from public.profiles
      where profiles.id = auth.uid() and profiles.role = 'manager'
    )
  );

-- course_categories: which staff category(ies) a course is tagged for.
-- Every staff member needs to read this to work out which courses apply
-- to them; only managers can change the tagging.
drop policy if exists "authenticated can read course_categories" on public.course_categories;
create policy "authenticated can read course_categories"
  on public.course_categories for select
  to authenticated
  using (true);

drop policy if exists "managers can insert course_categories" on public.course_categories;
create policy "managers can insert course_categories"
  on public.course_categories for insert
  to authenticated
  with check (
    exists (
      select 1 from public.profiles
      where profiles.id = auth.uid() and profiles.role = 'manager'
    )
  );

drop policy if exists "managers can delete course_categories" on public.course_categories;
create policy "managers can delete course_categories"
  on public.course_categories for delete
  to authenticated
  using (
    exists (
      select 1 from public.profiles
      where profiles.id = auth.uid() and profiles.role = 'manager'
    )
  );

-- course_assignments / course_exclusions: per-staff overrides ("assign
-- this course to this one person even though their category wouldn't
-- normally see it" / "exclude this person from a course their category
-- would normally see"). Read access is left unrestricted to authenticated
-- users (same as course_categories) since the dashboard needs every
-- signed-in staff member to be able to work out their own effective
-- course list, and these rows carry no sensitive content beyond a
-- course/staff id pairing; only managers can create or remove them.
drop policy if exists "authenticated can read course_assignments" on public.course_assignments;
create policy "authenticated can read course_assignments"
  on public.course_assignments for select
  to authenticated
  using (true);

drop policy if exists "managers can insert course_assignments" on public.course_assignments;
create policy "managers can insert course_assignments"
  on public.course_assignments for insert
  to authenticated
  with check (
    exists (
      select 1 from public.profiles
      where profiles.id = auth.uid() and profiles.role = 'manager'
    )
  );

drop policy if exists "managers can delete course_assignments" on public.course_assignments;
create policy "managers can delete course_assignments"
  on public.course_assignments for delete
  to authenticated
  using (
    exists (
      select 1 from public.profiles
      where profiles.id = auth.uid() and profiles.role = 'manager'
    )
  );

drop policy if exists "authenticated can read course_exclusions" on public.course_exclusions;
create policy "authenticated can read course_exclusions"
  on public.course_exclusions for select
  to authenticated
  using (true);

drop policy if exists "managers can insert course_exclusions" on public.course_exclusions;
create policy "managers can insert course_exclusions"
  on public.course_exclusions for insert
  to authenticated
  with check (
    exists (
      select 1 from public.profiles
      where profiles.id = auth.uid() and profiles.role = 'manager'
    )
  );

drop policy if exists "managers can delete course_exclusions" on public.course_exclusions;
create policy "managers can delete course_exclusions"
  on public.course_exclusions for delete
  to authenticated
  using (
    exists (
      select 1 from public.profiles
      where profiles.id = auth.uid() and profiles.role = 'manager'
    )
  );
