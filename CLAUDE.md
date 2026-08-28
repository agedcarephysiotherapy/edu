# ACP Staff Hub

This repo is a static site (GitHub Pages, see `CNAME`) — branded "ACP Staff
Hub" in the app itself — with a Supabase-backed staff training, compliance,
and timesheet tracker.

- `index.html` — the manager/staff dashboard: auth, course list, completions,
  compliance documents/audit, the in-app help-bot widget, and the staff
  timesheet (sign in/out, pay-period totals, manager Timesheets tab). This is
  the source of truth for the Supabase project config (`SUPABASE_URL` /
  `SUPABASE_ANON_KEY`) and for how courses are registered.
- `courses/*.html` — individual, self-contained training modules. Each one
  embeds its own copy of the Supabase client and reports completion back to
  the `completions` table under a specific `COURSE_ID`. Every scored module
  requires **80% to record a completion** — a lower score shows a "retake
  required" message instead of writing a row (see the "Adding a new course
  module" section below).
- `supabase/migrations/*.sql` — schema changes for the backend. Not run
  automatically; apply via the Supabase SQL editor, `apply_migration` (MCP),
  or `supabase db push` with the CLI linked to the project.
- `supabase/functions/*` — Edge Functions. Deploy with
  `supabase functions deploy <name>` (or the `deploy_edge_function` MCP
  tool). Each function's required secrets must be set separately with
  `supabase secrets set` (or via the Supabase dashboard) — they are never
  committed to the repo. Current functions:
  - `ask-assistant` — role-scoped dashboard help bot, backed by the
    `help_articles` table and Google's Gemini API free tier. Requires
    `GEMINI_API_KEY` (optional `GEMINI_MODEL` override).
  - `timesheet` — staff sign-in/sign-out: GPS capture + reverse geocoding
    (Nominatim, no key needed), a hard "fit to work" declaration + GPS gate,
    server-authoritative hours (with a mandatory 30-minute unpaid break
    deducted for shifts over 5 hours — never client-editable), and manager
    email alerts on GPS failure only (never on ordinary sign-in/out).
    Requires `RESEND_API_KEY` + `RESEND_FROM_EMAIL` for the failure emails,
    and `GOOGLE_SERVICE_ACCOUNT_JSON` + `GOOGLE_SHEETS_SPREADSHEET_ID` (see
    `_shared/googleSheets.ts`) for the Google Sheets sync — both are
    optional/best-effort and log-and-continue if unset.
  - `timesheet-sheets-sync` — standalone wrapper around the same Sheets sync
    logic as `timesheet`, for manual testing.
  - `timesheet-auto-signout` — safety-net sweep, deployed with
    `verify_jwt=false` (see the function's own doc comment for why — this
    project uses Supabase's newer publishable/secret key format rather than
    legacy JWTs, so it skips the platform JWT gate rather than gamble on
    compatibility; it's safe to call unauthenticated since it's idempotent
    and only ever acts on entries already provably 9+ hours overdue by
    wall-clock time). Scheduled via `pg_cron` + `pg_net` (see the
    `schedule_timesheet_auto_signout` migration, job name
    `timesheet_auto_signout`, runs every 15 minutes) to close any
    `timesheet_entries` row left `status='open'` for 9+ hours — a mandatory
    30-minute break is deducted the same as a normal sign-out,
    `out_lat`/`out_lng`/`out_address` are left null (expected — there's no
    client to capture GPS from), and `auto_signed_out` is set true so the UI
    can render it distinctly (an "Auto" badge + "no location" label, not a
    blank/error state). Emails both the staff member and all approved
    managers. Uses the same `RESEND_API_KEY`/`RESEND_FROM_EMAIL` secrets as
    `timesheet`.
  - `_shared/googleSheets.ts` — shared helper (not its own deployed
    function): appends every closed timesheet entry to the spreadsheet's
    first tab, and upserts a rolling per-staff, per-fortnight total into a
    self-creating "Fortnight Summary" tab for payroll reconciliation.
  - `timesheet_entries` / `timesheet_gps_failures` tables have **no
    insert/update RLS policy for authenticated/anon** — all writes go
    through the `timesheet` (or `timesheet-auto-signout`) function's
    service-role key. Don't add a client-write policy; that server-side-only
    path is what makes `raw_hours` untamperable from the client.

## Staff categories (`staff_categories` table)

Staff categories (Support Worker / Personal Care Worker / Physiotherapist,
plus whatever managers add) are **not** hardcoded — they live in the
`staff_categories` table (`id`, `key` unique/immutable, `label`, `sort_order`,
`active`, `created_at`), managed from a "Staff Categories" card in the
Manage Staff (Roles) tab. Managers can add a new category (key + label) and
rename an existing label; the `key` itself is never editable from the UI
once created, since `profiles.staff_categories` and `course_categories.category`
reference it by that string everywhere.

