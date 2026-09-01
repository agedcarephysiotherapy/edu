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

## Printable course completion certificates

A couple of course modules (`PCPM.html`, `pca_orientation.html`) already
have an ad-hoc, in-page `buildCertificateHTML` generator shown once, right
after the quiz is passed. This item is the dashboard-level version: any
completed course, reprintable at any time from `index.html` — not limited
to the moment of completion, and not limited to the two modules that
happen to have their own generator today.

- One shared `buildCertificateHTML(staffName, courseTitle, completionDate,
  result)` in `index.html`, built from the two existing per-course
  generators as the design reference (brand palette, logo, border) rather
  than duplicated per course.
- A "Print Certificate" button per row in both "My Completions" (staff)
  and "All Staff Completions" (manager) — reuses the existing `completions`
  + `courses` tables, no new table needed.
- Print via the same pattern already used for "Print Records"/"Print
  Selected" (`@media print` scoping to just the certificate content +
  `window.print()`) rather than opening a new tab/window.
- Worth deciding: one generic template for every course, or a couple of
  template variants (e.g. plain "Attendance" vs. "Competency" showing a
  score) — the two existing per-course generators already differ on this.
- Out of scope for v1 unless asked: a certificate registry/audit table of
  what's been printed and when; PDF download as a distinct feature (vs.
  browser print-to-PDF, which already covers this for free).

## Facility management read-only role

A third account type, alongside staff/manager: read-only visibility into
the compliance status, course progress, and policy acknowledgments of a
specific subset of staff. Not full manager access — no approve/reject, no
roster/role management, nothing editable.

- **Needs deciding before this is built** — who is a "facility manager"?
  Two different features hide behind that one phrase: (a) an internal ACP
  team lead overseeing a sub-group of ACP's own staff, or (b) an external
  contact at an aged-care facility ACP services, wanting assurance that the
  ACP staff **allocated to their site** are currently compliant, trained,
  and police-checked before being on-site. (b) is the more common shape
  for this kind of request in aged care, but changes who provisions the
  account and what "allocated" means, so worth confirming before scoping
  the data model further.
- Data model (works under either reading above): a `facilities` table
  (`id`, `name`, `active`); a `facility_staff_allocations` table
  (`facility_id`, `staff_id`) — manager-assignable, same shape as the
  existing `staff_categories`/course-visibility pattern; `profiles.role`
  gets a third value (`'facility'`) plus a nullable `profiles.facility_id`
  saying which facility that account represents.
- RLS: a facility-role account can `select` — never write — `completions`,
  `compliance_requirements`, `compliance_submissions`, and
  `policy_acknowledgments` rows, only for `staff_id`s in their facility's
  allocation list. Reuses the existing `is_manager()`-style helper-function
  RLS pattern (see `policies`/`policy_acknowledgments`), just scoped
  further by facility instead of granting everything.
- UI: mostly a cut-down, read-only version of the existing manager audit
  views (Staff Audit / Compliance Audit) — naturally filtered by RLS
  rather than needing new query logic. Every write/admin control (Approve,
  Reject, Record Completion, Manage Staff, etc.) is hidden for this role.
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
