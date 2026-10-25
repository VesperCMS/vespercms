# Vesper: Product & Build Spec

> **Name:** Vesper (the evening star). Code, package and path forms are lowercase (`vesper`, `@vesper/astro`, `vesper.config.ts`, `/_vesper`); environment variables are uppercase (`VESPER_PROJECT`). `{{domain}}` stands for the cloud service's domain, vespercms.com (registered 2026-10-20).
> **Written:** October 17, 2026. **Targets:** Astro 7.x, Zod 4, Cloudflare Workers.
> **Amended:** Addendum 1 (D18–D23) applied October 17, 2026.
> **Sibling project:** Taproot (`jeremybise/taproot`), the database-backed CMS. Vesper is the git-based, static-site counterpart. It is not a storage mode inside Taproot.

---

## 0. How to use this document (Claude Code)

- This is the source of truth for scope and decisions. Build in the phase order in §11. Don't start a phase until the previous one meets its acceptance criteria.
- Decisions in §3 marked **Decided** are locked. Ones marked **Proposed** are defaults to confirm with Jeremy at the start of the phase that first depends on them. Items in §13 are open: propose options, don't pick silently.
- Keep `DECISIONS.md` (dated entries) and `CLAUDE.md` current as you go, the same way Taproot does.
- Before building any UI, read §10. If a new feature has no obvious quiet place to live in the interface, stop and propose one instead of adding a panel.

---

## 1. Summary

Vesper is a git-based CMS for Astro sites.

- It installs with one command (`npx astro add`).
- It builds its editor from the site's existing content collections, so there is no second schema to write.
- Content stays as files in the repo.

The open-source editor is free and works in two modes: locally during `astro dev`, and against GitHub when every editor has a GitHub account.

A paid cloud service adds what static sites can't do on their own:

- editor accounts that don't need GitHub, with roles scoped to folders
- drafts and instant previews
- form handling and comments
- media storage
- an agency dashboard for running many client sites from one place

---

## 2. Positioning (as of October 2026)

- **The Decap gap.** Netlify's Git Gateway is deprecated and frozen except for major security fixes. Netlify reversed its Identity deprecation in February 2026, but the Gateway was not reversed. Gateway is the piece that let Decap editors commit without GitHub accounts, so that user base is stranded. DecapBridge and Decap Turbo are moving into the gap.
- **Existing paid layers price per project and per seat**, aimed at product teams, not agencies:
  - Tina Cloud: Team plan about $29/month per project with 3 users.
  - Decap Turbo: starter about $29–37/month for 3 users and 1 project.
  - Keystatic Cloud: covers auth and images.
