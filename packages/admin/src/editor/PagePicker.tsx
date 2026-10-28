import type { PageLink } from '@vespercms/core';
import { Button, Combobox, Dialog } from '@vespercms/ui';
import { useEffect, useMemo, useState } from 'react';
import type { StudioApi } from '../app/api.ts';
import { useStudio } from '../app/context.tsx';

/*
 * The link picker (spec §6.15.6): editors find a page by its title, and the
 * editor writes that page's current address. Content stays plain Markdown
 * or a plain string, and a move later rewrites the link.
 */

const cache = new WeakMap<StudioApi, Promise<PageLink[]>>();

/** Every page with a URL on the site, loaded once per studio. Empty until it arrives, or if it fails. */
export function usePages(): PageLink[] {
  const { api } = useStudio();
  const [pages, setPages] = useState<PageLink[]>([]);
  useEffect(() => {
    let live = true;
    let pending = cache.get(api);
    if (!pending) {
      pending = api.listPages();
      cache.set(api, pending);
    }
    pending.then(
      (found) => {
        if (live) setPages(found);
      },
      () => {
        // Without the list, links are typed by hand, as before.
        cache.delete(api);
      },
    );
    return () => {
      live = false;
    };
  }, [api]);
  return pages;
}

/** Pages as link suggestions: found by title, inserted as their address. */
export function pageSuggestions(pages: readonly PageLink[]) {
  return pages.map((page) => ({ value: page.url, label: page.title, detail: page.url }));
}

/**
 * "Choose a page…" beside a URL field: a dialog with a searchable list of
 * pages. `absolute` puts the site's address in front, for fields whose
 * schema accepts only full URLs.
 */
export function ChoosePageButton({
  onPick,
  absolute,
  fieldLabel,
  isDisabled,
}: {
  onPick: (url: string) => void;
  absolute?: string;
  fieldLabel: string;
  isDisabled?: boolean;
}) {
  const pages = usePages();
  const [open, setOpen] = useState(false);
  const options = useMemo(
    () =>
      pages.map((page) => ({
        value: absolute ? new URL(page.url, absolute).href : page.url,
        label: `${page.title} (${page.url})`,
      })),
    [pages, absolute],
  );
  if (pages.length === 0) return null;
  return (
    <>
      <Button
        variant="quiet"
        {...(isDisabled ? { isDisabled } : {})}
        onPress={() => {
          setOpen(true);
        }}
        aria-label={`Choose a page for ${fieldLabel}`}
      >
        Choose a page…
      </Button>
      <Dialog title="Choose a page" isOpen={open} onOpenChange={setOpen}>
        <Combobox
          label="Page"
          description="Search by title. Its address goes in the field."
          options={options}
          value={null}
          onChange={(value) => {
            if (value) {
              onPick(value);
              setOpen(false);
            }
          }}
        />
      </Dialog>
    </>
  );
}
