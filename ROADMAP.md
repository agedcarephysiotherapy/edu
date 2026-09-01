# ACP Staff Hub — Roadmap

Scoped features not yet built. Kept here so ideas discussed but parked don't
get lost between sessions. Nothing in this file has been implemented —
update an item's status as work starts/lands, and move it into `CLAUDE.md`
once it's actually built (this file is for what's *planned*, `CLAUDE.md`
documents what *exists*).

## Notice / announcement board

Managers post announcements visible to staff on the dashboard, replacing
ad-hoc emails/texts for things like roster changes or general reminders.

- `notices` table — `id`, `title`, `body`, `created_by`, `created_at`,
  `pinned`, optional `expires_at`, optional `target_categories` (reuse the
  existing `staff_categories` mechanism so a notice can go to everyone or
  just a specific category).
- `notice_reads` table — `notice_id`, `staff_id`, `read_at` — for the
  mark-as-read / read-receipt requirement. Manager view can show e.g.
  "12/14 staff have read this."
- RLS: any approved staff can `select` notices targeted to them; only
  managers can `insert`/`update`/`delete` — same shape as the existing
  `help_articles`/`courses` visibility pattern.
- UI: a card on the main dashboard showing recent/pinned notices, plus a
  manager-only compose panel (modeled on the existing manager "Record a
  Completion"-style panels).
- **Decided:** purely in-app, no Resend email trigger on new notices.

## Private messaging

- `messages` table — `sender_id`, `recipient_id`, `body`, `created_at`,
  `read_at`. 1:1 only, text only (no groups, no attachments) for v1.
- RLS: a user can only `select`/`insert` rows where they're sender or
  recipient — same pattern as everything else in the schema.
- Live delivery via Supabase Realtime (`postgres_changes` subscription on
  `messages`, scoped by the same RLS as the table) rather than polling —
  this is a Supabase-native feature already included in the project, not a
  new external service.
- **Decided:** no Resend fallback for unread messages — purely in-app,
  matching the notice board.
- Verified (Supabase docs, current at time of writing): Realtime free-tier
  quota is 200 concurrent connections and 2 million messages/month, with no
  overage billing on the free plan (throttled/notified instead). At ACP's
  staff scale this has a lot of headroom — not expected to be a constraint.
- Deliberately out of scope for v1 unless it becomes clearly needed: group
  threads, attachments, message editing/deletion, push notifications.
- Worth deciding before this carries anything sensitive: retention policy
  (how long messages are kept) and whether managers can audit conversations
  — same thinking as the compliance-docs 2-year purge job, decided up front
  rather than retrofitted.

## Facility management read-only role

A third account type, alongside staff/manager: read-only visibility into
the compliance status, course progress, and policy acknowledgments of a
specific subset of staff. Not full manager access — no approve/reject, no
roster/role management, nothing editable.

**Decided:** a facility management account is just another sign-in email,
same as any staff/manager account today. A manager (or "master user")
assigns it a specific subset of staff to see — a direct per-account
allocation, not tied to any separate physical-facility concept, and one
facility account's assigned subset is independent of any other's.

- `profiles.role` gets a third value (`'facility'`).
- `facility_staff_allocations` table — `facility_profile_id` (references
  the facility account's own `profiles.id`), `staff_id` (the staff member
  they're allowed to see), `created_by`, `created_at`. Manager-assignable
  only — same shape as the existing `staff_categories`/course-visibility
  pattern, just a direct account-to-staff mapping rather than going
  through a category or a separate facilities table.
- RLS: a facility-role account can `select` — never write — `completions`,
  `compliance_requirements`, `compliance_submissions`, and
  `policy_acknowledgments` rows, only for `staff_id`s present in its own
  `facility_staff_allocations` rows. Reuses the existing
  `is_manager()`-style helper-function RLS pattern (see
  `policies`/`policy_acknowledgments`), scoped per-account instead of
  granting everything.
- UI: a manager-only "assign visibility" control (checkbox list of staff,
  modeled on the existing "Assign to Everyone in Category" bulk-assign
  pattern) plus, for the facility account itself, mostly a cut-down,
  read-only version of the existing manager audit views (Staff Audit /
  Compliance Audit) — naturally filtered by RLS rather than needing new
  query logic. Every write/admin control (Approve, Reject, Record
  Completion, Manage Staff, etc.) is hidden for this role.
- Decide up front (same reasoning as the compliance-docs 2-year purge
  job): whether a facility account can see the actual uploaded document
  (e.g. a police check PDF) or only pass/fail status — likely the latter,
  for privacy.

## Terms of Use / Privacy Notice link on sign-in page

Small addition: two links near the sign-in form in `index.html`, pointing
to the actual Terms of Use / Privacy Notice content. Blocked on whether
that content/documents already exist or still need drafting.

## Other ideas raised but not yet scoped in detail

Not committed to — just worth having on the table for a future scoping
pass: shift/roster visibility, leave requests, a staff directory,
incident/near-miss reporting, a lightweight admin dashboard summarizing
compliance + timesheet status at a glance.