- **Every existing git CMS makes you define your schema twice.** Keystatic, Decap and Tina each have their own config describing content that Astro's `content.config.ts` already describes. Vesper reads Astro's config. This is the headline differentiator.
- **The database-backed lane is taken.** EmDash (Cloudflare's Astro-based CMS) and Taproot are database-backed and server-rendered. Vesper owns the other lane: fully static output, content in git, no database on the site.
- **Runs anywhere.** The built site and the studio are plain static files. They work on Netlify, Cloudflare, Vercel, S3 or an FTP-uploaded shared host, so agencies never have to move a client's hosting to adopt Vesper.
- **Customer zero is ThoseGeeks.** The first target market is small agencies and freelancers who build Astro sites for non-technical clients.

---

## 3. Decisions

| # | Decision | Status |
|---|---|---|
| D1 | Astro-only. Support the current major and the previous one (7.x and 6.x today). | Decided |
| D2 | The schema comes from the site's `src/content.config.ts`. An optional `vesper.config.ts` holds only presentation and permissions, never field definitions. | Decided |
| D3 | Content stays as files in the repo (`.md`, `.mdx`, `.mdoc`, `.json`, `.yaml`). No database on the customer's site. | Decided |
| D4 | Must work with `output: 'static'` and no adapter. | Decided |
| D5 | Open core. `core`, `astro`, `admin` and `ui` packages are MIT. The cloud service is hosted and not open source (license in §13). | Decided |
| D6 | Three storage modes: `local` (dev, filesystem), `github` (free, editors need GitHub accounts) and `cloud` (paid, editors don't). | Decided |
| D7 | The cloud runs on Cloudflare: Workers, D1 for the control plane, Durable Objects with SQLite for per-site data, R2, Queues, KV, Email Service and Turnstile. Reuse auth and roles ideas from Taproot where they fit. | Decided |
| D8 | Cloud git writes go through a single public **GitHub App** installed on the customer's repo. Editors never touch GitHub. | Decided |
| D9 | The cloud never runs `astro build`. Builds and previews run on the customer's own host. | Decided |
| D10 | Billing uses Stripe Checkout and the Stripe Customer Portal. No custom payment UI. Prefer annual plans and per-account invoices (the 30¢ fixed fee hurts small monthly charges). | Decided |
| D11 | Accessibility: WCAG 2.1 AA minimum for the admin, the dashboard and every component shipped onto customer sites. Meet 2.2 AA where it's cheap. | Decided |
| D12 | Admin UI stack: React 19, Tailwind 4, headless accessible primitives and our own tokens. Don't adopt a component kit's default look (§10). | Decided |
| D13 | **Drafts live in the cloud, not in git.** Git only receives published changes. An optional pull-request mode can come later. | Decided (confirmed by Jeremy, October 17, 2026) |
| D14 | **The studio always runs from the site itself at `/admin`, in every mode and on every host.** Cloud features are reached by signing in to the cloud from the studio (a quick redirect to `app.{{domain}}` and back, using OAuth 2 authorization code + PKCE). No third-party cookies are needed (§7.2). `app.{{domain}}` hosts only sign-in, the agency dashboard and the operator console, never a second copy of the editor. Without cloud access the studio still works fully in local or GitHub mode, and cloud features are simply absent. | Decided |
| D15 | Per-site cloud data lives in a Durable Object per site, using its built-in SQLite. D1 is only for the shared control plane. Reason: D1 databases must be bound at deploy time (about 5,000 per Worker), while a Durable Object's database exists the moment you address it by ID. | Decided (confirmed by Jeremy, October 17, 2026) |
| D16 | **The built site works on any static host:** Netlify, Cloudflare, Vercel, S3 (with or without CloudFront), GitHub Pages, or a traditional web host via FTP/SFTP. No feature may depend on a host's rewrites, headers, functions or image service. Host-specific extras (native redirect files, preview adapters) are optional enhancements, each with a universal fallback (§6.16). | Decided |
| D17 | No cloud-rendered previews at launch. Sites without an SSR-capable host get studio preview, local preview and branch-deploy links (§6.11). Revisit after launch based on demand. | Decided |
| D18 | Scheduling is **time-correct at build**. Entries carry `publishAt` / `unpublishAt`, and the `vesper:content` helpers filter by them during every build. Any rebuild at or after the scheduled time therefore produces the right site, on any host, with or without the cloud. The cloud's job is only to **trigger a rebuild at the exact time**. | Decided |
| D19 | **Vesper reports accessibility; it never claims compliance and never ships an overlay.** Checks find many problems, not all. The UI and docs say so plainly. Vesper never injects any front-end "accessibility widget" or overlay script into sites. | Decided |
| D20 | **Confirmation emails can't be turned into a spam cannon.** Forms with confirmation emails require Turnstile. Each recipient address is rate-limited. The confirmation template is fixed by the site owner, and by default it never repeats the submitter's free-text fields back to them. | Decided |
| D21 | **Uploaded files are private.** They are stored in R2 under per-site keys and never publicly reachable. Site members download them only through short-lived signed links from the dashboard. Retention follows the form's submission retention. | Decided |
| D22 | Integrations are **one event-and-delivery system** shared by forms, comments, publishing and accessibility reports. Each integration has: an event it reacts to, a destination, a field mapping, and a delivery log. Deliveries are queued, retried and visible. Nothing fails silently. | Decided |
| D23 | **Site search is built into the open-source integration and is free.** The integration builds a Pagefind index at build time, so search is plain static files that work on any host (D16), with no service to pay for or keep running. The cloud adds nothing required for search. | Decided |

---

## 4. Product shape

| | Free (open source) | Cloud (paid) |
|---|---|---|
| Editor UI generated from content collections | ✓ | ✓ |
| Local mode (`astro dev`, writes to disk) | ✓ | ✓ |
| GitHub mode (each editor signs in with GitHub) | ✓ | ✓ |
| An entry's history from git, and restoring an earlier version (decided October 21, 2026) | ✓ | ✓ (restores as a draft) |
| Editors log in with email, Google or Microsoft (no GitHub) | | ✓ |
| Roles scoped to collections and folders, plus review before publish | | ✓ |
| Cloud drafts (autosave without commits) | | ✓ |
| Site and studio run on any static host (FTP, S3, Netlify, Cloudflare, Vercel…) | ✓ | ✓ |
| Studio preview, local preview, branch-deploy links | ✓ | ✓ |
| Instant previews and click-to-edit | | ✓ (needs an SSR-capable preview host, §6.11) |
| Form handling (`<Form>`) | | ✓ |
| Comments (`<Comments>`) | | ✓ |
| Media library on R2 | | ✓ |
| Agency dashboard (many sites, one login) | | ✓ |
| White-label studio and dashboard (logo, name, accent) | | Higher tier |
| SSO (SAML/OIDC) | | Higher tier |

Plans and prices are TBD (§13). The rough shape:

- **Solo:** 1 site, a few editors.
- **Agency:** many sites, unlimited editors per site, white-label.
- Usage limits on form submissions and media storage.

---

## 5. Repository layout

npm workspaces monorepo (same tooling as Taproot).

```
packages/
  core/            Schema introspection (Zod → field model), manifest, serializers,
                   storage adapter interface, permission evaluation. No Astro or React imports.
  astro/           The Astro integration: `astro add` entry, /admin route, dev middleware,
                   dev toolbar app, `vesper:content` helpers, <Form>, <Comments>, preview mode.
  admin/           The editor UI (React). One bundle used by all three modes.
  ui/              Small set of accessible primitives + design tokens (§10.5).
                   Used by admin and cloud-app. Candidate to port back to Taproot later.
  create-vesper/ Starter template for `npm create astro -- --template ...`.
apps/
  playground/      An Astro 7 site that exercises every feature (see Phase 0).
  cloud-api/       Worker: auth, git proxy, drafts, forms, comments, media, webhooks, queues.
  cloud-app/       Worker (Astro, server-rendered on Cloudflare): sign-in and /authorize,
                   agency dashboard, operator console. Never a second copy of the studio (D14).
                   Both cloud apps live in a separate private repository, not this one (§13.3).
  docs/            Starlight docs site (Phase 9).
templates/
  oauth-relay/     One-file Worker that performs the GitHub OAuth token exchange for github mode.
```

---

## 6. The Astro integration (first-class Astro)

### 6.1 Install and config

`npx astro add @vesper/astro` registers the integration. Zero config is the goal:

```js
// astro.config.mjs
import vesper from '@vesper/astro';
export default defineConfig({ integrations: [vesper()] });
```

The integration picks a storage mode automatically:

- **`local`** during `astro dev`.
- **`cloud`** when a `VESPER_PROJECT` environment variable is present at build.
- **`github`** when `vesper({ github: { repo } })` is set.

Explicit options can override any of these.

In `astro:config:setup`, the integration:

- injects `/admin` as a single **prerendered** page (a static app shell), so it works with `output: 'static'` and no adapter. Studio screens use hash-based routing (`/admin/#/blog/my-post`), so deep links and reloads work on any host without rewrite rules (D16). The studio respects Astro's `base` for sites hosted in a subfolder.
- registers a dev toolbar app (§6.10)
- registers a `vesper:content` virtual module (§6.11)
- adds the dev-server middleware for local mode (§6.7)

### 6.2 Schema from content collections (the headline feature)

The integration reads the site's collections and generates the editor. Each glob or file loader tells it where files live. Each Zod schema tells it what the fields are.

```ts
// src/content.config.ts: the user writes nothing new
import { defineCollection, reference } from 'astro:content';
import { glob } from 'astro/loaders';
import { z } from 'astro/zod';

const blog = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/blog' }),
  schema: ({ image }) => z.object({
    title: z.string().meta({ label: 'Title' }),
    summary: z.string().meta({ widget: 'textarea', description: 'One or two sentences for cards and search.' }),
    hero: image().optional(),
    author: reference('authors'),
    tags: z.array(z.string()).default([]),
    publishedAt: z.coerce.date(),
    draft: z.boolean().default(false),
  }),
});
```

**Field mapping (v1)**

| Zod / Astro | Editor field |
|---|---|
| `z.string()` | Single-line text |
| `.meta({ widget: '...' })` or a `fields.*` helper | That widget (§6.3) |
| `z.number()` | Number |
| `z.boolean()` | Switch |
| `z.date()` / `z.coerce.date()` | Date (with optional time via `.meta({ widget: 'datetime' })`) |
| `z.enum([...])` | Select (radio group when 4 or fewer options) |
| `z.array(z.string())` | Tag list |
| `z.array(z.enum([...]))` | Multi-select |
| `z.object({...})` | Field group (fieldset with legend) |
| `z.array(z.object({...}))` | Repeater (add, remove, reorder) |
| `image()` | Image upload (§6.6) |
| `reference('collection')` | Relation picker (search, single or multi) |
| `.optional()` / `.default()` | Not required / prefilled |
| Markdown/MDX/Markdoc body | Body editor (§6.5) |
| Anything unmappable (custom transforms, refinements, unions) | Raw YAML field with a short notice. Never crash and never drop data. |

**Meta keys** read through Zod 4's `.meta()`:

- `label`, `description` (help text)
- `widget`, `widgetOptions` (§6.3), `placeholder` (never used as a label)
- `hidden`, `readOnly`
- `autocomplete` (also used for forms)
- `summary`, on a list of objects: the item field that names each item's row in the editor (decided October 25, 2026)

**Implementation notes**

- First check whether the JSON Schemas Astro writes under `.astro/collections/` during `astro sync` can be reused. Fall back to walking the Zod 4 schema directly. Either way, `.meta()` values must survive into the manifest. If Astro's JSON Schemas drop them, the Zod walk is required (§6.3).
- Don't rely only on `z.toJSONSchema()`. Astro's `image()` and `reference()` helpers must be detected and special-cased.
- Only collections using the built-in `glob()` or `file()` loaders are editable. Others are listed as read-only with a one-line explanation.
- Output is a **manifest** containing collections, file locations, path patterns, fields, meta and form definitions. It is generated during `astro sync` and at build. It is bundled into the `/admin` shell and also emitted to `dist/_vesper/manifest.json`, which is how the cloud learns the schema without secrets in the build.

### 6.3 Field types and widgets

**Principle.** The Zod type decides what is stored and how it is validated. The `widget` hint decides which control the editor shows. Content files always hold plain values (strings, numbers, simple objects) that stay readable and useful without the CMS installed.

**Resolution order** (first match wins):

1. An explicit `.meta({ widget: 'name' })` on the field.
2. A registered custom widget (§6.3.3) that declares a `match` function returning true for this field.
3. Base-type inference (the mapping table in §6.2).
4. The raw YAML field.

Two failure cases fall back to step 3, with a dev-mode warning naming the field and the widget:

- an explicit widget name that doesn't exist
- a widget whose `accepts` check rejects the field's shape

Neither may crash the editor.

**Reading meta correctly**

- `.optional()`, `.nullable()`, `.default()` and similar wrappers create new schema instances. The walker must unwrap them and check `.meta()` at every layer. If the same key appears on more than one layer, the outermost wins. So `z.string().meta({...}).optional()` and `z.string().optional().meta({...})` behave the same.
- Read schemas and metadata with the Zod copy Astro uses (`astro/zod`), so a version mismatch can't make hints silently disappear.

#### 6.3.1 The normalized field model

`core` turns each Zod field into a plain, serializable **field model**. Widgets, the manifest and validation messages all consume this model, never raw Zod internals:

```ts
type FieldModel = {
  path: string[];                 // ['location', 'lat']
  kind: 'string' | 'number' | 'boolean' | 'date' | 'enum' | 'array' | 'object'
      | 'image' | 'reference' | 'unknown';
  required: boolean;
  default?: unknown;
  label: string;                  // meta.label ?? humanized key
  description?: string;
  widget?: string;
  widgetOptions?: Record<string, unknown>;
  constraints?: { min?: number; max?: number; pattern?: string; options?: { value: string; label: string }[] };
  children?: FieldModel[];        // object fields / array items
  reference?: { collection: string };
};
```

Validation always runs against the real Zod schema, through the same code path Astro uses. The model is only for building the UI.

#### 6.3.2 Built-in field helpers (`@vesper/astro/fields`)

Each helper returns **plain Zod with meta attached**. Astro validates it like any other schema. The docs show the raw Zod equivalent for every helper, so a site can drop the import and keep identical behavior.

| Helper | Zod it produces | Stored as | Editor control |
|---|---|---|---|
| `fields.color({ palette?, alpha? })` | `z.string().regex(/^#[0-9a-f]{6}$/i)` (8 hex digits with `alpha`) | `"#1a73e8"` | Color input plus a visible hex text field. With `palette`, a radio group of named swatches instead of a full picker. |
| `fields.geo({ defaultCenter?, zoom? })` | `z.object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180) })` | `{ lat: 36.69, lng: -81.97 }` | Map with a draggable pin, plus two always-visible number fields. Address search in cloud mode. |
| `fields.slug({ from: 'title' })` | `z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)` | `"my-post"` | Text field that follows the source field until edited by hand. |
| `fields.url()` | `z.url()` | `"https://…"` | URL input with an "open" link. |
| `fields.email()` | `z.email()` | `"a@b.com"` | Email input. |
| `fields.datetime()` | `z.coerce.date()` | ISO 8601 string | Date and time inputs, with the site's time zone shown in text. |
| `fields.select(options)` | `z.enum([...values])` with labels in meta | `"value"` | Radio group (4 or fewer options) or select. Shows labels, stores values. |
| `fields.markdown({ inline? })` | `z.string()` | Markdown string | Compact Markdown editor for short rich text in frontmatter. |
| `fields.file({ accept })` | `z.string()` | Relative path | Upload for non-image files (PDFs and so on). Shows the file name, type and size. |
| `fields.image(image, { ratios? })` | `z.object({ src: image(), alt, decorative?, focus?, crops? })` | Object (§6.6.2) | Image with alt text, focal point and per-ratio crops (§6.6.4). |

**Accessibility requirements for built-in widgets**

- **Color:** never rely on the visual picker alone. The hex text field is the primary accessible control. Palette swatches have text names and selected state, and contrast against the background is checked.
- **Geo:** the map is an enhancement. The lat/lng number fields are the real controls, and the map pin is keyboard-movable with arrow keys.
- **All widgets:** visible label, help and error text linked with `aria-describedby`, `aria-invalid` when invalid, fully keyboard operable, usable at 320px width.

#### 6.3.3 Custom widgets

Agencies can register their own controls in `vesper.config.ts`:

```ts
import { defineConfig } from '@vesper/astro/config';
export default defineConfig({
  widgets: {
    'store-hours': {
      component: () => import('./cms/StoreHours.tsx'),
      accepts: (f) => f.kind === 'array',          // where it may be used
      match: (f) => f.path.at(-1) === 'hours',      // optional: auto-select without meta
    },
  },
});
```

**Widget contract.** A widget is a React component that receives:

```ts
{ value, onChange, field: FieldModel, id, describedBy, invalid, disabled }
```

It must:

- render a control labelled through `id` (the editor renders the label)
- forward `describedBy` and `invalid` to that control
- be keyboard operable

It must not validate. The editor validates with the Zod schema and shows errors in the standard place.

**Where custom widget code runs.** Custom widgets are bundled into the site's `/admin` studio by Vite at build, in every mode. They always run on the site's own origin, never on `{{domain}}` (D14), so no sandboxing is needed.

### 6.4 Optional `vesper.config.ts` (presentation and URLs; never field definitions or permissions)

```ts
import { defineConfig } from '@vesper/astro/config';
export default defineConfig({
  collections: {
    pages:   { label: 'Pages', url: '/:path', tree: true },                       // §6.15
    blog:    { label: 'Blog posts', url: '/blog/:slug', listFields: ['title', 'publishedAt'], newEntryPath: ':slug' },
    authors: { label: 'People' },                                                 // no url: data-only
    settings:{ singleton: true, label: 'Site settings' },
  },
});
```

Every key is optional, and everything has a sensible default derived from the manifest.

Roles and grants aren't set here. Site admins set them per member in the dashboard (§7.5), so a change needs no developer and no deploy (decided October 20, 2026).

### 6.5 Files and serialization

- **Round-trip fidelity is a hard requirement.** Saving an entry must not reorder, reformat or re-quote frontmatter keys the editor didn't touch, and must not rewrap the body. Use the `yaml` package's Document API to preserve order, comments and quoting. Back this with snapshot tests over a corpus of real-world files.
- **Body editor:** Markdown with a writing (WYSIWYG) view and a source view, built on Tiptap 3 (as in Taproot) with markdown serialization.
- **Markdoc tags and MDX components** get structured, editable blocks in the writing view (§6.5.1, §6.5.2). Anything the writing view can't represent faithfully shows as a protected source chip. The whole body falls back to the source view only if parsing fails.
- **New entries** use the collection's `newEntryPath` pattern, defaulting to a slug from the title. The file ID must stay stable after creation.

#### 6.5.1 Markdoc tags as editable blocks

Markdoc tags already declare their attributes, types, defaults and allowed children in the site's `markdoc.config.mjs` (`@astrojs/markdoc`). The editor reads that config, the same way it reads `content.config.ts`, and builds each tag's interface from it. No second definition is needed.

```js
// markdoc.config.mjs (already in the site)
import { defineMarkdocConfig, component } from '@astrojs/markdoc/config';
export default defineMarkdocConfig({
  tags: {
    callout: {
      render: component('./src/components/Callout.astro'),
      children: ['paragraph', 'list'],
      attributes: {
        type: { type: String, default: 'note', matches: ['note', 'warning', 'tip'] },
        title: { type: String },
      },
    },
    youtube: {
      render: component('./src/components/YouTube.astro'),
      selfClosing: true,
      attributes: { id: { type: String, required: true }, title: { type: String, required: true } },
    },
  },
});
```

**Loading the config.** Load `markdoc.config.mjs` through Vite's SSR loader in dev and at build. Extract only the schema parts (tags, attributes, `children`, `selfClosing`, `inline`, partials, variables) into the manifest under `markdoc`. The `render` targets are recorded by name only.

**How each kind of tag appears in the writing view**

| Markdoc construct | Writing-view representation |
|---|---|
| Tag with children (e.g. `callout`) | A labeled frame. The header line shows the tag's friendly name plus the summary attribute ("Callout · Warning") and a Settings button. The content inside is editable, and only the node types listed in `children` can be inserted there. |
| Self-closing tag (e.g. `youtube`) | A compact card with a one-line summary and Settings. |
| Inline tag | A small inline chip with Settings available. |
| `{% partial file="…" /%}` | A card with a file picker over the site's partials folder. |
| Variables `{% $x %}`, functions, `{% if %}` / `{% else %}`, annotations (`{% .class %}`, `{% #id %}`) | **Protected source chips** in v1: visible, editable as raw text in a small field, never reformatted or dropped. `{% if %}` blocks keep their inner content editable. |
| Unknown tags (not in the config) | A protected source chip, plus a validation warning. |

**Inserting**
- Tags are inserted through a "/" menu while typing, and through an Insert button in the body toolbar for people who don't use slash commands.
- Both list tags by friendly name and filter to what is allowed at the cursor position.

**Settings form.** Built from the tag's attributes and rendered with the same widgets as frontmatter fields (§6.3):

| Markdoc attribute | Settings control |
|---|---|
| `String` with an array `matches` | Select (radio group for 4 or fewer options) |
| `String` with a RegExp `matches` | Text field with pattern validation |
| `String` | Text field |
| `Number` | Number field |
| `Boolean` | Switch |
| `Array` / `Object` | Raw YAML field, or the frontmatter's widgets when its hint gives a Zod `schema` (decided October 25, 2026) |
| `required: true` | Marked in text: the studio marks optional attributes "(optional)", and required controls carry `aria-required` (decided October 25, 2026) |
| `default` | Prefilled, and omitted from the source when unchanged |
| Custom attribute type classes | Text field, plus that class's own validation |

**Optional UI hints** live in `vesper.config.ts`, never in `markdoc.config.mjs`, so Markdoc's own config and types stay clean:

```ts
markdoc: {
  tags: {
    callout: { label: 'Callout', summary: 'type', attributes: { type: { labels: { tip: 'Tip', note: 'Note', warning: 'Warning' } } } },
    youtube: { label: 'YouTube video', summary: 'title', attributes: { title: { description: 'Describes the video for screen reader users.' } } },
  },
},
```

Hints cover: label, help text, the summary attribute, value labels, a `widget` per attribute (so `color` and `geo` work inside tags too), and a Zod `schema` for an `Array` or `Object` attribute, as MDX components' `props` have (decided October 25, 2026).

**Validation**
- Run `Markdoc.validate()` against the site's real config as the editor types (debounced).
- Errors show inline on the offending block, and also in the field error summary on publish.
- Errors at Markdoc's `error` or `critical` level block publishing, with a plain-language message. Warnings don't block.

**Round-trip fidelity for Markdoc**
- Never run the whole document through `Markdoc.format()`, because it normalizes the entire file.
- Keep the original source text. Use Markdoc's parsed tree, whose nodes record their source lines, only to locate each tag.
- When a block changes, re-serialize that block alone and splice it back into the original text. Untouched tags, spacing, attribute order and quoting stay byte-identical.
- Newly inserted tags use one consistent house style: attributes in schema order, and defaults omitted.

**Rendering components in the editor (v2, off by default)**
- Each block can optionally show the real Astro component instead of the structural frame.
- It renders through the dev server in local mode and through the preview deployment in cloud mode (§6.11).
- It's a per-user toggle, off by default, to keep the editor calm (§10).

**Accessibility of blocks**
- Each block is a labeled group (the tag's friendly name) with a real Settings button.
- Arrow keys move into and out of a block's content predictably, and Escape returns focus to the block's frame.
- The "/" menu follows the combobox/listbox pattern.
- Every tag can be inserted, configured, moved (Move up/down) and removed without a mouse.
- The source view toggle is always one click or keystroke away.

#### 6.5.2 MDX components (opt-in)

MDX components don't declare their props anywhere the editor can read, so by default MDX bodies get the writing view for plain Markdown and protected source chips for JSX. If a site declares its components in `vesper.config.ts` with a Zod props schema, they get the same block interface as Markdoc tags:

```ts
mdx: {
  components: {
    Callout: { label: 'Callout', children: true, props: z.object({ type: z.enum(['note', 'warning', 'tip']).default('note') }) },
    YouTube: { label: 'YouTube video', props: z.object({ id: z.string(), title: z.string() }) },
  },
},
```

The same source-splicing rule applies: only changed JSX elements are re-serialized. Undeclared components, expressions (`{…}`), imports and exports stay as protected source chips.

### 6.6 Media and images

**Principle.** Astro already handles formats, `srcset`, `layout`, and `fit` and `position` (CSS `object-fit`/`object-position` semantics, added in 5.10). It also crops server-side when an image is given both a width and a height. Vesper doesn't replace any of that. It adds what Astro has no place for: **editorial decisions about an image** (focal point, per-ratio crops, alt text in context), plus **repo hygiene** at upload time. Edits are always non-destructive. The original file is never modified after upload.

#### 6.6.1 Where files go

- Uploads go into the site's assets folder: inferred from where existing images for that collection live, otherwise `src/assets/<collection>/`. Frontmatter stores a relative path so `astro:assets` optimizes the image at build.
- Cloud tier option: large libraries or non-image media go to R2 and are served from a media hostname. The integration adds that hostname to `image.remotePatterns` automatically. Focal points and crops work identically for R2 images.

#### 6.6.2 The image field and stored shape

`fields.image(image)` wraps Astro's own `image()` helper inside an object, so `src` still resolves to `ImageMetadata`. Pass `image` from the schema context:

```ts
schema: ({ image }) => z.object({
  hero: fields.image(image, { ratios: ['wide', 'square'] }),
})
```

Stored in frontmatter:

```yaml
hero:
  src: ../../assets/blog/harbor.jpg
  alt: Fishing boats leaving the harbor at dawn
  focus: { x: 0.62, y: 0.35 }          # 0–1, origin top-left; optional
  crops:                                # optional per-ratio overrides, normalized rects
    square: { x: 0.40, y: 0.10, w: 0.45, h: 0.80 }
```

**Alt text**
- `alt` is required unless the editor ticks "Decorative image," which stores `alt: ""` and `decorative: true`.
- Alt text lives in the entry, not in a media library. The same photo can carry different alt text in different contexts, which is correct for accessibility, and it falls out of the git-based design.
- The alt field shows a short prompt ("Describe what this image communicates on this page") and warns on filename-like or very long text. It never auto-fills.

**Defaults and fields**
- With no `focus`, the center is assumed.
- With no crop for a ratio, the crop is computed from the focal point.
- A plain `image()` field (without the helper) still works: upload, alt (if the schema has an alt field next to it), and no focal or crop UI.

#### 6.6.3 Aspect ratios (declared once)

```ts
// vesper.config.ts
images: {
  ratios: { wide: 16 / 9, square: 1, portrait: 4 / 5, og: 1.91 },
  maxUploadEdge: 3000,
},
```

The ratios drive the editor's crop previews and the `<Img>` component's `ratio` prop, so editors see exactly the crops the site uses. Add a built-in `og` ratio (1.91:1) for social images.

#### 6.6.4 Editor experience

**Focal point**
- Click or tap the image to set the focal point.
- Keyboard: focus the image control, then arrow keys move the point 1% (Shift for 10%). Visible x/y number fields (0–100%) sit alongside, so the point can be set without seeing or pointing.
- A polite live region announces the position ("Focal point 62% across, 35% down").

**Crop previews**
- A strip of small previews shows the image cropped to each ratio listed for that field (or all site ratios).
- Each preview is labeled with its name and ratio, and updates live as the focal point moves.

**Manual crop override**
- "Adjust crop" on a preview opens a dialog with a fixed-ratio crop box over the image.
- Drag to move, and drag a corner to resize. Keyboard: arrows move it, Shift+arrows resize it, Enter applies, Escape cancels.
- "Reset to focal point" removes the override.
- Previews with an override show "Custom crop" in text.

**Calm by default (§10)**
- The field shows the image, alt text, and a single "Focal point & crops" disclosure.
- Previews and crop tools appear only when that disclosure is opened.

#### 6.6.5 Rendering on the site

**`<Img>` component** (`@vesper/astro/components`), a thin wrapper over Astro's `<Image>` and `<Picture>`:

```astro
<Img image={post.data.hero} ratio="wide" widths={[480, 960, 1440]} sizes="100vw" />
<Img image={post.data.hero} art={{ base: 'square', '(min-width: 48rem)': 'wide' }} />
<Img image={post.data.hero} layout="full-width" />   <!-- fluid: focal point via object-position -->
```

How it behaves:

| Prop | Behavior |
|---|---|
| `ratio` | Uses the stored crop for that ratio if one exists, otherwise a crop computed from `focus`. Output at that exact ratio. |
| `art` | Art direction: renders `<picture>` with a `<source media>` per breakpoint, each using its own crop (Astro's `<Picture>` handles formats, not per-breakpoint crops). Built with `getImage()`. |
| No ratio (fluid layouts) | No server crop. The focal point becomes `object-position` (for example `62% 35%`), so CSS cropping keeps the subject in frame. |
| Always | `alt` from the field. `decorative` renders `alt=""`. Every other Astro image prop passes through. |

**Crop step (image service wrapper)**
- The integration registers a thin wrapper around Astro's default Sharp image service. It adds one optional transform parameter: a normalized crop rectangle.
- The wrapper cuts that rectangle out first (Sharp `extract`), then hands off to the standard Sharp transform for resizing and formats. Caching, `srcset` and formats are unchanged.
- The integration sets this service only when the site uses the default Sharp service. Its config change is visible and opt-out.

**Crops are baked in at build, so they work on every host (D16).** Cropped files are ordinary static images in `dist/`, served the same way from FTP, S3 or any CDN.

**Host image services are optional.** If a site opts into a host's image service through an adapter (for example Cloudflare, Netlify or Vercel), `<Img>` keeps working but falls back to Astro's own server crop for the ratio plus focal `object-position`. Manual crop rectangles are only guaranteed with the default build-time Sharp service, and the docs say so.

**Verify early:** how Astro forwards `position` to the image service. If percentage values reach the Sharp step and break it, set `object-position` through `style` instead and keep `position` at its default.

**Markdown and Markdoc body images**
- Body images keep using Astro's built-in Markdown image processing.
- They get the same upload hygiene and required-alt checks in the editor.
- They don't get focal points or crops in v1.

#### 6.6.6 Upload hygiene (protects the git repo)

Runs in the browser before anything is committed:

- **Downscale** originals larger than `maxUploadEdge` (default 3000px long edge). Astro makes the web sizes; the repo shouldn't store 50 MB camera files.
- **Convert** HEIC/HEIF (iPhone photos) to JPEG. Keep PNG, WebP, AVIF, SVG and GIF as uploaded.
- **Strip location data** (EXIF GPS) and other personal metadata. Apply EXIF orientation to the pixels first so photos don't end up sideways.
- **Hash for duplicates.** Compute a content hash. If the same image already exists in the assets folder, offer to reuse it instead of committing a copy.
- **Size limits.** Warn above a configurable size (for example 5 MB after processing) and block above a hard limit. In cloud mode, large files can go to R2 instead (§6.6.1).
- **SVG safety.** Sanitize uploaded SVGs (strip scripts and event handlers) before committing.

**Media browser**
- Browse and reuse images already in the assets folders, filtered by folder, with search by file name.
- Each image shows **"Used on"**, computed by scanning entries for its path.
- An **"Unused images"** view helps clean up the repo. Deleting is always a confirmed, single commit.

### 6.7 Local mode

- During `astro dev`, the integration adds middleware at `/_vesper/api/*` that lists, reads and writes files on disk. Astro's content layer picks up changes and hot-reloads the site.
- No auth. The middleware refuses requests whose host isn't localhost.
- This is the free onboarding path: no account, no cloud, no GitHub.

### 6.8 GitHub mode (free)

- The admin talks to the GitHub API directly. Each editor signs in with their own GitHub account.
- OAuth token exchange runs through `templates/oauth-relay` (a one-file Worker the user deploys) or through a free relay endpoint on the cloud.
- Saves are commits to the default branch. A multi-file save (an entry plus its uploaded image) is one commit, using the Git Data API (blobs → tree → commit → update ref).

### 6.9 Connecting the studio to the cloud

The studio is the same `/admin` bundle everywhere (D14). Cloud mode is a connection the studio makes, not a different place to edit.

**Signing in**
- **Project ID.** A **public** project ID is baked into the studio at build, from `VESPER_PROJECT` or `vesper({ cloud: { project } })`. It's an identifier, not a secret.
- **Sign-in screen.** It offers "Sign in with Vesper" (cloud) and, if configured, "Sign in with GitHub" (GitHub mode).
- **Cloud sign-in flow.** A top-level redirect to `app.{{domain}}/authorize`, which returns to `/admin/#/callback` with a one-time code. The studio exchanges the code (PKCE) for a short-lived access token scoped to that one site. Details in §7.2.

**What the studio shows**
- **Connected:** cloud features appear in place. That means drafts and autosave, review and publish, roles and grants, instant preview, and links to the dashboard for the forms inbox and comment moderation.
- **Not connected** (no project, no access, or the cloud unreachable): the studio runs in GitHub or local mode. Cloud-only features are **absent, not disabled**. At most one quiet line in the studio's settings mentions that cloud features exist. No upsell banners.
- **Cloud unreachable mid-session:** unsaved work stays in the browser (IndexedDB) and the studio says plainly that it will retry. Nothing is lost.

**Schema.** The schema always comes from the studio's own bundled manifest, so the studio and the site can never disagree. The cloud still reads `/_vesper/manifest.json` from the deployed site for server-side jobs such as form validation (§6.2).

### 6.10 Dev toolbar and "edit this page"

- A dev toolbar app shows the entries rendered on the current page and links each one straight to its editor screen.
- **Page-to-entry mapping:** the `vesper:content` helpers (§6.11) record which entries each route reads.
  - In dev and preview builds, the mapping is exposed to the toolbar and the click-to-edit overlay.
  - In production builds it is not emitted at all.

### 6.11 `vesper:content` helpers and previews

```ts
// Sites import from here instead of astro:content (drop-in API).
import { getCollection, getEntry, render } from 'vesper:content';
```

- **Production builds:** these re-export `astro:content` unchanged. Zero runtime cost.
- **Preview deployments:** when `VESPER_PREVIEW=1` is set and the site has an adapter, the same calls switch to Live Content Collections. They read the editor's current draft from the cloud at request time, so edits appear in seconds with no rebuild. Live collections are stable since Astro 6.

**Preview tiers.** Every site gets a useful preview on any host. Better tiers appear when they're available.

1. **Studio preview** (all modes, any host, no infrastructure).
   - The studio renders the entry's body and main fields in the browser, styled with the site's own built CSS. At build, the integration records which stylesheets each collection's route uses.
   - It's approximate (no site layout or components) but instant, and it works on an FTP-hosted site.
2. **Local preview** (local mode). The real site, side by side, through the dev server, updating as the editor types. Exact.
3. **After publish.** "View on site" links to the live page. On hosts with branch or preview deploys (Netlify, Cloudflare, Vercel), the studio also links there.
4. **Instant preview** (cloud). The real site, rendered on request from cloud drafts, within seconds of each keystroke.
   - This needs something that can render Astro on request. The default is a preview deployment of the site on any SSR-capable host: Netlify, Cloudflare, Vercel, or any Node host via `@astrojs/node`. It's built from the default branch with `VESPER_PREVIEW=1`.
   - The site's code rebuilds only when the code changes. Content comes live from cloud drafts.
   - The studio shows it side by side in an iframe and refreshes it over `postMessage` after each debounced autosave.
   - The production site stays plain static output on whatever host it uses (D16).
   - For sites with no SSR-capable host at all (FTP, S3, GitHub Pages), the cloud does **not** render previews at launch (D17). They get tiers 1–3. Revisit after launch if customers ask.

### 6.12 Click-to-edit overlay (preview only)

- In preview mode only, `injectScript('page', ...)` adds a small overlay script. Never in production.
- Elements rendered from an entry carry `data-vesper-entry` and `data-vesper-field` attributes, added by an `editable(entry, 'field')` helper.
- The overlay shows an edit button on hover and focus, and tells the editor which field to focus. It must be keyboard reachable and must not trap focus.

### 6.13 `<Form>` (cloud)

```ts
// src/forms.config.ts
import { defineForm } from '@vesper/astro/forms';
import { z } from 'astro/zod';
export const forms = {
  contact: defineForm({
    schema: z.object({
      name: z.string().min(1).meta({ label: 'Your name', autocomplete: 'name' }),
      email: z.string().email().meta({ label: 'Email', autocomplete: 'email' }),
      message: z.string().min(10).meta({ label: 'Message', widget: 'textarea' }),
    }),
    successMessage: "Thanks — we'll be in touch.",
  }),
};
```

```astro
---
import { Form } from '@vesper/astro/components';
---
<Form name="contact" />
```

**Rendering**

- Plain HTML that works without JavaScript: a POST to the cloud endpoint, which redirects back with a success or error state.
- JavaScript only enhances: inline validation and staying on the page.

**Accessible by default (non-negotiable)**

- A real `<label>` on every field. Required state is stated in text, not only with an asterisk.
- Help and error text linked through `aria-describedby`, with `aria-invalid` on fields that fail.
- On a failed submit, an error summary at the top that lists each error as a link to its field, and focus moves to that summary.
- `autocomplete` attributes taken from the field meta.
- Groups use `fieldset` and `legend`.
- Honeypot is hidden from both eyes and assistive tech. Turnstile uses managed mode.
- Visible focus, no placeholder-as-label, and every state works at 200% zoom and on a 320px-wide screen.

**Behavior**

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

### 6.14 `<Comments>` (cloud)

- `<Comments entry={post} />` renders approved comments at build time from a data collection. Each commented entry has one file at `src/content/comments/<collection>/<id>.json`, and the integration registers the collection automatically. No client JavaScript is needed to read comments.
- The "add a comment" form is a small enhanced form that posts to the cloud and follows the same accessibility rules as `<Form>`.
- Moderation happens in the dashboard. Approving comments commits them to the repo in batches, so the next build shows them.
- Comment body is a restricted Markdown subset with no raw HTML. It is sanitized on the server.

### 6.15 URLs, hierarchy and redirects

**Principle.** For hierarchical collections, **the folder is the hierarchy**. A page's path is its file path relative to the collection's base, minus the extension and minus a trailing `index`. So `src/content/pages/academics/nursing/index.md` is `/academics/nursing`.

- The git tree matches the site tree.
- Astro's glob loader already includes folders in entry IDs.
- Nothing has to be computed or stored to know where a page lives.

This is the same idea as Taproot's materialized paths and cascading renames, with the file system doing the storing.

#### 6.15.1 URL patterns (one source of truth)

```ts
// vesper.config.ts
collections: {
  pages: { url: '/:path', tree: true },
  blog:  { url: '/blog/:publishedAt|yyyy/:slug' },
  authors: {},                       // no url: data-only, never linkable
},
```

**Tokens**

| Token | Value |
|---|---|
| `:id` | The entry ID |
| `:path` | The ID with any trailing `/index` removed |
| `:slug` | The last segment of the path |
| `:<field>` | A frontmatter value |
| `:<dateField>\|yyyy`, `\|mm`, `\|dd` | Parts of a date field |

**Rules**
- **Patterns are strings by default.** They cover almost every site and are easy to read. Because the studio is bundled with the site (D14), a function form `url: (entry) => string` is allowed as an escape hatch. The function must be pure and must not import server-only code.
- **Respect Astro's settings.** Generated URLs and redirects follow `base` and `trailingSlash`.
- **Check patterns against real routes.** In dev, compare each pattern with Astro's resolved routes (the `astro:routes:resolved` hook) and warn when no route can produce it. Record which route renders each collection; previews (§6.11) use that.
- **Every URL-aware feature uses this pattern:** "view on site," previews, the link picker, redirects, breadcrumbs.
- **Index IDs.** Verify how the glob loader IDs `index` files, and normalize either way so `foo/index` and `foo` resolve to the same page.

#### 6.15.2 Tree view

A collection with `tree: true` shows as an outline instead of a flat list. The editor suggests `tree: true` when nested folders exist.

- **Calm by default.** Collapsed beyond the first level. One line per page: title, muted path, status as text (§10.4).
- **Actions per page,** in the row's "…" menu: Add child page, Move to…, Move up/down, Delete.
- **Moving.** Drag and drop is offered, but never required. "Move to…" opens a searchable parent picker. "Move up/down" changes order.
- **Accessibility.** Implement the WAI-ARIA tree pattern: `role="tree"`/`treeitem`, `aria-expanded`, `aria-level`, arrow-key navigation, Home/End, and type-ahead. Announce moves through a polite live region ("Nursing moved under Academics, position 1 of 3").

#### 6.15.3 Section pages and sibling order

- **Section pages.** `folder/index.<ext>` is the section page for that folder. Every folder level should have one so every breadcrumb resolves. The editor flags folders without an index and offers a one-click "Create section page."
- **Order.** Files have no inherent order, so each folder may carry an `_order.yaml` listing its children by slug:

  ```yaml
  # src/content/pages/academics/_order.yaml
  - nursing
  - business
  - general-studies
  ```

  - Unlisted children sort by title after the listed ones.
  - Reordering changes this one file instead of every sibling's frontmatter.
  - Deleting a page removes its line in the same commit.
- **Keep `_` files out of collections.** Recommend glob patterns that skip them, like `'**/[^_]*.md'`. Warn when a collection's pattern would pick up `_order.yaml`.

#### 6.15.4 Moving and renaming

- **The whole subtree moves.** Changing a page's slug or parent moves its file plus its whole subtree: folder, index and descendants. It all happens in **one atomic commit**: file renames on disk in local mode, or one Git Data API tree with removals and additions in GitHub and cloud mode.
- **Confirm in plain language.** The confirmation dialog says exactly what will happen: "Move Nursing and its 6 pages under Academics? 4 links on other pages will be updated."
- **Permissions.** The user needs an edit grant on both the old and the new location.
- **Validation before the move:**
  - no duplicate paths
  - no collision with static routes in `src/pages` (from the resolved route list)
  - no reserved paths (`/admin`, `/_vesper`)
  - valid slug format
  - optional `maxDepth`

#### 6.15.5 Redirects

All redirects live in one file at the repo root:

```yaml
# vesper.redirects.yaml
- { from: /programs/nursing, to: /academics/nursing, status: 301, reason: move, at: 2026-10-17 }
- { from: /apply-now, to: /admissions/apply, status: 302, reason: manual, at: 2026-10-01 }
```

**When redirects are written**
- Every move adds an entry for the page **and each descendant**, in the same commit as the move.
- Site admins get a small Redirects screen in site settings for vanity URLs and old-site migrations. It includes CSV import for moving a WordPress or Drupal site over.

**How redirects reach the live site (any host, D16)**

- **Universal default.** The integration merges the file into Astro's `redirects` config. With static output, Astro emits a small HTML redirect page at each old URL. That works everywhere, including FTP hosts and plain S3, but it isn't a true HTTP 301.
- **Native rules (true 301s), when the host supports them.** Auto-detected from the build environment (`NETLIFY`, `CF_PAGES`, `VERCEL`), or set explicitly with `redirects: { native: ['apache'] }`:

  | Host | Output |
  |---|---|
  | Netlify, Cloudflare Pages | `_redirects` file. Use Netlify's forced (`!`) form so rules win over any file at that path. |
  | Vercel | `redirects` merged into an existing `vercel.json`. Never overwrite the user's other settings. |
  | Apache / LiteSpeed (most FTP shared hosting) | `.htaccess` rules merged between `# BEGIN vesper` / `# END vesper` markers, leaving the rest of the file untouched. |
  | nginx | `dist/_vesper/nginx-redirects.conf` for the server admin to include. |
  | S3 website hosting | The S3 deploy template (§6.16) sets each redirect page's website-redirect metadata on upload, which S3 serves as a real 301. |

- When native rules are active, skip the HTML redirect pages for those URLs, so a file never shadows a rule. The exception is S3, where the redirect page is the object that carries the redirect metadata.

**Automatic cleanup, every time the file is written**
- Chains collapse: A→B→C becomes A→C.
- Loops are removed.
- A redirect whose `from` now belongs to a real page is dropped, with a warning. The page wins.
- A redirect to a URL that no longer exists is flagged at build.

#### 6.15.6 Internal links

- **Link picker.** In the body editor and in URL-type fields, editors search pages by title and the editor inserts that page's current path. The Markdown stays plain and portable.
- **Fix links on a move.** The editor scans all of the site's content for links to the old URLs and updates them in the same commit. That covers Markdown links, Markdoc and MDX attributes holding URLs, and frontmatter fields using `widget: 'url'`. Redirects remain as the safety net for links outside the site.
- **Optional build check.** Warn on internal links that resolve to neither a page nor a redirect.

#### 6.15.7 Site helpers (`vesper:content`)

```ts
import { getTree, getChildren, getBreadcrumbs, getUrl } from 'vesper:content';
const tree   = await getTree('pages');                 // nested, ordered by _order.yaml
const kids   = await getChildren('pages', entry);
const crumbs = await getBreadcrumbs('pages', entry);   // [{ title, url }]
const href   = getUrl(entry);                          // from the collection's url pattern
```

They behave the same in production builds and on live previews.

**Roles and the tree.** Folder-scoped grants (§7.5) map directly onto the tree: "Admissions can edit `admissions/**`" means "this branch." The tree view shows a user only the branches they can edit, plus the ancestors needed for context, shown read-only.

**Later (not v1):** locale folders (`en/`, `es/`) with links between translations.

### 6.16 Hosting and deploys (works anywhere)

**The output is ordinary `astro build` static output** (`dist/`), including the studio at `/admin`. Every feature in this spec must work when `dist/` is copied to any static host (D16).

The integration respects Astro's `base`, `trailingSlash` and `build.format`, so sites work in a subfolder on shared hosting and on hosts that need `page/index.html` versus `page.html`.

**How a published change reaches the live site.** Content is saved as commits to the repo (GitHub or cloud mode). Then:

| Host | How it rebuilds |
|---|---|
| Netlify, Cloudflare, Vercel, or any git-connected host | The host builds on every commit. Nothing to set up. |
| Traditional host via FTP/SFTP | GitHub Actions workflow template: build on push, then mirror `dist/` to the host over SFTP or FTP, deleting files the build no longer has. For now it uploads the whole site each time; uploading only changed files can follow (decided October 21, 2026). Credentials live in GitHub repository secrets. |
| S3 (with optional CloudFront) | GitHub Actions workflow template: build, then sync to the bucket, set redirect metadata (§6.15.5) and optionally invalidate CloudFront. |
| No CI at all | Build locally and upload `dist/` by hand. Edits made in the studio wait in git until the next build, and the studio says so in plain words ("Published. It will be live after the site is next built."). |

**CLI helper.** `npx vesper deploy init --target sftp|ftp|s3|github-pages` writes the matching workflow file and lists the secrets to add. The templates are plain YAML in the repo, so agencies can read and adjust them.
- **Vesper never deploys a site itself.** The workflows run in the site owner's GitHub account, with their secrets.
- **Phase 4.5 builds `sftp`, `ftp` and `hook`.** `hook` is for git-connected hosts: it calls the host's build hook on a schedule (§6.17).
- **`s3` and `github-pages` follow in Phase 9.**
- **Every template also listens for the cloud's `repository_dispatch`** (§6.17).

(Decided October 21, 2026.)

**Deploy status (cloud mode).** The studio and dashboard read GitHub commit statuses and check runs for the published commit. They show "Publishing…", "Live" or "Build failed" with a link to the log. The GitHub App asks for read-only checks and statuses permissions for this.

**The studio on the live site**
- `/admin` is a static shell. It shows nothing without signing in (GitHub or cloud), so deploying it publicly is safe by default.
- `vesper({ studio: { deploy: false } })` leaves it out of production builds for sites edited only locally.
- On hosts that support headers, recommend a strict Content Security Policy for `/admin`, using Astro's CSP support. A sample `.htaccess` and `_headers` snippet go in the docs.

**Test matrix.** CI deploys the playground's `dist/` to a plain static file server with no rewrites, no headers and no functions. It verifies:
- every page and `/admin` loads
- studio deep links work after a reload
- forms post to the cloud
- redirects resolve

Spot-check builds for Netlify, Cloudflare, Vercel and S3 once per release.

### 6.17 Scheduled publish and unpublish

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
- Every check in one build uses one instant, read when the build starts. Collections without scheduling pass through `vesper:content` untouched.
- In dev, scheduled entries stay visible with a small "Scheduled" marker, so editors can work on them. The marker appears in Vesper's dev toolbar app, and as a small note on the entry's own page (decided October 21, 2026).

**What an unpublished entry's URL does.**
- By default it simply stops being built, so it 404s.
- An optional `unpublishRedirect` field (a page picker) sends visitors elsewhere once the entry unpublishes. For example, an expired event can point to `/events`.
  - The build adds the redirect only once the entry is past its `unpublishAt`, through the same cleaning and host rules as `vesper.redirects.yaml` (§6.15.5).
  - It's temporary (302), since an entry can come back.
  - Nothing is written into the redirects file (decided October 21, 2026).

**Time zones.**
- A site time zone setting (IANA name) controls how times are shown and entered. Storage is always ISO 8601 with offset.
- The date and time controls show the zone in text ("8:00 AM Eastern").

**Free tier (no cloud).**
- Accuracy equals rebuild frequency. The deploy templates (§6.16) gain an optional scheduled rebuild, for example hourly via GitHub Actions `schedule`. Git-connected hosts get the `hook` template, which calls their build hook the same way.
- **It rebuilds only when something is due** (decided October 21, 2026).
  - Every build writes `_vesper/schedule.json` with the next time the site changes, never what changes.
  - The scheduled run reads that file from the live site and rebuilds once that time has passed.
- The studio states the accuracy plainly: "Goes live at the first rebuild after 8:00 AM. This site rebuilds hourly." It knows how often from `rebuildEvery` (minutes) in `vesper.config.ts`. Without it, the studio says "Goes live the next time the site is built after 8:00 AM."

**Cloud tier (exact).**
- The cloud keeps each site's upcoming publish and unpublish times in the SiteDO and sets a Durable Object alarm for the next one.
  - It reads the times from the site's files after every publish through the cloud, and on GitHub's push webhook. A time set in local mode, or in a developer's commit, is then exact too (decided October 21, 2026).
- When the alarm fires, the cloud triggers a rebuild using one of:
  - the site's **deploy hook** URL (Netlify, Vercel or Cloudflare build hooks, stored as a secret), or
  - a GitHub `repository_dispatch` event, which the deploy templates listen for.
- The dashboard shows each scheduled event's result: rebuild triggered, then live or failed, using the deploy status from §6.16.

**How a scheduled draft gets into git.**
- The default is **commit now, filter at build**: scheduling a draft publishes the file immediately with a future `publishAt`. The content is safely in git, and if the cloud is unreachable at the scheduled time, the next rebuild still gets it right.
- For **public repositories**, a site setting `holdScheduledDrafts: true` keeps the draft in the cloud until the scheduled time, then commits it and triggers the rebuild. The studio warns about this choice when it detects the repo is public.
  - It's off unless a site admin turns it on in the dashboard (decided October 21, 2026).
- **Only an entry that isn't live yet gets a publish time.** A page's file holds one version, so for a live entry, "Schedule…" sets only when it comes down (decided October 21, 2026).

**Where it lives in the UI (§10.4 rule)**
- The primary button becomes a split button: **Publish ▾**, with "Schedule…" in its menu. That still counts as one primary button.
- "Schedule…" opens a small dialog: date, time (with zone text), an optional unpublish date, and an optional unpublish redirect.
- Scheduled entries show "Scheduled · Mon, Nov 3, 8:00 AM" as their status text.
- The entry list's status filter gains "Scheduled."
- A plain "Scheduled" view lists upcoming changes across the site, with reschedule and cancel.
  - It's a screen reached from Home and from the entry list's filter, never a navigation item.
  - **Cancelling an unpublish** removes it.
  - **Cancelling a publish in the cloud** makes the entry a draft again.
  - **Local and GitHub mode** have no drafts, so for a publish they offer reschedule only.

  (Decided October 21, 2026.)

**Accessibility.** Date and time use native inputs or the `ui` kit equivalents, with visible labels and the zone in text. The split button follows the menu button pattern.

### 6.18 Accessibility checks

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

### 6.19 Site search

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

## 7. Cloud architecture

### 7.1 Services

```
Customer site (static output, any host: FTP, S3, Netlify, Cloudflare, Vercel…)
  ├─ /admin studio ⇄ api.{{domain}}  (bearer tokens; sign-in via app.{{domain}}/authorize)
  ├─ <Form>, <Comments> POST → api.{{domain}}
  └─ preview deployment (optional, customer's host) ⇄ api.{{domain}} drafts (live loader)

api.{{domain}}  (Worker: cloud-api)
  ├─ auth & sessions        ├─ git proxy (GitHub App)     ├─ drafts / review / publish
  ├─ forms & comments       ├─ media (R2)                 ├─ webhooks (GitHub, Stripe)
  └─ Queues consumers: commit batching, email, webhook fan-out, usage roll-up

app.{{domain}}  (Worker: cloud-app, Astro server-rendered)
  ├─ sign-in & /authorize (PKCE)   ├─ agency dashboard     └─ operator console (/ops, behind Cloudflare Access)

Storage
  D1 "control"      accounts, users, memberships, sites, plans, entitlements, audit log
  SiteDO (per site) drafts, reviews, form submissions, comments, usage counters, cached repo tree
  R2                media, form file uploads, data exports
  KV                entitlement cache, session lookup cache
```

### 7.2 Identity and sessions

- **Login methods:** email magic link, Google and Microsoft at launch. SAML/OIDC SSO on a higher tier later.
- **Dashboard sessions:** HttpOnly, Secure, SameSite=Lax cookies on `app.{{domain}}`. Rotate sessions on privilege change. All cookie-authenticated mutations are CSRF-protected.
- **Studio access (the studio runs on the customer's domain, D14):** OAuth 2 authorization code with PKCE. No third-party cookies anywhere.
  - **Sign-in.** The studio does a top-level redirect to `app.{{domain}}/authorize?site=…`. That page uses the first-party dashboard session (signing in if needed), checks site membership, and redirects back to `/admin/#/callback` with a one-time code bound to the site's registered origin. The studio exchanges the code for an **access token**.
  - **Access tokens:**
    - short-lived (about 10 minutes)
    - audience-restricted to that one site
    - carrying the user's site role and grants
    - held in memory only, never in localStorage
  - **Staying signed in** (decided October 20, 2026). Tokens are bound to a key the browser can't export (DPoP):
    - The studio makes a non-extractable key pair and keeps it in IndexedDB. Every token is bound to it, so a copied token is useless anywhere else.
    - The access token is renewed in the background with a refresh token that rotates on every use. The refresh token is bound to the same key, and lapses after 12 hours unused or 7 days at most.
    - Only then does the studio repeat the redirect. While the dashboard session is valid, that completes in about a second with no prompt.
    - Unsaved edits are kept in IndexedDB across it, so nothing is lost.
  - **Registered origins.** Each site registers its allowed studio origins (production domain, preview domains, `localhost` for dev). Codes are only issued to those origins.
  - **Defense in depth.** Tokens are visible to scripts on the customer's domain, so they stay short-lived and site-scoped, and the docs recommend a CSP for `/admin` (§6.16). The API re-checks every grant server-side. The token is never trusted for permissions on its own.
- **Invites:** agency admins and site admins invite people by email. An invite carries the account, the site and the role.
- **Rate limits** on login and magic-link sends, by IP and by email.

### 7.3 Git proxy (GitHub App)

- A single public GitHub App. The customer installs it on the site repo from the dashboard's "Connect repository" flow, and the cloud stores the installation ID.
- Installation tokens are short-lived (about 1 hour). Mint them on demand and cache them until shortly before expiry.
- **Reads:** cache the repo tree in the SiteDO, keyed by commit SHA. Use conditional requests and stay well inside GitHub's per-installation rate limits.
- **Writes:** one atomic commit per publish using the Git Data API.
  - The commit author is the App bot.
  - Each editor is attributed with a `Co-authored-by:` trailer and a `Vesper-Editor:` trailer carrying their user ID.
- If a branch rule refuses a direct push, say so plainly. The dashboard checks the branch's rules when the repository is connected, so the agency hears about it before an editor does. Opening a pull request instead comes with pull-request mode (§13.5), not before (decided October 20, 2026).
- Keep the git host behind an adapter interface in `core`. GitLab is a later phase.

### 7.4 Drafts, review and publish (cloud)

- **Draft.** Autosaved to the SiteDO as the editor types (debounced). Never committed. Visible on the instant preview.
- **Publish.** Commits the draft (and any other drafts the user selects: "Publish 3 changes") to the default branch, then clears the drafts.
- **Request review.** Shown to users who can edit but not publish. It creates a review in the SiteDO and notifies approvers. An approver can comment, request changes or publish.
- **Conflicts.** If the file changed in git since the draft was based on it, show a simple two-column compare. Never silently overwrite.
- **History.** Comes from git. The editor shows an entry's commit history and can restore an earlier version as a new draft. Local mode (in a git repository) and GitHub mode have history too, free, and restore there as a new save (decided October 21, 2026).

### 7.5 Roles and permissions

**Account roles (agency level)**

- **Owner:** billing, and can delete the account.
- **Admin:** all sites, invites, settings.
- **Member:** the sites they are added to.
- **Billing:** billing only.

**Site roles**

- **Site admin:** settings, members, all content, publish.
- **Editor:** edit and publish within grants.
- **Contributor:** edit within grants, but cannot publish. Uses request review.
- **Viewer:** read-only, sees previews.

**Grants** scope a site role to a collection and, optionally, an entry-ID glob. For example: Admissions may edit `pages` entries matching `admissions/**` and needs approval to publish.

Site admins set grants per member in the dashboard, picking the collection and folder from the site's manifest (decided October 20, 2026). Stored with the member, that grant reads:

```ts
{ collection: 'pages', match: 'admissions/**', publish: false }
```

Permission evaluation lives in `core` and is shared by the API and the UI. The UI hides what a user can't do instead of showing it disabled, except where a short explanation helps ("Publishing needs approval").

### 7.6 Forms backend

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

### 7.7 Comments backend

- Stored in the SiteDO with a status of pending, approved or rejected.
- A moderation queue in the dashboard, with optional email notification for new comments.
- Approved comments are committed in batches by a Queue consumer, at most every few minutes per site.

### 7.8 Email

- Cloudflare Email Service binding for sending.
- A second provider (for example Resend) wired as a fallback for magic-link login emails specifically, because login email cannot fail and Email Service is still young.
- All email templates are plain, accessible HTML with a text alternative.

### 7.9 Billing and entitlements

- Stripe Checkout for sign-up and upgrades. The Stripe Customer Portal for cards, invoices and cancellation.
- Stripe webhooks update the account's plan and entitlements in D1. Entitlements are cached in KV and enforced at the edge: number of sites, editors per site, form submissions per month, media storage, white-label, SSO.
- Over-limit behavior is generous and explicit. Warn at 80% and 100%. Forms keep accepting submissions for a grace period and stay readable. Never silently drop data.

### 7.10 Security and abuse

- Verify GitHub and Stripe webhook signatures.
- The GitHub App private key lives in Worker secrets and is never logged.
- An audit log covers every write: who, what, which site, and when.
- **Data export:** each site can be exported (drafts, submissions and comments as JSON, plus media).
- **Data deletion:** a full site deletion path that also removes R2 objects.
- **Operator "view as"** is read-only, visibly bannered and always written to the audit log.

### 7.11 Observability

Structured logs with request ID and site ID, Workers Logs, optional Sentry, and a dead-letter queue for every Queue, visible in the operator console.

### 7.12 Cost reference (Cloudflare list prices, October 2026)

| Item | Pricing |
|---|---|
| Workers Paid | $5/month base. Includes 10M requests and 30M CPU-ms, then $0.30 per million requests and $0.02 per million CPU-ms. Waiting on I/O isn't billed. |
| D1 | 25B rows read and 50M rows written included each month. |
| R2 | $0.015/GB-month with free egress. 10 GB free. |
| Email Service | 3,000 emails per month included, then $0.35 per 1,000. |

**Rough monthly totals**, assuming about 60k requests, 150 emails and 0.5 GB of media per site per month:

| Sites | Est. monthly |
|---|---|
| 10 | $5 |
| 100 | ~$10 |
| 1,000 | ~$80 (mostly email) |

Stripe fees (2.9% + 30¢ per charge, plus 0.7% for Stripe Billing) will exceed infrastructure costs. Price accordingly.

### 7.13 Integrations

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

## 8. Data model (sketch)

### 8.1 Control plane (D1)

```
accounts        id, name, slug, plan, stripe_customer_id, branding_json, created_at
users           id, email, name, created_at, last_login_at
identities      id, user_id, provider (email|google|microsoft|saml), provider_subject
account_members account_id, user_id, role (owner|admin|member|billing)
sites           id, account_id, name, slug, production_url, preview_url,
                git_provider, repo_owner, repo_name, default_branch, installation_id,
                manifest_version, status (active|suspended), created_at
site_members    site_id, user_id, role (admin|editor|contributor|viewer), grants_json
invites         id, account_id, site_id?, email, role, grants_json, token_hash, expires_at
sessions        id, user_id, created_at, expires_at, ip, user_agent
entitlements    account_id, key, value                        (mirrored to KV)
usage_daily     site_id, day, requests, submissions, emails, media_bytes
audit_log       id, at, actor_user_id, actor_kind (user|operator|system), account_id,
                site_id, action, target, detail_json
operator_notes  account_id, author, body, at
```

### 8.2 Per site (Durable Object SQLite)

```
drafts          entry_key (collection/id), base_sha, data_json, body, updated_by, updated_at
reviews         id, entry_keys_json, requested_by, status, comments_json, updated_at
submissions     id, form, data_json, ip_hash, status (new|handled|spam), created_at
comments        id, entry_key, author_name, author_email_hash, body, status, created_at
repo_cache      sha, tree_json, fetched_at
counters        key, value                                     (rolled up daily to usage_daily)
```

---

## 9. Agency dashboard and operator console

### 9.1 Agency dashboard (customers), grows feature by feature

- **Phase 4:** sites list, add site, connect repository (GitHub App install), invite people, roles and grants, "Open studio" (links to the site's `/admin`).
- **Phase 5:** plan and usage, billing (links out to the Stripe Customer Portal).
- **Phase 6:** forms — inbox, notification settings, webhooks, pause.
- **Phase 7:** preview deployment URL and status.
- **Phase 8:** comments moderation.
- **Phase 9:** white-label branding for the studio and dashboard, SSO.

### 9.2 Operator console (Jeremy only), at `/ops`

Protected behind Cloudflare Access plus an operator flag on the user.

**Before Phase 5**, operator work is scripts plus the Stripe and Cloudflare dashboards. The console itself ships in Phase 5, before the first outside paying customer, and must include:

- account and site search
- read-only "view as" (bannered and audited)
- suspend or unsuspend an account or site
- comp or override a plan, with a note
- per-site usage
- spam kill switch per site or per form
- GitHub installation health (a token mint test)
- queue dead-letter viewer with retry
- audit log viewer
- email send log

---

## 10. Interface direction: clean, not busy

### 10.1 Lessons from Taproot's admin

The component library isn't the problem. Taproot uses a few Radix primitives with its own Tailwind tokens, and the token system is good: `light-dark()` pairs and contrast checking. Keep that approach. The busy feeling comes from **how much is visible at once**:

- **Navigation:** the sidebar lists every content type plus about ten other destinations (All content, Accessibility, Releases, Singletons, Media, Reusable blocks, Text snippets, Taxonomies, Menus, Settings), each with an icon.
- **Editor:** three tabs (Content, SEO, Accessibility), a permanent right sidebar for publishing and releases, a preview pane and AI buttons, all on one screen.
- **Color:** the palette has about nine roles in active use: accent, danger, warning, an AI violet, and five status hues on colored badges.

### 10.2 Principles

1. **One primary thing per screen.** On the editor screen it's the document. Everything else is one click away, not permanently visible. On wide screens the panes that lead to it, the site's collections and the collection's list, stay beside it as navigation (§10.3, decided October 25, 2026).
2. **Typography and space do the work, not boxes.** Hierarchy comes from size, weight and spacing. Avoid cards inside cards, stacked borders and shadows (shadows only on overlays).
3. **One accent color**, used only for the primary action, links, the current-location marker and focus. Everything else is neutral.
4. **Words over badges and icons.** Status is short text ("Draft · saved just now"), optionally with one small neutral dot. An icon never stands alone without a visible label, except a universal close button that has an accessible name.
5. **Progressive disclosure.** Secondary fields and settings collapse into clearly labeled sections. Advanced options live behind "More options."
6. **Calm feedback.** Autosave status appears as inline text in the top bar. No toast stacks. Errors appear inline next to what caused them.
7. **Accessible by construction.** Every rule here must also hold for keyboard, screen-reader, 200% zoom and 320px-wide use.

### 10.3 Layout

**App shell**
- A top bar holds: site name (site switcher if the user has several), a search/command palette (⌘K), and a user menu. The user menu holds Appearance (System, Light or Dark), in every mode (decided October 25, 2026). One screen at a time, it also holds a "Content" menu listing collections.
- At 48rem (768px) and wider, the studio is full width and made of panes side by side, Sanity-style (decided October 25, 2026): the structure pane (every collection with its count, then Settings, then Site), then the open collection's list, then the entry, Media or Redirects. Each pane scrolls on its own. People can collapse any pane but the deepest into a strip, and the studio folds the earliest into strips when they don't fit. Narrower, the deepest pane alone is the screen.
- The home screen is a plain list of collections and singletons, with entry counts and "last edited."

**Entry list**
- One row per entry: title, plus muted text showing who edited it and when, plus status as text.
- Hierarchical collections (`tree: true`) use the outline described in §6.15.2 instead, under the same rules.
- No thumbnails unless the collection's list config asks for one.
- Controls are one search box and one status filter. Among panes the list is a pane of its own, entry open or not, with its list fields under each title and its sort in a menu; one screen at a time it's a table, sorted by clicking column headers.

**Editor**
- A single centered column, about 720px max, in the pane beside the collection's list.
- The title field is styled as the document heading. Body fields flow beneath it in schema order.
- Top-level objects and lists are sections with their own headings, and a list's items are rows that open in place (decided October 25, 2026).
- Below the title, tabs: **Content**, then any tabs the collection declares (such as SEO), then **Details**, which holds secondary frontmatter (slug, dates, tags, anything in `vesper.config.ts` marked `placement: 'details'`). With only Content there's no tab list (decided October 25, 2026, replacing a Details section and drawer).
- **Top bar contents:** back link (one screen at a time; among panes the list beside the entry leads back), entry title (truncated), status text, Preview toggle, the primary button (Publish or Request review), and a "…" menu. The menu holds everything else: history, duplicate, delete, copy link, view on site.
- **Preview:** toggles a split view (editor and preview side by side), or full-screen on small screens. Its state is remembered per user.

**Dashboard and operator console**
- Same shell and rules.
- Tables are simple: no zebra striping, no row actions until hover or focus (and always reachable by keyboard).

### 10.4 Hard rules (the design budget)

Treat these like lint rules. Breaking one requires a note in `DECISIONS.md`.

- At most **one** primary (accent-filled) button per screen.
- At most **two** levels of navigation visible at once.
- **No colored status badges.** Status is text.
- **No icon-only buttons** except close, overflow ("…") and drag handles, plus the few `DECISIONS.md` records (among them the outline's expand toggle, the body editor's formatting tools and the panes' collapse button), and all of them have accessible names.
- No more than **five** color tokens in use on any screen, beyond neutrals: accent, accent-subtle, danger, focus, plus one optional warning.
- **No tabs inside the editor but Content, Details and the collection's own** (decided October 25, 2026). Group everything else with sections.
- Body text 15–16px, line-height ≥ 1.5. Two font weights (regular and semibold).
- Spacing comes only from the token scale. Hairline (1px) borders only.
- Every new feature must state in its PR where it lives in the UI and what it hides behind.

### 10.5 `packages/ui`: the whole kit

About fifteen components. Screens compose these and nothing else:

- **Actions:** Button (primary, secondary, quiet, danger), IconButton (always with an accessible name), Link
- **Text inputs:** TextField, TextArea
- **Choices:** Select, Combobox (search plus single or multi select, for references and tags), Checkbox, Switch, RadioGroup
- **Overlays and disclosure:** Dialog, Drawer, Menu, Disclosure (collapsible section)
- **Data display:** Table
- **Feedback:** InlineStatus, ErrorSummary

**Implementation notes**
- Build on headless accessible primitives. Radix (as in Taproot) or React Aria Components is an open decision (§13).
- Style with Tailwind 4 and our own tokens. Start from Taproot's `light-dark()` token file, cut down to the budget above.
- Include a `scripts/a11y-contrast.mjs` check like Taproot's.
- Fonts: the system UI stack by default.

### 10.6 Accessibility checklist (every screen)

Skip link, landmarks, one `h1` per page, logical heading order, visible focus, complete keyboard operability, no keyboard traps, labels on every control, errors linked with `aria-describedby` and summarized on submit, status changes announced politely, `prefers-reduced-motion` respected, 4.5:1 text contrast (3:1 for UI components), works at 200% zoom and 320px width, and drag-and-drop always has a keyboard alternative (move up/down buttons).

---

## 11. Build phases

**Standing acceptance criteria (every phase)**
- `npm run dev` brings up the playground and anything the phase touches. Seed or fixture data is included.
- Typecheck, lint and unit tests pass. New behavior has tests.
- An automated accessibility check (axe, via Playwright) passes on every new screen, plus a manual keyboard pass is noted in the PR.
- Docs: a README per package, and deployment notes for anything deployable.
- `DECISIONS.md` and `CLAUDE.md` are updated.

### Phase 0: Scaffold
- Monorepo, tooling (TypeScript strict, ESLint, Prettier, Vitest, Playwright, Changesets) and CI.
- `apps/playground` on Astro 7 with:
  - a blog collection (Markdown with `image()`, `reference()`, tags and dates; the hero image uses the §6.6.2 object shape with a focal point and one manual crop)
  - a sample of real-world photos: a large iPhone HEIC with GPS data, a portrait-orientation JPEG with an EXIF rotation, and an SVG with an embedded script, for hygiene tests
  - pages (nested folders, at least three levels deep, with `index` section pages, `_order.yaml` files, and one folder deliberately missing its index)
  - a `vesper.redirects.yaml` with a chain and a manual redirect
  - authors (JSON)
  - a settings singleton (YAML)
  - one Markdoc collection with custom tags: a block tag with children (callout), a self-closing tag (youtube), an inline tag, a partial, a variable and an `{% if %}` block
  - one MDX page using a declared component and an undeclared one
  - a locations collection (YAML) with a lat/lng object and a hex color field, both tagged with `.meta({ widget })`
  - An `events` collection with scheduling on.
  - A page with deliberate accessibility mistakes (one per layer-1 rule), kept as test fixtures and excluded from real-content checks.
  - A contact form with a department select (for routing), an upload field and a confirmation email field.
  - `<Search />` in the playground's header, with tags as a filter on the blog collection.
- **Done when:** CI is green, the playground builds statically, and the a11y check script runs.

### Phase 1: Core
- Zod → field model introspection (§6.2, §6.3.1), widget resolution (§6.3), the `fields.*` helpers (§6.3.2), manifest generation, and serializers for `.md`, `.mdx`, `.mdoc`, `.json` and `.yaml` with round-trip fidelity (§6.5).
- The storage adapter interface (list, read, write, multi-file commit).
- **Done when:**
  - Every playground collection produces a correct manifest.
  - Round-trip tests show no unrelated diffs across a corpus of at least 30 varied real-world files.
  - Unmappable schema parts fall back to the raw field.
  - Meta placed before or after `.optional()`/`.default()` resolves identically (tested).
  - An unknown widget name falls back to the inferred control with a warning (tested).

### Phase 2: Astro integration and local mode
- `astro add` support, the injected prerendered `/admin`, dev middleware, `packages/ui` v1, and admin v1:
  - home, entry list, editor, Details section
  - image upload with required alt text, upload hygiene (§6.6.6) and the media browser
  - reference picker, repeater, body editor
  - every built-in widget from §6.3.2 (color, geo, slug, url, email, datetime, select, markdown, file)
- Custom widget registration for local mode (§6.3.3), with one example widget in the playground.
- Dev toolbar app with "edit this page."
- **Done when:**
  - A fresh Astro 7 site goes from `npx astro add` to editing content in under two minutes with zero config.
  - Every §10.4 rule holds on every screen.
  - Each built-in widget meets its §6.3.2 accessibility requirements: color and geo values can be set by keyboard alone, and with a screen reader.

### Phase 2.5: Markdoc tags and MDX components
- Load `markdoc.config.mjs` into the manifest. Build tag blocks, the "/" menu and Insert button, settings forms, protected source chips, live `Markdoc.validate()`, and source-splicing saves (§6.5.1).
- Declared MDX components (§6.5.2).
- **Done when:**
  - Every tag in the playground's Markdoc collection can be inserted, configured, moved and removed by keyboard alone.
  - Editing one tag changes only that tag's text in the file (snapshot tests).
  - Variables, conditionals, functions and annotations survive any edit byte-identical.
  - A missing required attribute shows inline and blocks publish.
  - A real Markdoc site's content passes the round-trip suite (Jazzy Cabbages is a good corpus).

### Phase 2.6: URLs, hierarchy and redirects
- URL patterns with the route check, tree view, section pages, `_order.yaml`, subtree moves, the redirects file with automatic cleanup, the Redirects screen with CSV import, the link picker, link updates on move, and the site helpers (§6.15).
- **Done when:**
  - Moving a playground section with descendants produces one commit (or one set of disk renames). The commit includes the moved files, the updated `_order.yaml` files, a redirect for every old URL, and every internal link updated.
  - The built site serves every old URL as a redirect to the new one, with no chains.
  - The tree can be fully operated by keyboard and screen reader: expand, collapse, move, reorder, add a child.
  - A path colliding with a static route in `src/pages` is blocked with a plain-language message.
  - `getTree()`, `getChildren()`, `getBreadcrumbs()` and `getUrl()` return identical results in dev and in a production build. Parity with live previews is checked in Phase 7.

### Phase 2.7: Focal points, crops and `<Img>`
- `fields.image()`, declared ratios, the focal point control, crop previews, the manual crop dialog, the `<Img>` component (ratio, art direction, fluid) and the Sharp service wrapper (§6.6.2–6.6.5).
- First task: verify how Astro forwards `position` and `fit` to the image service in the current Astro 7 release, and record the finding in `DECISIONS.md`.
- **Done when:**
  - The playground hero renders correct crops at every declared ratio. A manual crop overrides the focal point only for its own ratio.
  - Art direction outputs a valid `<picture>` with per-breakpoint sources, and each source is correctly cropped.
  - The focal point and crop box can be set fully by keyboard, with values announced to screen readers.
  - Original image files are byte-identical before and after any focal-point or crop edit.
  - Disabling the service wrapper leaves the site building, with crops falling back to Astro's own server crop plus focal `object-position`.

### Phase 2.8: Accessibility checks (studio and build)
- Layer 1 studio checks, the notes drawer, and the optional publish gate.
- Layer 2 build checks writing `.vesper/a11y-report.json`.
- **Done when:**
  - Every layer-1 rule fires on the playground's deliberately flawed fixtures, with the message shown beside the right field.
  - The layer-2 report maps issues to entries.
  - No report file appears in `dist/`.
  - The notes drawer can be fully operated by keyboard and screen reader.

### Phase 2.9: Site search
- Index at build through the Node API, the `<Search>` component (dialog and inline), filters, sort and result images from the schema, "Hide from site search," the `/search` page, `opensearch.xml`, the no-JavaScript fallback, and the accessibility audit of Pagefind's Component UI.
- **Done when:**
  - Searching the playground finds pages from every searchable collection, and filtering by collection and tag works.
  - Hidden, draft and scheduled entries never appear.
  - Search works from `dist/` on the plain static test host.
  - The audit is recorded in `DECISIONS.md`, and the shipped UI passes the standing accessibility criteria with keyboard and screen readers.

### Phase 3: GitHub mode
- OAuth relay template and GitHub adapter. Multi-file atomic commits.
- **Done when:** an editor with a GitHub account can edit and publish, with an image, from a deployed static site.

### Phase 4: Cloud foundation
Confirm D13 and D15 before starting.

**Build:**
- control-plane D1 schema and migrations
- auth (magic link, Google, Microsoft)
- GitHub App install flow and git proxy
- SiteDO drafts
- studio cloud connection: `/authorize` with PKCE, site-scoped access tokens, silent re-auth, registered origins, cloud features appearing only when connected (§6.9, §7.2)
- invites, roles and grants, review flow
- dashboard v1: sites, connect repo, people, roles
- operator scripts

**Done when:**
- ThoseGeeks can onboard one real client site.
- A client editor with no GitHub account can draft, request review and get published by an approver.
- A grant scoped to a folder is enforced in both the API and the UI.
- The same client site works from an FTP-style plain static host. Sign-in, drafting, publishing and deploy status all work, with no host features (§6.16 test matrix).
- With the cloud unreachable, the studio keeps unsaved work and falls back cleanly. Signed-out users see no cloud UI at all.

### Phase 4.5: Scheduled publish and unpublish
- Build-time filtering in `vesper:content` (free), the scheduled-rebuild option in the deploy templates, the cloud alarms with deploy hook or `repository_dispatch` triggers, the Schedule dialog, the "Scheduled" view, unpublish redirects, and `holdScheduledDrafts`.
- **Done when:**
  - A post scheduled for a time 5 minutes ahead goes live on a Netlify site and on an SFTP-template site within 2 minutes of that time (cloud).
  - On a free-tier site, it appears at the first scheduled rebuild after that time.
  - An expired event 404s or redirects as configured.
  - Times display correctly in the site time zone across a daylight-saving change.

### Phase 5: Billing and operator console v1
- Stripe Checkout and Customer Portal, webhooks, entitlements and KV cache, limits and warnings.
- Operator console with everything in §9.2.
- **This phase gates the first outside paying customer.**
- **Done when:** a test account can sign up, pay, hit a limit, see a warning, upgrade and cancel, with every step in the audit log.

### Phase 6: Forms
- `defineForm`, `<Form>`, the cloud endpoint, Turnstile, the inbox, notifications, webhooks, pause and kill switches.
- Conditional routing with the test panel, file uploads (D21), confirmation emails with the D20 protections, and the expanded inbox detail view.
- **Done when:**
  - The playground contact form works with JavaScript disabled.
  - It passes the §6.13 accessibility list, verified with a screen reader.
  - Spam submissions are blocked in tests.
  - A routing rule sends Admissions submissions to one address and everything else to another.
  - A 10 MB PDF uploads with and without JavaScript, and can only be downloaded through a signed link.
  - A disallowed file type is rejected with a clear, linked error.
  - Automated tests confirm that confirmation emails can't echo non-safe fields and are rate-limited per recipient.

### Phase 6.5: Integrations
- Event system, Queues delivery with retries and the DLQ, the delivery log, and all five v1 destinations with field mapping.
- **Done when:**
  - One playground form submission reaches a webhook (signature verified), a Google Sheet row, Slack and Mailchimp.
  - A failing webhook retries, lands in the log with a retry button, and triggers the failure email.

### Phase 7: Instant previews and click-to-edit
- `vesper:content` live switching, the cloud draft read API, the side-by-side preview with `postMessage` refresh, and the overlay.
- Optional real component rendering inside Markdoc and MDX blocks (§6.5.1, v2), through the dev server and the preview deployment.
- **Done when:**
  - On an SSR-capable preview deployment (tested on at least two of Netlify, Cloudflare, Vercel and a Node host), a keystroke in the studio shows on the preview within about 2 seconds.
  - Production builds contain zero preview code (checked in CI).
  - The §6.15.7 site helpers return the same tree, breadcrumbs and URLs on the live preview as in a production build.

### Phase 8: Comments
- `<Comments>`, auto-registered comments collection, moderation queue, batched commits.
- **Done when:** a comment goes from submitted to approved to visible after the next build, and rejected comments never reach git.

### Phase 8.5: Accessibility history and scans (cloud)
- Report uploads with `VESPER_BUILD_TOKEN`, history and trends, scheduled rendered scans with plan caps, CSV and summary export, and the agency cross-site view.
- **Done when:**
  - Two builds' reports show a correct "new since last build" diff.
  - A rendered scan finds a contrast failure that layer 2 cannot.
  - The exported summary is itself accessible: tagged headings, real tables, and text alternatives.

### Phase 9: Polish and expansion
- White-label: branding (name, logo, accent) for the studio and the dashboard.
- SSO.
- GitLab adapter.
- Starlight docs site.
- `create-vesper` starter.
- Optional pull-request mode.

---

## 12. Conventions for Claude Code

- TypeScript strict everywhere. Zod 4. In anything that touches the site's schemas, import Zod from `astro/zod` so the version matches Astro's.
- `packages/core` has no framework imports. It must run in Node, in Workers and in the browser.
- Add no dependency without a one-line justification in the PR description. Prefer platform APIs.
- Small, reviewable PRs, one concern each. Conventional commit messages.
- Never commit secrets. Use `.dev.vars` locally and Wrangler secrets in production.
- Every user-facing string is plain language. No jargon like "commit," "branch" or "SHA" in the editor UI. Say "publish," "draft," "history."
- When unsure whether something belongs in the free or the paid tier, ask.

---

## 13. Open decisions

1. **Name**: decided: **Vesper**. The cloud domain is **vespercms.com** (replaces `{{domain}}`), registered at Cloudflare by Jeremy on 2026-10-20. Still to do (Jeremy): claim the `@vesper` org on npmjs.com. On October 19, 2026 no package was published under `@vesper`.
2. **Headless primitives**: decided October 17, 2026: **React Aria Components**. Radix lacks the combobox, tree, table and date/time primitives the kit needs (DECISIONS.md).
3. **Cloud license**: decided October 19, 2026: **closed, in a separate private repository**. `cloud-api` and `cloud-app` (§5) live there, not in the MIT repo. A closed license can be opened later; an open one can't be closed.
4. **Plans and prices**: decided October 19, 2026, as direction: **build entitlements on the proposed numbers below, price per site with the Agency bundle as proposed, and set the final numbers in Phase 5 from measured cost.** The original question: tiers, limits and annual-only versus monthly. Should agency billing be per site or per bundle of sites?

   **Plans and prices (proposed, not final).** Treat the numbers as **placeholders for building entitlements**, not as final prices.

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

5. **Pull-request mode** for teams that want GitHub review: decided October 19, 2026: **Phase 9, unless a paying agency asks for it sooner.** Cloud drafts and review (D13) cover most teams.
6. **MDX props without declarations**: decided October 17, 2026: **always require a declared Zod schema**. Undeclared components stay protected source chips (§6.5.2).
7. **Git Gateway–compatible API** so existing Decap sites can use the cloud without switching editors: decided October 19, 2026: **no.** Content stays as files, so an Astro site on Decap switches by installing Vesper; the API would be maintenance for a wedge that's already open.
8. **Self-hosting the cloud** for agencies that want it (for example on Coolify): decided October 19, 2026: **no.** At most, a term in an Institution contract later.
9. **Map tiles and geocoding** for `fields.geo`: tiles decided October 17, 2026: **MapLibre GL JS with OpenFreeMap by default**, overridable in `vesper.config.ts`. Geocoding decided October 19, 2026: **OpenCage, called through the cloud with caching**, once its current terms and price are checked before Phase 4. Coordinates are saved into files, so the provider's terms must allow keeping results; Nominatim's public server forbids autocomplete.
10. **Alt text suggestions**: decided October 19, 2026: **not for now; alt text stays human-written.** Machine suggestions sit close to "AI writing" on the list below. Revisit after launch. The original question: should the cloud ever offer machine-suggested alt text (clearly marked, never auto-applied, always human-confirmed)?
11. **Cloud-rendered previews for static-only hosts**: decided October 19, 2026: **deferred until after launch (D17)**; revisit if customers ask. If built, it would be a paid add-on and the one exception to D9.
12. **Conditional form fields**: decided October 19, 2026: **forms stay static, and routing covers the cases** (Phase 6). Show/hide fields move to "Considered, not adopted" below.
13. **Scan engine and caps**: decided October 19, 2026, as direction: **measure Cloudflare Browser Rendering first**, and set each plan's page caps from measured cost in Phase 8.5.
14. **Custom sending domains** for confirmation emails: decided October 19, 2026: **Agency and Institution.** The Site plan sends from Vesper's domain with reply-to set to the site owner.

### Considered, not adopted (do not build)

These came up in planning. Jeremy hasn't chosen them, so **don't build them** unless he asks.

| Idea | Status |
|---|---|
| Instant site notices (an alert banner that updates without a rebuild) | Not adopted yet |
| Monthly white-labeled client reports for agencies | Not adopted yet |
| Weekly broken-link checks, and a 404 beacon suggesting redirects | Not adopted yet |
| Uptime, SSL and domain-expiry alerts | Not adopted yet |
| Free open-source conveniences: sitemap, RSS, social share images | Not adopted yet; likely free if adopted |
| Cloud "search insights" (top searches and searches with no results, from an anonymous count of queries) | Not adopted yet; a natural paid extra to site search |
| Conditional show/hide fields inside forms (as opposed to conditional routing) | Not adopted (October 19, 2026): forms stay static, and routing covers it (§13.12) |
| Newsletter sending, payments, full analytics, machine translation, AI writing | Rejected for now: costly or support-heavy |
