import { defineToolbarApp } from 'astro/toolbar';
import { adminUrl } from 'virtual:vesper/page';

/*
 * The dev toolbar's "Edit this page" (spec §6.10): the entries the current
 * page shows, each linked straight to its editor, then the ones it only
 * lists (behind a disclosure), plus a link to the studio. The list comes
 * from the page itself (see page-entries.ts).
 */

type PageEntry = { collection: string; id: string; kind: 'shown' | 'listed'; title?: string };

function readEntries(): PageEntry[] {
  const script = document.getElementById('vesper-page-entries');
  if (!script?.textContent) return [];
  try {
    const parsed = JSON.parse(script.textContent) as unknown;
    return Array.isArray(parsed) ? (parsed as PageEntry[]) : [];
  } catch {
    return [];
  }
}

function editorUrl(entry: PageEntry): string {
  const enc = encodeURIComponent;
  return `${adminUrl}#/c/${enc(entry.collection)}/e/${enc(entry.id)}`;
}

const STYLE = `
  .panel { font: 15px/1.5 system-ui, sans-serif; color: #fff; max-height: 60vh; overflow-y: auto; }
  h2 { font-size: 16px; font-weight: 600; margin: 0 0 8px; }
  p { margin: 0 0 8px; color: #c8cbd9; }
  ul { list-style: none; margin: 0 0 12px; padding: 0; }
  li { margin: 0 0 6px; }
  a { color: #b9c4ff; text-decoration: underline; text-underline-offset: 2px; }
  a:focus-visible, summary:focus-visible { outline: 2px solid #8fb4ff; outline-offset: 2px; border-radius: 2px; }
  summary { cursor: pointer; margin: 0 0 8px; }
  .collection { color: #c8cbd9; font-size: 13px; }
`;

function entryList(entries: PageEntry[]): HTMLUListElement {
  const list = document.createElement('ul');
  for (const entry of entries.slice(0, 50)) {
    const item = document.createElement('li');
    const link = document.createElement('a');
    link.href = editorUrl(entry);
    link.textContent = entry.title ?? entry.id;
    const where = document.createElement('span');
    where.className = 'collection';
    where.textContent = ` (${entry.collection})`;
    item.append(link, where);
    list.append(item);
  }
  if (entries.length > 50) {
    const more = document.createElement('li');
    more.textContent = `And ${String(entries.length - 50)} more.`;
    list.append(more);
  }
  return list;
}

export default defineToolbarApp({
  init(canvas) {
    const panel = document.createElement('astro-dev-toolbar-window');
    const style = document.createElement('style');
    style.textContent = STYLE;
    const content = document.createElement('div');
    content.className = 'panel';
    panel.append(content);
    canvas.append(style, panel);

    const render = () => {
      const entries = readEntries();
      const shown = entries.filter((e) => e.kind === 'shown');
      const listed = entries.filter((e) => e.kind !== 'shown');
      content.replaceChildren();
      const heading = document.createElement('h2');
      heading.textContent = 'Edit this page';
      content.append(heading);
      if (shown.length > 0) {
        content.append(entryList(shown));
      } else {
        const note = document.createElement('p');
        note.textContent =
          entries.length > 0
            ? 'This page shows no single entry.'
            : 'This page doesn’t read any content through vesper:content.';
        content.append(note);
      }
      if (listed.length > 0) {
        const details = document.createElement('details');
        const summary = document.createElement('summary');
        summary.textContent = `Also listed on this page (${String(listed.length)})`;
        details.append(summary, entryList(listed));
        content.append(details);
      }
      const studio = document.createElement('a');
      studio.href = adminUrl;
      studio.textContent = 'Open the studio';
      content.append(studio);
    };

    render();
    // Astro's client-side navigation swaps the page, and with it the list.
    document.addEventListener('astro:page-load', render);
  },
});
