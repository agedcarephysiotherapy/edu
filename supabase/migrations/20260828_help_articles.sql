-- Content backing the role-scoped dashboard help bot ("ask-assistant" Edge
-- Function). Managers maintain this table directly from the app; staff never
-- read it directly — the Edge Function (running as service role) is the
-- only path that serves it, and it applies the role filter server-side.
create table if not exists public.help_articles (
  id uuid primary key default gen_random_uuid(),
  scope text not null check (scope in ('staff', 'manager')),
  title text not null unique,
  body text not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists help_articles_scope_active_idx
  on public.help_articles (scope, active);

alter table public.help_articles enable row level security;

-- No policy grants anything to anon/authenticated — this table is only ever
-- read by the Edge Function via the service-role key (which bypasses RLS),
-- except for the manager-authoring policies below. This means a staff
-- member's own session can never query manager-scope articles directly,
-- even if the Edge Function had a bug — the role filter is enforced twice.
create policy "managers can read all help articles"
  on public.help_articles for select
  to authenticated
  using (
    exists (
      select 1 from public.profiles
      where profiles.id = auth.uid() and profiles.role = 'manager'
    )
  );

create policy "managers can author help articles"
  on public.help_articles for insert
  to authenticated
  with check (
    exists (
      select 1 from public.profiles
      where profiles.id = auth.uid() and profiles.role = 'manager'
    )
  );

create policy "managers can edit help articles"
  on public.help_articles for update
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

-- Seed starter content so the bot is useful immediately after deploy. Add
-- more rows (or edit these) any time from the "Help Content" manager tab —
-- no code change or redeploy needed, which is the whole point of storing
-- this in a table rather than in the Edge Function's prompt.
insert into public.help_articles (scope, title, body) values
(
  'staff',
  'Signing in',
  'Staff sign in from the training tracker''s login screen using a magic link sent to their registered email address. There is no password — click the link in the email to be signed in on that device. If access hasn''t been approved yet by a manager, a "pending approval" screen is shown instead of the dashboard.'
),
(
  'staff',
  'Completing a course',
  'Available courses are listed under "Available Courses" on the dashboard. Opening a course loads a self-contained training module — work through each section using the tabs at the top, then complete the short quiz at the end. A completion is recorded automatically the moment the quiz is submitted; no separate "mark as done" step is needed.'
),
(
  'staff',
  'Uploading a compliance document',
  'Under "Compliance Documents", each outstanding item shows a Document Date field and a file picker. Choose the date the document was issued and select the file (PDF, JPG or PNG), then click Upload. The item moves to "Pending review" until a manager approves or rejects it — if rejected, the reviewer''s note explains why and the item reopens for a fresh upload.'
),
(
  'staff',
  'Understanding compliance status badges',
  'Not submitted (nothing uploaded yet), Pending review (uploaded, awaiting a manager''s decision), Approved (accepted and current), Rejected (needs re-upload — see the reviewer note), Expired (was approved but has since passed its expiry date and needs renewing).'
),
(
  'manager',
  'Adding a new course',
  'From the "Add Course" tab, register the course''s title and details to generate its Course ID, then use that ID inside the course''s HTML file (in the COURSE_ID constant) so completions report back correctly. New course pages are added to the courses/ folder in the site repository.'
),
(
  'manager',
  'Reviewing compliance submissions',
  'The "Compliance" tab''s review area lists every submission awaiting a decision. Open a submission to view the uploaded file, then Approve or Reject it — a rejection requires a short note explaining what needs to be fixed, which the staff member sees on their own dashboard.'
),
(
  'manager',
  'Assigning compliance requirements',
  'From the Compliance tab, assign a document type to one staff member with a due date, or use "Assign to Everyone in Category" to bulk-assign the same requirement across an entire staff category (e.g. all Support Workers) in one action.'
),
(
  'manager',
  'Running the compliance audit and exporting it',
  'The Compliance Audit table lists every requirement across all staff with its current status and days overdue/remaining, filterable by staff, status, or document type. Use "Export CSV" to download exactly what''s currently on screen under the active filters.'
),
(
  'manager',
  'Managing staff roles and access',
  'The "Roles" tab lists everyone who has signed in at least once. New sign-ins need to be approved before they can access the dashboard. Roles and staff categories can be edited here at any time.'
)
on conflict (title) do nothing;
