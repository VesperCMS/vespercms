# Vesper Spec: Addendum 1

> **Applies to:** `vesper-spec.md` (the version naming the product Vesper, with decisions D1–D17).
> **Written:** October 17, 2026.
> **Precedence:** where this addendum and the spec disagree, this addendum wins.

## 0. How to apply this (Claude Code)

1. Read this alongside `vesper-spec.md`. Section numbers below (§…) refer to the spec.
2. Fold each change into the spec in one commit titled "Spec: apply addendum 1."
   - Where a section is **new**, insert it at the stated position. Don't renumber existing sections; use the new numbers given here.
   - Where a section **replaces** text, replace exactly that text.
3. Add one dated entry per new decision (D18–D23) to `DECISIONS.md`.
4. If planning is already underway, re-check phase plans against section 7 of this addendum ("Build phase changes") before continuing.
5. Section 9 ("Considered, not adopted") is a **do-not-build** list. Don't start any of it without Jeremy saying so.

---

## 1. Summary of changes

| Change | Where it goes in the spec |
|---|---|
| Scheduled publish and unpublish (free and cloud) | New §6.17, new D18, new Phase 4.5 |
| Accessibility checks: studio, build and cloud history | New §6.18, new D19, new Phases 2.8 and 8.5 |
| Forms that do more: conditional routing, file uploads, confirmation emails | Replaces §6.13 "Behavior", replaces §7.6, new D20 and D21, expands Phase 6 |
| Integrations: send data to other tools | New §7.13, new D22, new Phase 6.5 |
| Site search (free, any host) | New §6.19, new D23, new Phase 2.9 |
| Proposed plans and prices (not final) | Adds detail under open decision §13 item 4 |
| Ideas considered but not adopted | New list under §13 |

---

## 2. Scheduled publish and unpublish

### New decision

| # | Decision | Status |
|---|---|---|
| D18 | Scheduling is **time-correct at build**. Entries carry `publishAt` / `unpublishAt`, and the `vesper:content` helpers filter by them during every build. Any rebuild at or after the scheduled time therefore produces the right site, on any host, with or without the cloud. The cloud's job is only to **trigger a rebuild at the exact time**. | Decided |

### New §6.17 Scheduled publish and unpublish

**Opting in.** Scheduling is opt-in per collection, in `vesper.config.ts`:

```ts
collections: {
  events: { url: '/events/:slug', schedule: true },
  blog:   { url: '/blog/:slug',   schedule: { unpublish: false } },
},
```

**Fields.** When scheduling is on, the studio adds two optional fields, `publishAt` and `unpublishAt` (ISO 8601 with offset). They're shown in the Details section, not the main column.
- The field names can be mapped to existing schema fields, for example `publishAt: 'publishedAt'`.
- If the schema doesn't declare them, the integration documents the one line to add.

**Build-time filtering** (free and cloud, every host):
- `getCollection`/`getEntry` from `vesper:content` skip entries whose `publishAt` is in the future or whose `unpublishAt` has passed, judged at **build time**.
- So do `getTree`, `getChildren`, sitemaps, RSS and the link picker's "live" view.
- In dev, scheduled entries stay visible with a small "Scheduled" marker, so editors can work on them.

**What an unpublished entry's URL does.**
- By default it simply stops being built, so it 404s.
- An optional `unpublishRedirect` field (a page picker) adds a redirect to `vesper.redirects.yaml` at publish time. For example, an expired event can point to `/events`. The redirect takes effect when the entry unpublishes, through the same build-time filtering.

**Time zones.**
- A site time zone setting (IANA name) controls how times are shown and entered. Storage is always ISO 8601 with offset.
- The date and time controls show the zone in text ("8:00 AM Eastern").

**Free tier (no cloud).**
- Accuracy equals rebuild frequency. The deploy templates (§6.16) gain an optional scheduled rebuild, for example hourly via GitHub Actions `schedule`. Git-connected hosts can use their own scheduled build hooks.
- The studio states the accuracy plainly: "Goes live at the first rebuild after 8:00 AM. This site rebuilds hourly."

