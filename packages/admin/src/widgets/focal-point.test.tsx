// @vitest-environment jsdom
import type { EntryDocument, SaveRequest } from '@vesper/core';
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { expectNoViolations, fakeApi, renderStudio } from '../test/helpers.tsx';
import { describeFocus } from './focal-point.tsx';

/*
 * The focal point control (spec §6.6.4): click or keys, 1% steps and 10%
 * with Shift, the across and down number fields, and a polite announcement.
 */

beforeAll(() => {
  // jsdom has no pointer capture; the control only needs the call to exist.
  Element.prototype.setPointerCapture = () => undefined;
});

afterEach(() => {
  cleanup();
  window.location.hash = '';
});

const heroValue = {
  src: '../../assets/blog/harbor-at-dawn.jpg',
  alt: 'An orange sun over a harbor',
  focus: { x: 0.62, y: 0.35 },
  crops: { square: { x: 0.4, y: 0.1, w: 0.45, h: 0.675 } },
};

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
    hero: heroValue,
    author: 'ada',
    category: 'stories',
    publishedAt: { $date: '2026-09-14T00:00:00.000Z' },
  },
  body: '\n',
};

async function open(hero: Record<string, unknown> = heroValue) {
  const api = fakeApi({
    documents: {
      'blog/harbor-at-dawn': {
        ...harbor,
        data: { ...(harbor.data as Record<string, unknown>), hero },
      },
    },
  });
  renderStudio('#/c/blog/e/harbor-at-dawn', { api });
  const user = userEvent.setup();
  const group = await screen.findByRole('group', { name: 'Hero' });
  await user.click(within(group).getByRole('button', { name: 'Focal point & crops' }));
  return { api, user, group, control: within(group).getByRole('button', { name: 'Focal point' }) };
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

describe('the focal point control', () => {
  it('sits behind one "Focal point & crops" disclosure, closed at first', async () => {
    const api = fakeApi({ documents: { 'blog/harbor-at-dawn': harbor } });
    renderStudio('#/c/blog/e/harbor-at-dawn', { api });
    const group = await screen.findByRole('group', { name: 'Hero' });
    const disclosure = within(group).getByRole('button', { name: 'Focal point & crops' });
    expect(disclosure).toHaveAttribute('aria-expanded', 'false');
    expect(within(group).queryByRole('button', { name: 'Focal point' })).not.toBeInTheDocument();
  });

  it('describes the point in words and passes axe', async () => {
    const { control, group } = await open();
    expect(control).toHaveAccessibleDescription(
      /^62% across, 35% down The focal point stays in view/,
    );
    expect(within(group).getByRole('spinbutton', { name: 'Across (%)' })).toHaveValue(62);
    expect(within(group).getByRole('spinbutton', { name: 'Down (%)' })).toHaveValue(35);
    await expectNoViolations();
  });

  it('moves 1% with the arrow keys and 10% with Shift, and announces each move', async () => {
    const { api, user, control, group } = await open();
    control.focus();
    await user.keyboard('{ArrowRight}{ArrowRight}{ArrowUp}');
    expect(within(group).getByRole('spinbutton', { name: 'Across (%)' })).toHaveValue(64);
    expect(within(group).getByRole('spinbutton', { name: 'Down (%)' })).toHaveValue(34);
    expect(within(group).getByText('Focal point 64% across, 34% down.')).toHaveAttribute(
      'role',
      'status',
    );
    await user.keyboard('{Shift>}{ArrowDown}{ArrowLeft}{/Shift}');
    expect(within(group).getByText('Focal point 54% across, 44% down.')).toBeInTheDocument();
    // It stops at the edges.
    await user.keyboard(
      '{Shift>}{ArrowLeft}{ArrowLeft}{ArrowLeft}{ArrowLeft}{ArrowLeft}{ArrowLeft}{/Shift}',
    );
    expect(within(group).getByRole('spinbutton', { name: 'Across (%)' })).toHaveValue(0);
    const hero = await savedHero(user, api);
    expect(hero.focus).toEqual({ x: 0, y: 0.44 });
    // Nothing else about the image changed.
    expect(hero.src).toBe('../../assets/blog/harbor-at-dawn.jpg');
    expect(hero.crops).toEqual({ square: { x: 0.4, y: 0.1, w: 0.45, h: 0.675 } });
  });

  it('sets the point where the image is clicked', async () => {
    const { api, user, control, group } = await open();
    const image = control.querySelector('img') as HTMLImageElement;
    vi.spyOn(image, 'getBoundingClientRect').mockReturnValue(
      DOMRect.fromRect({ x: 100, y: 50, width: 400, height: 200 }),
    );
    fireEvent.pointerDown(control, { button: 0, pointerId: 1, clientX: 200, clientY: 100 });
    fireEvent.pointerUp(control, { button: 0, pointerId: 1, clientX: 200, clientY: 100 });
    expect(within(group).getByText('Focal point 25% across, 25% down.')).toBeInTheDocument();
    expect((await savedHero(user, api)).focus).toEqual({ x: 0.25, y: 0.25 });
  });

  it('is set with the number fields, without seeing or pointing', async () => {
    const { api, user, group } = await open({
      src: '../../assets/blog/harbor-at-dawn.jpg',
      alt: 'An orange sun over a harbor',
    });
    const across = within(group).getByRole('spinbutton', { name: 'Across (%)' });
    expect(across).toHaveValue(null);
    expect(across).toHaveAccessibleDescription('0 is the left edge, 100 the right');
    await user.type(across, '30');
    expect((await savedHero(user, api)).focus).toEqual({ x: 0.3, y: 0.5 });
  });

  it('goes back to the centre by removing the focal point', async () => {
    const { api, user, group } = await open();
    await user.click(within(group).getByRole('button', { name: 'Use the center' }));
    expect(within(group).getByText('Focal point back to the center.')).toBeInTheDocument();
    expect(await savedHero(user, api)).not.toHaveProperty('focus');
  });
});

describe('describeFocus', () => {
  it('reads as words, with the centre when there is no point', () => {
    expect(describeFocus({ x: 0.62, y: 0.35 })).toBe('62% across, 35% down');
    expect(describeFocus(undefined)).toBe('50% across, 50% down');
  });
});