`index.html`'s `CATEGORIES`/`CATEGORY_LABELS` are still the variable names
every call site reads (course visibility chips, the Roles table's category
checkboxes, compliance bulk-assign-by-category, the first-sign-in "which
best describes your role" picker, etc.) — they're just populated at runtime
by `loadStaffCategories()` (called early in `bootApp()`, before anything
else reads them) instead of being literals. If a fetch fails, they fall back
to the three original hardcoded values so the app degrades rather than
breaking.

`profiles.staff_categories` and `course_categories.category` were originally
a Postgres enum (`staff_category`) rather than free text — enums can't grow
from a client insert, which is what "add a category from the UI" requires,
so the `staff_categories_table` migration converts both columns to
`text[]`/`text`. The old `staff_category` enum type is still in the
database, unused.

RLS: any authenticated user can `select` `staff_categories` (the sign-up
picker runs before a profile is approved); only managers can `insert`/
`update`.

## Manager: recording things on a staff member's behalf

Two manager-only "enter this directly, bypassing the normal staff-driven
flow" patterns exist side by side and are meant to stay consistent with
each other:

- **Record a Completion** (`panel-add`) — course completions, into
  `completions`.
- **Record a Compliance Document** (Compliance tab, next to "Review
  Submissions") — compliance documents, into `compliance_submissions`,
  submitted pre-approved (`status='approved'`, `reviewed_by`/`reviewed_at`
  set to the manager/now) since a manager entering it manually *is* the
  approval. `compliance_submissions.requirement_id` is NOT NULL, so if the
  target staff member doesn't already have an active
  `compliance_requirements` row for the chosen document type, one is
  auto-created on the fly (same shape as "Assign a Requirement", due-dated
  to the issue date) rather than requiring a separate assignment step
  first. The file upload is optional here (unlike the staff self-upload
  flow) — `compliance_submissions.file_path` was changed from NOT NULL to
  nullable for this reason, covering the "manager has the physical
  original, no scan" case the feature exists for. Uses the same
  `compliance-docs` storage bucket and `${staffId}/${docTypeId}/...` path
  convention as the staff upload flow; managers have their own storage
  INSERT policy (the staff one is scoped to their own `auth.uid()` folder).

Manage Staff (Roles tab) also lets a manager correct a staff member's
`profiles.full_name` inline (click the pencil next to a name → text input +
Save/Cancel) — covered by the same `profiles` RLS update policy managers
already use for role/status/category edits in that table, no new policy
needed.

## Brand / design system for course modules

All course pages share one visual identity — keep new modules consistent
with it rather than inventing a new look.

**Logo:** use the real ACP logo, not a text placeholder:
```html
<img class="brand-logo" src="https://forms.acphysio.com.au/acplogo" alt="Aged Care Physiotherapy">
```
If the logo sits on a dark/colored header background (most course headers
use a blue gradient), give it a light backdrop chip so it stays legible
regardless of the logo image's own colors:
```css
.brand-logo{
  height:34px; width:auto; object-fit:contain; display:block; flex-shrink:0;
  background:#fff; border-radius:9px; padding:4px 7px;
  box-shadow:0 3px 10px rgba(0,0,0,.15);
}
```
(Scale height down for mobile breakpoints, e.g. `height:22-28px` with
proportionally smaller padding.)

**Brand colors** (used verbatim across every course page, sometimes under
different CSS variable names — `--red`/`--blue` in some files, `--acp-red`/
`--acp-blue` in others):
```
red:  #cc3300  (dark #a32900)
blue: #336699  (dark #264d73)
```
Don't introduce a different palette. Status colors are also consistent
site-wide: green `#2e7d4f`/`#2f7d4f` (success), amber `#b8860b` (warning),
red `#b3261e`/`#cc3300` (danger).

**Modern chrome conventions** established across all modules:
- Sticky header with a subtle `backdrop-filter: blur(...) saturate(...)`
  glass effect over a brand-color gradient.
- Layered/soft box-shadows (not flat single-value shadows) on cards and
  sticky bars.
- Consistent, fairly generous border-radius (12–16px) on cards/buttons.
- Buttons/progress bars use a red→blue (or blue→blue-dark) gradient fill,
  with a hover `translateY(-1px/-2px)` lift + shadow.
- Visible `:focus-visible` outlines on all interactive elements.

## Adding a new course module

Don't build a page from scratch. Copy an existing module as a starting
point — this carries forward the logo/theme above *and* a working Supabase
completion-tracking + quiz/certificate pattern:

- `courses/pbspcc.html` or `courses/gerimeds.html` — good reference for the
  `header.site` / `.brandrow` / `.brandmark` header pattern.
- `courses/PCPM.html` or `courses/Physio_Competency.html` — good reference
  for the `.topbar` / `.brand` / `.brand-logo` header pattern, plus a
  printable-certificate generator (`buildCertificateHTML`) if the new module
  needs one.

After copying: update the page title, `COURSE_ID` (get this from the
Courses tab in `index.html` after registering the new course there — "Add
Course" → copy its Course ID into the new page), and all content — but
leave the logo markup, brand color tokens, and header/chrome CSS as-is.

**80% pass requirement:** every scored quiz must gate its `recordCompletion()`
call on the score being ≥80% — a lower score must NOT write a `completions`
row; show a clear "80% required, please retake" message instead, with a
working retake action that actually resets quiz state (selections, per-
question correct/incorrect styling, feedback text, score display). At or
above 80%, record as normal. If the module already has its own stricter
pass bar (e.g. Physio_Competency.html's 80% overall *and* ≥3/4 correct in
every domain), keep that — 80% is a floor, not a ceiling to weaken existing
requirements to.