**Cloud tier (exact).**
- The cloud keeps each site's upcoming publish and unpublish times in the SiteDO and sets a Durable Object alarm for the next one.
- When the alarm fires, the cloud triggers a rebuild using one of:
  - the site's **deploy hook** URL (Netlify, Vercel or Cloudflare build hooks, stored as a secret), or
  - a GitHub `repository_dispatch` event, which the deploy templates listen for.
- The dashboard shows each scheduled event's result: rebuild triggered, then live or failed, using the deploy status from §6.16.

**How a scheduled draft gets into git.**
- The default is **commit now, filter at build**: scheduling a draft publishes the file immediately with a future `publishAt`. The content is safely in git, and if the cloud is unreachable at the scheduled time, the next rebuild still gets it right.
- For **public repositories**, a site setting `holdScheduledDrafts: true` keeps the draft in the cloud until the scheduled time, then commits it and triggers the rebuild. The studio warns about this choice when it detects the repo is public.

**Where it lives in the UI (§10.4 rule)**
- The primary button becomes a split button: **Publish ▾**, with "Schedule…" in its menu. That still counts as one primary button.
- "Schedule…" opens a small dialog: date, time (with zone text), an optional unpublish date, and an optional unpublish redirect.
- Scheduled entries show "Scheduled · Mon, Nov 3, 8:00 AM" as their status text.
- The entry list's status filter gains "Scheduled."
- A plain "Scheduled" view lists upcoming changes across the site, with reschedule and cancel.

**Accessibility.** Date and time use native inputs or the `ui` kit equivalents, with visible labels and the zone in text. The split button follows the menu button pattern.

---

## 3. Accessibility checks

### New decision

| # | Decision | Status |
|---|---|---|
| D19 | **Vesper reports accessibility; it never claims compliance and never ships an overlay.** Checks find many problems, not all. The UI and docs say so plainly. Vesper never injects any front-end "accessibility widget" or overlay script into sites. | Decided |

### New §6.18 Accessibility checks

Three layers, from free to paid. All share one rule set and message style: plain language, one sentence on why it matters, and a link to a short explanation in the docs.

**Layer 1: In the studio, while editing** (free, every mode). These are content checks that run as the editor types (debounced):

| Check | Example message |
|---|---|
| Image with no alt text and not marked decorative | "Describe this image, or mark it decorative." |
| Alt text that looks like a file name, starts with "image of," or is very long | "Alt text looks like a file name." |
| Skipped heading levels in the body, or an extra top-level heading | "Heading jumps from level 2 to level 4." The starting level is configurable per collection. |
| Empty headings | "This heading is empty." |
| Vague link text ("click here," "read more," "here," bare URLs) | "Link text should say where it goes." |
| Links set to open in a new window without saying so | "Tell readers this opens in a new tab." |
| Tables without a header row | "Add a header row so screen readers can announce columns." |
| Text color from a `fields.color()` field that fails contrast against the site's declared background tokens | "Contrast 3.1:1 is below 4.5:1." |
| Markdoc/MDX tags with a required accessible name left empty (for example an iframe or video `title`) | "This video needs a title." |
| Fake lists (lines starting with "-" or "1." inside a paragraph) | "This looks like a list. Format it as one." |
| Uploaded PDFs: untagged, no document title, or no language set (checked in the browser with PDF.js) | "This PDF isn't tagged, so screen readers can't read its structure. Consider an HTML page instead, or tag the PDF." |
| Video embeds with no captions attribute, where the tag schema has one | "Confirm this video has captions." |

**Layer 1 UI (§10.4 rule)**
- Each note appears inline beside the field it concerns.
- The top bar's status text gains a count ("2 accessibility notes") that opens a drawer listing them with "Go to field."
- No tabs, no colored badges.

