// @vitest-environment jsdom
import { focalCrop, siteRatios, type EntryDocument, type SaveRequest } from '@vesper/core';
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { expectNoViolations, fakeApi, playgroundManifest, renderStudio } from '../test/helpers.tsx';
import { cropStyle, describeCrop, ratioName } from './crops.tsx';
import { fieldRatios } from './image.tsx';

/*
 * Crop previews and the crop dialog (spec §6.6.4): a preview per ratio that
 * follows the focal point, "Custom crop" in words, and a dialog whose box
 * moves with the arrow keys, resizes with Shift, applies with Enter and
 * cancels with Escape. "Reset to focal point" removes the override.
 */

beforeAll(() => {
  Element.prototype.setPointerCapture = () => undefined;
});

afterEach(() => {
  cleanup();
  window.location.hash = '';
});

const square = { x: 0.4, y: 0.1, w: 0.45, h: 0.675 };
const harbor: EntryDocument = {
  collection: 'blog',
  id: 'harbor-at-dawn',
  path: 'src/content/blog/harbor-at-dawn.md',
  version: 'v1',
  format: 'md',
  status: 'editable',
  data: {
    title: 'Harbor at dawn',
    summary: 'Boats.',
    hero: {
      src: '../../assets/blog/harbor-at-dawn.jpg',
      alt: 'An orange sun over a harbor',
      focus: { x: 0.62, y: 0.35 },
      crops: { square },
    },
    author: 'ada',
    category: 'stories',
    publishedAt: { $date: '2026-09-14T00:00:00.000Z' },
  },
  body: '\n',
};

/** The image has loaded at the harbor illustration's size, 2400×1600. */
function loadImage(group: HTMLElement) {
  const image = within(group).getByRole('button', { name: 'Focal point' }).querySelector('img');
  if (!image) throw new Error('no image');
  Object.defineProperty(image, 'naturalWidth', { value: 2400 });
  Object.defineProperty(image, 'naturalHeight', { value: 1600 });
  fireEvent.load(image);
}

async function open() {
  const api = fakeApi({ documents: { 'blog/harbor-at-dawn': harbor } });
  renderStudio('#/c/blog/e/harbor-at-dawn', { api });
  const user = userEvent.setup();
  const group = await screen.findByRole('group', { name: 'Hero (optional)' });
  await user.click(within(group).getByRole('button', { name: 'Focal point & crops' }));
  loadImage(group);
  return { api, user, group, crops: await within(group).findByRole('list', { name: 'Crops' }) };
}

async function savedHero(
  user: ReturnType<typeof userEvent.setup>,
  api: ReturnType<typeof fakeApi>,
): Promise<Record<string, unknown>> {
  await user.click(screen.getByRole('button', { name: 'Save' }));
  await waitFor(() => {
    expect(api.saveEntry).toHaveBeenCalled();
  });
  const request = api.saveEntry.mock.calls.at(-1)?.[0] as SaveRequest & {
    data: { hero: Record<string, unknown> };
  };
  return request.data.hero;
}

describe('crop previews', () => {
  it('shows the field’s ratios, named, with "Custom crop" in words', async () => {
    const { crops } = await open();
    const items = within(crops).getAllByRole('listitem');
    expect(items.map((item) => item.querySelector('figcaption')?.textContent)).toEqual([
      'Wide · 16:9',
      'Square · 1:1 · Custom crop',
    ]);
    expect(within(crops).getByRole('button', { name: 'Adjust crop for Wide' })).toBeInTheDocument();
    await expectNoViolations();
  });

  it('follows the focal point live, and the custom crop stays put', async () => {
    const { user, group, crops } = await open();
    const [wide, squarePreview] = within(crops)
      .getAllByRole('listitem')
      .map((item) => item.querySelector('figure img') as HTMLImageElement);
    const before = wide?.style.top;
    const squareBefore = squarePreview?.style.left;
    within(group).getByRole('button', { name: 'Focal point' }).focus();
    await user.keyboard('{Shift>}{ArrowDown}{ArrowDown}{/Shift}');
    expect(wide?.style.top).not.toBe(before);
    expect(squarePreview?.style.left).toBe(squareBefore);
    // The preview shows exactly the focal crop.
    expect(wide?.style.top).toBe(
      cropStyle(focalCrop({ width: 2400, height: 1600 }, 16 / 9, { x: 0.62, y: 0.55 })).top,
    );
  });
});

