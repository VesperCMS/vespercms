---
title: Vesper, a content editor for Astro sites
summary: Vesper builds an editor from your Astro site's content collections. Content stays as files in your repository, and the site stays static, on any host. test
hero:
  heading: The editor your Astro site already describes
  lead: Vesper reads your content collections and builds the studio from them. People edit in plain forms, every save is a file in your repository, and the site stays static on any host.
  actions:
    - label: Read the docs
      href: /docs/
    - label: Install
      href: /docs/getting-started/install/
sections:
  - heading: No second schema
    intro: Other git-based editors ask you to describe your content a second time, in their own config. Vesper reads `src/content.config.ts` instead.
    points:
      - title: Fields from your Zod schema
        body: Text, numbers, dates, lists, objects, references and images each get a control. Add a field to the schema and it's in the studio.
      - title: Hints where you need them
        body: Labels, help text and widgets come from Zod's `meta()`, or from Vesper's field helpers, which are plain Zod underneath.
      - title: Your Markdoc tags as blocks
        body: Tags from `markdoc.config.mjs` become blocks with their own settings, checked against the same rules as your build.
  - heading: Content stays yours
    intro: Everything is a file in your repository, in the format you chose.
    points:
      - title: Saves change only what changed
        body: Vesper splices each edit into the file and keeps your formatting, comments and key order, so diffs stay small and readable.
      - title: Any static host
        body: The built site and the studio are plain files. Netlify, Cloudflare, Vercel, S3 or a shared host over FTP all work, with no adapter.
      - title: Open source
        body: The studio, local editing, GitHub editing, accessibility checks and search are free, under the MIT license.
  - heading: Editing that people can do
    intro: Made for the people who write the content, not only the people who built the site.
    points:
      - title: Pages in an outline
        body: Move a page and Vesper moves its files, updates the order, adds redirects and fixes links, all in one change.
      - title: Images with focal points
        body: Editors set the focal point, and a crop for each shape the site uses. The original file is never changed.
      - title: Accessibility notes
        body: Missing alt text, skipped headings and vague links are noted beside the field, while there's still time to fix them.
      - title: Search, built in
        body: Each build indexes the site with Pagefind. Search is static files, free, on any host.
  - heading: A cloud for teams without GitHub
    intro: The paid Vesper cloud adds what a static site can't do on its own. It isn't open for sign-ups yet.
    points:
      - title: Sign in without GitHub
        body: Editors sign in with a link sent by email, and Vesper's GitHub App writes to your repository for them.
      - title: Drafts and review
        body: Saves are drafts until someone who may publish approves them, as one change.
      - title: Roles scoped to folders
        body: Give an editor one section of the site, and the studio shows them only that section.
  - heading: Works with coding agents
    intro: Your content is files, so a coding agent can already edit it. Vesper tells it how.
    points:
      - title: Instructions from your schema
        body: The vesper agents command writes a section of your AGENTS.md from your site's own collections, fields and tags, with the rules that keep the studio working.
      - title: Docs as Markdown
        body: Every page of [the docs](/docs/) is also Markdown, and [llms.txt](/llms.txt) lists them all.
---
