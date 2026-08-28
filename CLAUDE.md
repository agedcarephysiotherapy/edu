# Aged Care Physiotherapy — Training Site

This repo is a static site (GitHub Pages, see `CNAME`) with a Supabase-backed
staff training tracker.

- `index.html` — the manager/staff dashboard (auth, course list, completions,
  audit). This is the source of truth for the Supabase project config
  (`SUPABASE_URL` / `SUPABASE_ANON_KEY`) and for how courses are registered.
- `courses/*.html` — individual, self-contained training modules. Each one
  embeds its own copy of the Supabase client and reports completion back to
  the `completions` table under a specific `COURSE_ID`.
- `supabase/migrations/*.sql` — schema changes for the backend. Not run
  automatically; apply via the Supabase SQL editor (or `supabase db push`
  with the CLI linked to the project).
- `supabase/functions/*` — Edge Functions. Deploy with
  `supabase functions deploy <name>`. Each function's required secrets
  (e.g. `GEMINI_API_KEY`) must be set separately with
  `supabase secrets set` — they are never committed to the repo.

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
