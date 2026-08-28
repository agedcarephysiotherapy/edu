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
  - `_shared/googleSheets.ts` — shared helper (not its own deployed
    function): appends every closed timesheet entry to the spreadsheet's
    first tab, and upserts a rolling per-staff, per-fortnight total into a
    self-creating "Fortnight Summary" tab for payroll reconciliation.
  - `timesheet_entries` / `timesheet_gps_failures` tables have **no
    insert/update RLS policy for authenticated/anon** — all writes go
    through the `timesheet` function's service-role key. Don't add one; that
    server-side-only path is what makes `raw_hours` untamperable from the
    client.

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
