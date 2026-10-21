# vespercms.com

Vesper's own site: the marketing pages and the docs, edited with Vesper. It's a plain static Astro site, built on the features it documents, so it doubles as a real site to test them on (DECISIONS.md, "Vesper's own site").

## Working on it

```sh
npm run dev -w @vesper/site      # http://localhost:4321/, the studio at /admin/
npm run build -w @vesper/site    # dist/, plus .vesper/a11y-report.json beside it
npm run agents -w @vesper/site   # regenerate AGENTS.md after a schema change
```

Previews from Claude Code use port 4408 (`.claude/launch.json`), and the e2e tests serve the built site on 4409 (`e2e/site/`).

## What's where

- `src/content/pages/`: the marketing pages. `index.md` is the home page; its hero and sections are fields, edited in the studio. Any other page gets an address from its folder (`/:path`).
- `src/content/docs/`: the docs, in Markdoc. Each folder is a section with an `index.mdoc` and an `_order.yaml`; the docs menu, previous and next, and `llms.txt` all follow that tree. Two levels at most.
- `src/content/settings/site.yaml`: the header links, the footer's tagline and the repository link.
- `src/pages/llms.txt.ts`, `llms-full.txt.ts` and the `.md.ts` routes: the docs as Markdown, for AI tools.
- `AGENTS.md`: written by `vesper agents` from this site's schema. Don't edit between its markers; `CLAUDE.md` imports it for Claude Code.
- `src/styles/site.css`: the studio's Pine tokens as plain custom properties, Figtree self-hosted.

## Writing the docs

Plain language, second person, short sentences. Describe only what's built today, and check every option and default against the code, not the spec. The one tag is `callout` (`note`, `tip` or `warning`). To show Markdoc syntax, use an inline code span, or a fence with `{% process=false %}` after its language: Markdoc parses tags inside ordinary fences, so an example tag the site doesn't define fails the build.

## Deploying

Not deployed yet. The build is static files in `dist/`, so any host works. The plan is the apex of vespercms.com; the cloud is on `app.` and `api.`. `/admin` is left out of the build (`studio: { deploy: false }`) until the site is connected to the cloud, when it deploys with the site and editing goes through the cloud.