describe('the crop dialog', () => {
  it('moves the box with the arrow keys, resizes it with Shift, and applies with Enter', async () => {
    const { api, user, crops } = await open();
    await user.click(within(crops).getByRole('button', { name: 'Adjust crop for Wide' }));
    const dialog = await screen.findByRole('dialog', { name: 'Adjust the Wide crop' });
    const box = within(dialog).getByRole('application', { name: 'Crop box for Wide (16:9)' });
    expect(box).toHaveFocus();
    expect(box).toHaveAccessibleDescription(
      /^0% from the left, 0% from the top, 100% of the width Drag the box/,
    );
    await expectNoViolations();
    // Shrink by 20% of the width, around the centre, then move right and down.
    await user.keyboard('{Shift>}' + '{ArrowLeft}'.repeat(20) + '{/Shift}');
    await user.keyboard('{ArrowRight}{ArrowRight}{ArrowDown}');
    expect(within(dialog).getByRole('status')).toHaveTextContent(
      'Crop 12% from the left, 9% from the top, 80% of the width.',
    );
    await user.keyboard('{Enter}');
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
    expect(within(crops).getByRole('button', { name: 'Adjust crop for Wide' })).toHaveFocus();
    expect(within(crops).getAllByRole('listitem')[0]).toHaveTextContent(
      'Wide · 16:9 · Custom crop',
    );
    const hero = await savedHero(user, api);
    const crop = (hero.crops as Record<string, { x: number; y: number; w: number; h: number }>)
      .wide;
    expect(crop).toMatchObject({ x: 0.12, w: 0.8 });
    expect(crop?.y).toBeCloseTo(0.0944, 4);
    // Still 16:9 on the 3:2 image, and the square crop is untouched.
    expect(((crop?.w ?? 0) * 2400) / ((crop?.h ?? 1) * 1600)).toBeCloseTo(16 / 9, 2);
    expect((hero.crops as Record<string, unknown>).square).toEqual(square);
  });

  it('cancels with Escape, changing nothing', async () => {
    const { api, user, crops } = await open();
    await user.click(within(crops).getByRole('button', { name: 'Adjust crop for Square' }));
    await screen.findByRole('dialog', { name: 'Adjust the Square crop' });
    await user.keyboard('{ArrowLeft}{ArrowLeft}{Escape}');
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
    expect(screen.queryByText('Unsaved changes')).not.toBeInTheDocument();
    expect(api.saveEntry).not.toHaveBeenCalled();
  });

  it('writes nothing when an automatic crop is applied untouched', async () => {
    const { user, crops } = await open();
    await user.click(within(crops).getByRole('button', { name: 'Adjust crop for Wide' }));
    const dialog = await screen.findByRole('dialog', { name: 'Adjust the Wide crop' });
    expect(within(dialog).queryByRole('button', { name: 'Reset to focal point' })).toBeNull();
    await user.click(within(dialog).getByRole('button', { name: 'Apply crop' }));
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
    expect(screen.queryByText('Unsaved changes')).not.toBeInTheDocument();
  });

  it('resets a custom crop to the focal point', async () => {
    const { api, user, crops, group } = await open();
    await user.click(within(crops).getByRole('button', { name: 'Adjust crop for Square' }));
    const dialog = await screen.findByRole('dialog', { name: 'Adjust the Square crop' });
    // Starts from the stored crop.
    expect(within(dialog).getByRole('application')).toHaveAccessibleDescription(
      /^40% from the left, 10% from the top, 45% of the width/,
    );
    await user.click(within(dialog).getByRole('button', { name: 'Reset to focal point' }));
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
    expect(within(group).getByText('Square crop reset to the focal point.')).toBeInTheDocument();
    expect(within(crops).getAllByRole('listitem')[1]).not.toHaveTextContent('Custom crop');
    // The last crop gone, `crops` goes too.
    expect(await savedHero(user, api)).not.toHaveProperty('crops');
  });

  it('drags a corner to resize, keeping the ratio', async () => {
    const { api, user, crops } = await open();
    await user.click(within(crops).getByRole('button', { name: 'Adjust crop for Wide' }));
    const dialog = await screen.findByRole('dialog', { name: 'Adjust the Wide crop' });
    const image = dialog.querySelector('img') as HTMLImageElement;
    image.getBoundingClientRect = () => DOMRect.fromRect({ x: 0, y: 0, width: 600, height: 400 });
    const box = within(dialog).getByRole('application');
    const corner = box.querySelector('[data-corner="bottom-right"]') as HTMLElement;
    fireEvent.pointerDown(corner, { button: 0, pointerId: 1, clientX: 600, clientY: 337.5 });
    fireEvent.pointerMove(box, { pointerId: 1, clientX: 300, clientY: 200 });
    fireEvent.pointerUp(box, { pointerId: 1, clientX: 300, clientY: 200 });
    expect(within(dialog).getByRole('status')).toHaveTextContent(
      // Halfway down is further than halfway across, for a 16:9 box on a 3:2 image.
      'Crop 0% from the left, 0% from the top, 59% of the width.',
    );
    await user.click(within(dialog).getByRole('button', { name: 'Apply crop' }));
    const hero = await savedHero(user, api);
    expect((hero.crops as Record<string, unknown>).wide).toEqual({ x: 0, y: 0, w: 0.5926, h: 0.5 });
  });
});

describe('helpers', () => {
  it('lists the field’s ratios, or every site ratio', () => {
    const site = siteRatios(playgroundManifest.site.images?.ratios);
    const hero = playgroundManifest.collections
      .find((c) => c.name === 'blog')
      ?.fields?.find((f) => f.path[0] === 'hero');
    if (!hero) throw new Error('no hero');
    expect(fieldRatios(hero, site).map((r) => r.name)).toEqual(['wide', 'square']);
    expect(fieldRatios({ ...hero, widgetOptions: {} }, site).map((r) => r.name)).toEqual([
      'wide',
      'square',
      'portrait',
      'og',
    ]);
  });

  it('names ratios and crops in words', () => {
    expect(ratioName('wide')).toBe('Wide');
    expect(ratioName('og')).toBe('Social image');
    expect(describeCrop(square)).toBe('40% from the left, 10% from the top, 45% of the width');
  });
});
