---
title: Vesper, a content editor for Astro sites
summary: Vesper builds an editor from your Astro site's content collections. Content stays as files in your repository, and the site stays static, on any host.
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
    image:
      src: ../../assets/home/editor-light.png
      alt: Vesper's editor for the post “Harbor at dawn”, with its title, Content and Details tabs, a summary, and a hero image with its alt text
    imageDark: ../../assets/home/editor-dark.png
    points:
      - title: Fields from your Zod schema
        body: Text, numbers, dates, lists, objects, references and images each get a control. Add a field to the schema and it's in the studio.
        icon: text-cursor-input
      - title: Hints where you need them
        body: Labels, help text and widgets come from Zod's `meta()`, or from Vesper's field helpers, which are plain Zod underneath.
        icon: sliders-horizontal
      - title: Blocks for page builders
        body: A list of `z.discriminatedUnion` objects becomes blocks. Editors add a kind from a menu, and each kind gets its own fields.
        icon: layout-template
  - heading: Your tags and components, as blocks
    intro: The body editor reads the tags in `markdoc.config.mjs`, and the MDX components you declare, and shows each one as a block with its own settings.
    image:
      src: ../../assets/home/blocks-light.png
      alt: A Markdoc body in Vesper's editor, with two callouts, a YouTube video and a partial shown as blocks, each with a Settings button
    imageDark: ../../assets/home/blocks-dark.png
    points:
      - title: Settings, not syntax
        body: A block's settings are its attributes, with the same controls as fields. Changing one rewrites only that attribute's bytes.
        icon: blocks
      - title: Checked like your build
        body: The studio reads the body with the parser and options your site builds with, and won't save one the build would refuse.
        icon: shield-check
      - title: Tables as a grid
        body: Pipe tables are edited cell by cell, with rows and columns that move, in Markdown, Markdoc and MDX alike.
        icon: table
  - heading: Content stays yours
    intro: Everything is a file in your repository, in the format you chose.
    points:
      - title: Saves change only what changed
        body: Vesper splices each edit into the file and keeps your formatting, comments and key order, so diffs stay small and readable.
        icon: file-diff
      - title: Any static host
        body: The built site and the studio are plain files. Netlify, Cloudflare, Vercel, S3 or a shared host over FTP all work, with no adapter.
        icon: globe
      - title: Open source
        body: The studio, local editing, GitHub editing, accessibility checks and search are free, under the MIT license.
        icon: code-xml
  - heading: Editing that people can do
    intro: Made for the people who write the content, not only the people who built the site.
    points:
      - title: Pages in an outline
        body: Move a page and Vesper moves its files, updates the order, adds redirects and fixes links, all in one change.
        icon: list-tree
        image:
          src: ../../assets/home/outline-light.png
          alt: Vesper's Pages outline with Academics, Nursing and Clinical placements unfolded, and that page open in the editor beside it
        imageDark: ../../assets/home/outline-dark.png
      - title: Images with focal points
        body: Editors set the focal point, and a crop for each shape the site uses. The original file is never changed.
        icon: crop
        image:
          src: ../../assets/home/focal-light.png
          alt: An image field's focal point marker on a harbor sunset, with Across and Down values and Wide 16:9 and Square crop previews
        imageDark: ../../assets/home/focal-dark.png
      - title: Accessibility notes
        body: Missing alt text, skipped headings and vague links are noted beside the field, while there's still time to fix them.
        icon: accessibility
        image:
          src: ../../assets/home/notes-light.png
          alt: Accessibility notes under a page body in Vesper, such as alt text that looks like a file name, a skipped heading level and a “click here” link
        imageDark: ../../assets/home/notes-dark.png
      - title: Media in one place
        body: The Media screen lists everything in `src/assets` and `public`, with the pages that use each file.
        icon: images
        image:
          src: ../../assets/home/media-light.png
          alt: Vesper's Media screen with four files, each with its thumbnail, folder and size, and the page that uses it
        imageDark: ../../assets/home/media-dark.png
  - heading: A cloud for teams without GitHub
    intro: The paid Vesper cloud adds what a static site can't do on its own. It isn't open for sign-ups yet.
    points:
      - title: Sign in without GitHub
        body: Editors sign in with a link sent by email, and Vesper's GitHub App writes to your repository for them.
        icon: mail
      - title: Drafts and review
        body: Saves are drafts until someone who may publish approves them, as one change.
        icon: file-check
      - title: Roles scoped to folders
        body: Give an editor one section of the site, and the studio shows them only that section.
        icon: folder-lock
  - heading: Works with coding agents
    intro: Your content is files, so a coding agent can already edit it. Vesper tells it how.
    points:
      - title: Instructions from your schema
        body: The vesper agents command writes a section of your AGENTS.md from your site's own collections, fields and tags, with the rules that keep the studio working.
        icon: bot
      - title: Docs as Markdown
        body: Every page of [the docs](/docs/) is also Markdown, and [llms.txt](/llms.txt) lists them all.
        icon: file-text
  - heading: And the rest
    intro: Smaller things that make a day of editing go well.
    points:
      - title: Search, built in
        body: Each build indexes the site with Pagefind. Search is static files, free, on any host.
        icon: search
      - title: Uploads cleaned first
        body: Location and camera data come off each photo in the browser, sideways photos turn upright, and huge ones are scaled down.
        icon: shield-check
      - title: Redirects that keep up
        body: Every move writes a redirect for each old address, and every build collapses the chains.
        icon: signpost
      - title: Keyboard all the way
        body: Blocks, tables and the page outline all move, open and reorder from the keyboard.
        icon: keyboard
      - title: Light or dark
        body: The studio follows your computer's setting, or keeps the one you choose.
        icon: sun-moon
      - title: Astro 6 and 7
        body: Vesper works with the content collections you already have, with no adapter and no server.
        icon: rocket
closing:
  heading: Add Vesper to your site
  lead: One command installs it. Then run `npm run dev`, open `/admin/` and make your first edit.
  command: npx astro add @vesper/astro
  actions:
    - label: Get started
      href: /docs/getting-started/
    - label: Read the docs
      href: /docs/
---
