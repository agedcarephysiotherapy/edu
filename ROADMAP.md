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

## Terms of Use / Privacy Notice link on sign-in page

Small addition: two links near the sign-in form in `index.html`, pointing
to the actual Terms of Use / Privacy Notice content. Blocked on whether
that content/documents already exist or still need drafting.

## Other ideas raised but not yet scoped in detail

Not committed to — just worth having on the table for a future scoping
pass: shift/roster visibility, leave requests, a staff directory,
incident/near-miss reporting, a lightweight admin dashboard summarizing
compliance + timesheet status at a glance.