**Publish gate.**
- **Default:** warn only.
- **Optional:** a site setting `a11y.blockPublishOn: ['missing-alt', …]`. A blocking rule disables Publish, with the reason in text and a link to the field.

**Layer 2: At build** (free, every host)
- In `astro:build:done`, the integration checks the generated HTML with no browser, using axe-core in a lightweight DOM. It covers only structure-level rules:
  - `lang`, page `title`, landmarks
  - heading order and image `alt`
  - form labels and accessible names on links and buttons
  - duplicate IDs and basic ARIA misuse
- Color contrast and visual rules are **not** checked here (that's layer 3).
- Output goes to `.vesper/a11y-report.json`, **outside `dist/`**, so it is never deployed.
- `vesper({ a11y: { failBuildOn: 'error' } })` can fail the build. The default is off.
- Each issue is mapped back to the content entry that produced the page where possible (page-to-entry mapping, §6.10), so reports can link to "fix in studio."

**Layer 3: Cloud history and full scans** (paid)
- **Build reports.** When the build environment has `VESPER_BUILD_TOKEN` (a per-site upload token), the integration uploads the layer-2 report after each build. The dashboard keeps the history:
  - issue counts over time
  - issues by page and by rule
  - "new since last build"
- **Full rendered scans.** On a schedule (monthly by default, weekly on Institution), the cloud scans the live site in a real headless browser, using the sitemap for the page list. These scans add the rules layer 2 can't do: color contrast as rendered, plus rendered landmarks and names. The number of pages scanned is capped per plan.
- **Export.** CSV for working lists, and a plain, accessible PDF/HTML summary for documentation, such as a Title II progress record. The summary states what was checked and that manual testing is still needed (D19).
- **Agency view.** A cross-site table of every client site's issue counts and trend.

**Decide during Phase 8.5.** Pick the rendering mechanism for full scans (for example Cloudflare Browser Rendering). Check current pricing and limits, and set the per-plan page caps from real costs.

---

## 4. Forms that do more

### New decisions

| # | Decision | Status |
|---|---|---|
| D20 | **Confirmation emails can't be turned into a spam cannon.** Forms with confirmation emails require Turnstile. Each recipient address is rate-limited. The confirmation template is fixed by the site owner, and by default it never repeats the submitter's free-text fields back to them. | Decided |
| D21 | **Uploaded files are private.** They are stored in R2 under per-site keys and never publicly reachable. Site members download them only through short-lived signed links from the dashboard. Retention follows the form's submission retention. | Decided |

### Replace §6.13 "Behavior" with

- The cloud validates against the same schema, taken from the manifest.
- **Form definitions live in code** (`forms.config.ts`): fields, validation and labels.
- **Delivery settings live in the dashboard**, editable by site admins without a deploy: notification recipients, routing rules, confirmation email and integrations. Those are operational settings, not content.
- **File upload fields:**

  ```ts
  resume: fields.upload({ accept: ['application/pdf', '.docx'], maxSizeMB: 10, maxFiles: 1 })
  ```

  `<Form>` renders a native file input with a visible label. The accepted types and size limit are stated in text ("PDF or Word, up to 10 MB"), and errors are linked through `aria-describedby`.
  - **Without JavaScript,** the form posts as multipart directly to the cloud.
  - **With JavaScript,** files upload first using short-lived upload URLs, with an accessible progress indicator.
- **Confirmation email:** set `confirmation: { emailField: 'email' }` on the form to enable the auto-reply. Its content is managed in the dashboard (§7.6).

### Replace §7.6 Forms backend with

**Request path**
1. Turnstile check.
2. Schema validation.
3. File checks: type by content sniffing, not just extension; size; count.
4. Write the submission to the SiteDO and the files to R2.
5. Evaluate routing rules.
6. Enqueue the actions they produce: notification emails, the confirmation email, and integration deliveries.
7. Redirect or JSON response.

**Conditional routing**
- An ordered list of rules per form, edited in the dashboard as plain sentences: "When **Department** is **Admissions**, notify **admissions@college.edu** and send to **Admissions Sheet**."
- **Conditions** compare one field with: is, is not, contains, is one of, is empty, is not empty.
- **Actions:** notify these addresses; use this confirmation template; send to these integrations (§7.13); mark the submission as spam.
- **Matching:** "first match wins," or "every match" (a per-form setting). An **otherwise** route catches everything else.
- A "Test a submission" panel shows which rule would fire for sample values.

**Confirmation emails**
- One template per form, plus optional per-route overrides.
- Templates use `{fieldName}` merge tokens. Only fields marked `safeToEcho` in the form schema can be merged; by default that's just name fields (D20).
- **Sender:** "Site Name via Vesper" from the cloud's sending domain, with the site's chosen reply-to address. On higher tiers, sending from the client's own verified domain is possible (with DNS records shown in the dashboard).
- Plain, accessible HTML with a text alternative.

**Uploads**
- R2, private (D21).
- Signed download links from the inbox expire after 15 minutes.
- Per-plan storage limits.
- No antivirus scanning at launch. This is why the allowed file types are restricted to a safe list: PDF, images, Office documents and plain text. Executables and archives are always rejected.

**Dashboard inbox** (unchanged from the spec)
- Search, CSV export (with file links), mark as handled, delete, retention setting.
- New: a submission's detail view shows which route fired and the delivery status of each action.

**Spam controls**
- Turnstile, honeypot and per-IP rate limiting.
- Per-recipient rate limits for confirmation emails (D20).
- Per-form pause switch, plus the global kill switch.

---

## 5. Integrations

### New decision

| # | Decision | Status |
|---|---|---|
| D22 | Integrations are **one event-and-delivery system** shared by forms, comments, publishing and accessibility reports. Each integration has: an event it reacts to, a destination, a field mapping, and a delivery log. Deliveries are queued, retried and visible. Nothing fails silently. | Decided |

### New §7.13 Integrations

**Events**
- `form.submitted` (also when produced by a routing rule)
- `comment.submitted`, `comment.approved`
- `entry.published`, `entry.unpublished`, `entry.scheduled`
- `deploy.failed`
- `a11y.report.ready`

**Destinations (v1)**

| Destination | Notes |
|---|---|
| Webhook | POST JSON with an HMAC signature header and a timestamp. Docs include ready-made recipes for n8n, Zapier and Make. |
| Google Sheets | OAuth connection per account. Append a row per event, with columns mapped from fields. Uploaded files appear as dashboard links, never public URLs. |
| Slack | Incoming webhook URL. A short, plain message with a link to the item in the dashboard. |
| Microsoft Teams | Workflow/webhook URL. Same message style as Slack. |
| Mailchimp | OAuth connection. Add or update a subscriber from mapped email and name fields, with an optional consent field that must be true. |

**Later candidates** (not v1): Airtable, Buttondown, HubSpot, Salesforce (Institution tier).

**Field mapping**
- A simple two-column mapper: source field → destination column or property.
- It's prefilled by matching names, and every mapping is editable.

**Delivery**
- Cloudflare Queues with exponential backoff (up to 24 hours).
- A dead-letter queue for failures.
- A **per-site delivery log** (last 30 days) in the dashboard, showing status, response code and a retry button.
- Site admins get an email after repeated failures.

**Secrets**
- Webhook secrets, OAuth tokens and destination URLs are encrypted at rest.
- They're scoped to the account, never readable back in full, and revoked on disconnect.

**Where it lives in the UI**
- Dashboard → Site → **Integrations**: a list of connections, each with a one-line summary ("New Contact form submissions → Admissions Sheet").
- Routing rules (§7.6) pick from these connections. Nothing about integrations appears in the studio.

---

## 6. Site search

### New decision

| # | Decision | Status |
|---|---|---|
| D23 | **Site search is built into the open-source integration and is free.** The integration builds a Pagefind index at build time, so search is plain static files that work on any host (D16), with no service to pay for or keep running. The cloud adds nothing required for search. | Decided |

### New §6.19 Site search

**Goal.** One line of setup and one component, with results that already know about the site's collections, dates and images.

```js
// astro.config.mjs (search is on by default; this shows the options)
vesper({ search: { filters: { blog: ['tags', 'author'] }, sort: { blog: ['publishedAt'] } } })
```

```astro
---
import { Search } from '@vesper/astro/components';
---
<Search />                      <!-- a search button that opens a search dialog -->
<Search variant="inline" />     <!-- an inline search box with results below -->
```

**Building the index (automatic)**
- In `astro:build:done`, the integration uses Pagefind's Node API (`createIndex` → add pages → `writeFiles`) to write the index into `dist/_vesper/search/`.
- There's no extra CLI step and no change to the deploy templates.
- `vesper({ search: false })` turns it off. If no page uses `<Search>`, the integration skips indexing and logs one line saying so.

**What gets indexed**
- **By default:** pages built from collections that have a `url` pattern (§6.15.1), plus static pages in `src/pages`.
- **Collections:** `collections.<name>.search: false` excludes a whole collection.
- **Single entries:** a "Hide from site search" switch in the studio's Details section. If the schema has an SEO `noindex` field, the switch maps to it.
- **Content area:** each page's `<main>` element, unless the site marks content with Pagefind's own attributes (`data-pagefind-body`, `data-pagefind-ignore`). The integration respects those.
  - **Verify early:** Pagefind's documented rule that once any page uses `data-pagefind-body`, pages without it are left out of the index. Warn at build if that would silently drop pages.
- **Drafts, scheduled and unpublished entries** are never indexed, because they aren't built (D18).
- **Languages:** multilingual sites get one index per language, using Pagefind's handling of each page's `lang`.

**Results that understand the content.** The integration hands Pagefind an annotated copy of each page during indexing. The deployed HTML is never modified.
- **Filters:** always the collection's label ("Blog posts," "Events"), plus any fields listed in `search.filters`, for example tags or author.
- **Sorting:** relevance by default, plus any date fields listed in `search.sort`.
- **Result details:** the entry's title, its date if there is one, and a result image taken from its `fields.image()` field using the **square** crop (§6.6). So focal points carry through to search thumbnails.
- **Ranking:** titles count more than body text.

**The search UI**
- **Base it on Pagefind's Component UI** (web components, available since Pagefind 1.5), styled with the site's own fonts and colors through Pagefind's CSS variables. The docs show the few lines needed to theme it.
- **Accessibility gate (D11).** Before shipping, audit Pagefind's components with keyboard, NVDA, VoiceOver and at 200% zoom and 320px width:
  - if they pass, use them as-is
  - if they fall short, file the issues upstream and build `<Search>` instead on Pagefind's JavaScript search API, using the `ui` kit's Dialog and the combobox/listbox pattern
- **Either way, the result must meet these:**
  - a labelled search field
  - a polite live announcement of the result count ("12 results for 'nursing'")
  - results as a real list of links with the title as the link text
  - filters in a fieldset with a legend
  - Escape closes the dialog and focus returns to the button
  - no keyboard traps
- **Keyboard shortcut.** "/" opens search. It's announced in the button's accessible description and can be turned off.
- **Search page and links.** The integration adds a prerendered `/search` page that reads `?q=`, so searches can be linked and bookmarked. It also emits an `opensearch.xml` file, so browsers can offer "search this site" from the address bar.
- **Without JavaScript.**
  - **Default:** the `/search` page explains that search needs JavaScript and links to the sitemap.
  - **Optional:** `search: { noJsFallback: 'duckduckgo' }` sends the query to an external search engine scoped to the site's domain.

**Works anywhere (D16)**
- The index is static files. Add a plain static host to the test matrix (§6.16) with search included.
- Verify that Pagefind's WebAssembly file loads on a basic Apache/FTP host. If a host needs a MIME type setting, the generated `.htaccess` block (§6.15.5) includes it, and the docs say so.

**Size and speed**
- The build prints the index size.
- Warn if the search assets loaded by a first query exceed a sensible budget, for example 300 KB.
- Pagefind loads index chunks on demand, so large sites stay fast.

**In dev.** The search index only exists after a build. In `astro dev`, `<Search>` uses the index from the last build if there is one. Otherwise it shows a short note: "Search works after `astro build`."

---

## 7. Build phase changes

Insert these phases and expand Phase 6. Standing acceptance criteria apply to all of them.

### New Phase 2.8: Accessibility checks (studio and build)
- Layer 1 studio checks, the notes drawer, and the optional publish gate.
- Layer 2 build checks writing `.vesper/a11y-report.json`.
- **Done when:**
  - Every layer-1 rule fires on the playground's deliberately flawed fixtures, with the message shown beside the right field.
  - The layer-2 report maps issues to entries.
  - No report file appears in `dist/`.
  - The notes drawer can be fully operated by keyboard and screen reader.

### New Phase 2.9: Site search
- Index at build through the Node API, the `<Search>` component (dialog and inline), filters, sort and result images from the schema, "Hide from site search," the `/search` page, `opensearch.xml`, the no-JavaScript fallback, and the accessibility audit of Pagefind's Component UI.
- **Done when:**
  - Searching the playground finds pages from every searchable collection, and filtering by collection and tag works.
  - Hidden, draft and scheduled entries never appear.
  - Search works from `dist/` on the plain static test host.
  - The audit is recorded in `DECISIONS.md`, and the shipped UI passes the standing accessibility criteria with keyboard and screen readers.

### New Phase 4.5: Scheduled publish and unpublish
- Build-time filtering in `vesper:content` (free), the scheduled-rebuild option in the deploy templates, the cloud alarms with deploy hook or `repository_dispatch` triggers, the Schedule dialog, the "Scheduled" view, unpublish redirects, and `holdScheduledDrafts`.
- **Done when:**
  - A post scheduled for a time 5 minutes ahead goes live on a Netlify site and on an SFTP-template site within 2 minutes of that time (cloud).
  - On a free-tier site, it appears at the first scheduled rebuild after that time.
  - An expired event 404s or redirects as configured.
  - Times display correctly in the site time zone across a daylight-saving change.

### Phase 6: Forms (expanded)
Everything already listed, plus: conditional routing with the test panel, file uploads (D21), confirmation emails with the D20 protections, and the expanded inbox detail view.

**Done when** (in addition to the existing criteria):
- A routing rule sends Admissions submissions to one address and everything else to another.
- A 10 MB PDF uploads with and without JavaScript, and can only be downloaded through a signed link.
- A disallowed file type is rejected with a clear, linked error.
- Automated tests confirm that confirmation emails can't echo non-safe fields and are rate-limited per recipient.

### New Phase 6.5: Integrations
- Event system, Queues delivery with retries and the DLQ, the delivery log, and all five v1 destinations with field mapping.
- **Done when:**
  - One playground form submission reaches a webhook (signature verified), a Google Sheet row, Slack and Mailchimp.
  - A failing webhook retries, lands in the log with a retry button, and triggers the failure email.

### New Phase 8.5: Accessibility history and scans (cloud)
- Report uploads with `VESPER_BUILD_TOKEN`, history and trends, scheduled rendered scans with plan caps, CSV and summary export, and the agency cross-site view.
- **Done when:**
  - Two builds' reports show a correct "new since last build" diff.
  - A rendered scan finds a contrast failure that layer 2 cannot.
  - The exported summary is itself accessible: tagged headings, real tables, and text alternatives.

### Phase 0 playground additions
- An `events` collection with scheduling on.
- A page with deliberate accessibility mistakes (one per layer-1 rule), kept as test fixtures and excluded from real-content checks.
- A contact form with a department select (for routing), an upload field and a confirmation email field.
- `<Search />` in the playground's header, with tags as a filter on the blog collection.

---

## 8. Plans and prices (proposed, not final)

This adds detail to open decision §13 item 4. Treat the numbers as **placeholders for building entitlements**, not as final prices.

| Plan | Proposed price | Who it's for |
|---|---|---|
| Free | $0, open source | Local and GitHub modes, studio accessibility checks, build checks, scheduling via scheduled rebuilds, site search |
| Site | ~$10/mo yearly, ~$13 monthly | One site |
| Agency | ~$49/mo yearly (~$59 monthly), 10 sites included, then ~$4/site | Agencies with many client sites |
| Institution | Custom, from ~$1,500/yr | Colleges and larger organizations |

**What each plan includes**
- **Site:**
  - cloud logins and **unlimited editors**
  - roles, drafts and review
  - instant previews, exact scheduling and comments
  - forms with routing, uploads and confirmation emails
  - integrations
  - accessibility history with monthly scans of a capped number of pages
  - starting limits: about 1,000 submissions/month, 1 GB of form uploads, 5 GB of media
- **Agency:** everything in Site, plus the multi-site dashboard, white-labeling, the cross-site accessibility view, pooled limits and priority support.
- **Institution:** everything in Agency, plus SSO, weekly scans with higher page caps, longer retention, invoices and purchase orders, and the later CRM integrations.

**Pricing principles to keep, even if the numbers change**
- Price per site, never per editor.
- Usage limits only on things that cost money or invite abuse: submissions, uploads, media, emails, scanned pages.
- Overages warn and give a grace period. They never silently drop data.
- Annual billing is the default, because Stripe's fixed fee makes small monthly charges expensive.
- A 30-day trial instead of a free cloud plan at launch.
- A 30–50% discount for nonprofits, public libraries and schools.
- An optional "founding agency" rate for early adopters.

**Reference points as of October 2026**
- Tina Team: about $29/month per project with 3 users.
- Decap Turbo starter: about $29–37/month for 3 users and 1 project.
- CloudCannon: Standard about $49–55/month (3 users); agency-only Lite about $10/site.
- Formspree paid plans: start about $10–15/month for 200 submissions.

Entitlement keys to implement (§7.9): `sites`, `submissionsPerMonth`, `uploadStorageGB`, `mediaStorageGB`, `emailsPerMonth`, `a11yScanPages`, `a11yScanFrequency`, `whiteLabel`, `sso`, `retentionMonths`.

---

## 9. Considered, not adopted (do not build)

These came up in planning. Jeremy hasn't chosen them, so **don't build them** unless he asks.

| Idea | Status |
|---|---|
| Instant site notices (an alert banner that updates without a rebuild) | Not adopted yet |
| Monthly white-labeled client reports for agencies | Not adopted yet |
| Weekly broken-link checks, and a 404 beacon suggesting redirects | Not adopted yet |
| Uptime, SSL and domain-expiry alerts | Not adopted yet |
| Free open-source conveniences: sitemap, RSS, social share images | Not adopted yet; likely free if adopted |
| Cloud "search insights" (top searches and searches with no results, from an anonymous count of queries) | Not adopted yet; a natural paid extra to site search |
| Conditional show/hide fields inside forms (as opposed to conditional routing) | Open question |
| Newsletter sending, payments, full analytics, machine translation, AI writing | Rejected for now: costly or support-heavy |

## 10. New open decisions (append to §13)

12. **Conditional form fields**: support show/hide logic inside forms (with the accessibility work that requires), or keep forms static and rely on routing?
13. **Scan engine and caps**: which rendering service runs full accessibility scans, and what page caps each plan gets, set from measured cost (Phase 8.5).
14. **Custom sending domains** for confirmation emails: which plan includes them?
