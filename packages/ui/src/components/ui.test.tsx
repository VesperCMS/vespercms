// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import axe from 'axe-core';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  Button,
  Checkbox,
  Combobox,
  Dialog,
  Disclosure,
  ErrorSummary,
  IconButton,
  InlineStatus,
  Menu,
  MultiCombobox,
  RadioGroup,
  Select,
  Switch,
  Table,
  TextArea,
  TextField,
  VesperMark,
} from '../index.ts';

afterEach(cleanup);

/** axe without colour contrast: jsdom computes no layout (scripts/a11y-contrast.mjs checks the tokens). */
async function expectNoViolations(container: Element = document.body) {
  const { violations } = await axe.run(container, {
    // `region` is a whole-page rule (content inside landmarks); e2e page scans cover it.
    rules: { 'color-contrast': { enabled: false }, region: { enabled: false } },
  });
  expect(violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.html).join(' | ')}`)).toEqual([]);
}

const options = [
  { value: 'news', label: 'News' },
  { value: 'guides', label: 'Guides' },
  { value: 'stories', label: 'Stories' },
];

describe('Button and IconButton', () => {
  it('press with Enter and Space, and expose an accessible name', async () => {
    const onPress = vi.fn();
    render(
      <>
        <Button variant="primary" onPress={onPress}>
          Publish
        </Button>
        <IconButton icon="more" label="More actions" onPress={onPress} />
      </>,
    );
    const user = userEvent.setup();
    await user.tab();
    expect(screen.getByRole('button', { name: 'Publish' })).toHaveFocus();
    await user.keyboard('{Enter}');
    await user.tab();
    expect(screen.getByRole('button', { name: 'More actions' })).toHaveFocus();
    await user.keyboard(' ');
    expect(onPress).toHaveBeenCalledTimes(2);
    await expectNoViolations();
  });
});

describe('VesperMark', () => {
  it('is decorative, and draws the small cut at 24px and below', () => {
    const { container } = render(
      <>
        <VesperMark size={20} />
        <VesperMark size={48} />
      </>,
    );
    const [small, large] = [...container.querySelectorAll('svg')];
    expect(small).toHaveAttribute('aria-hidden', 'true');
    expect(large).toHaveAttribute('aria-hidden', 'true');
    // The small cut: a heavier stroke and one star, no halo.
    expect(small?.querySelector('path')).toHaveAttribute('stroke-width', '11');
    expect(small?.querySelectorAll('circle')).toHaveLength(1);
    expect(large?.querySelector('path')).toHaveAttribute('stroke-width', '9');
    expect(large?.querySelectorAll('circle')).toHaveLength(2);
  });
});

describe('TextField and TextArea', () => {
  it('link the label, help and error, and say "(required)" in words', async () => {
    render(
      <>
        <TextField
          label="Title"
          description="Shown as the page heading."
          isRequired
          isInvalid
          errorMessage="Add a title."
        />
        <TextArea label="Summary" description="One or two sentences." />
      </>,
    );
    const title = screen.getByRole('textbox', { name: /Title/ });
    expect(screen.getByText('(required)')).toBeTruthy();
    expect(title.getAttribute('aria-invalid')).toBe('true');
    const describedBy = (title.getAttribute('aria-describedby') ?? '').split(' ');
    const described = describedBy.map((id) => document.getElementById(id)?.textContent);
    expect(described).toEqual(
      expect.arrayContaining(['Shown as the page heading.', 'Add a title.']),
    );
    await expectNoViolations();
  });
});

describe('Select, Combobox and MultiCombobox', () => {
  it('Select opens and chooses with the keyboard', async () => {
    function Harness() {
      const [value, setValue] = useState<string | null>(null);
      return <Select label="Category" options={options} value={value} onChange={setValue} />;
    }
    render(<Harness />);
    const user = userEvent.setup();
    await user.tab();
    await user.keyboard('{ArrowDown}');
    await waitFor(() => {
      expect(screen.getByRole('listbox')).toBeTruthy();
    });
    await user.keyboard('{ArrowDown}{Enter}');
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Guides/ })).toBeTruthy();
    });
    await expectNoViolations();
  });

  it('Combobox filters as you type', async () => {
    const onChange = vi.fn();
    render(<Combobox label="Author" options={options} value={null} onChange={onChange} />);
    const user = userEvent.setup();
    await user.click(screen.getByRole('combobox', { name: 'Author' }));
    await user.keyboard('sto');
    await waitFor(() => {
      expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual(['Stories']);
    });
    await user.keyboard('{ArrowDown}{Enter}');
    expect(onChange).toHaveBeenCalledWith('stories');
  });

  it('MultiCombobox adds free-text tags with Enter and removes them by name', async () => {
    function Harness() {
      const [values, setValues] = useState<string[]>(['harbor']);
      return (
        <MultiCombobox
          label="Tags"
          options={[]}
          values={values}
          onChange={setValues}
          allowsCustomValue
          itemName="tag"
        />
      );
    }
    render(<Harness />);
    const user = userEvent.setup();
    await user.click(screen.getByRole('combobox', { name: 'Tags' }));
    await user.keyboard('mornings{Enter}');
    expect(screen.getByRole('button', { name: 'Remove tag mornings' })).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Remove tag harbor' }));
    expect(screen.queryByRole('button', { name: 'Remove tag harbor' })).toBeNull();
    await expectNoViolations();
  });
});

describe('Checkbox, Switch and RadioGroup', () => {
  it('toggle with Space and move with arrows', async () => {
    const onSwitch = vi.fn();
    function Harness() {
      const [value, setValue] = useState<string | null>('news');
      return (
        <>
          <Checkbox>Decorative image</Checkbox>
          <Switch onChange={onSwitch}>Draft</Switch>
          <RadioGroup label="Category" options={options} value={value} onChange={setValue} />
        </>
      );
    }
    render(<Harness />);
    const user = userEvent.setup();
    await user.tab();
    await user.keyboard(' ');
    expect(screen.getByRole('checkbox', { name: 'Decorative image' })).toBeChecked();
    await user.tab();
    await user.keyboard(' ');
    expect(onSwitch).toHaveBeenCalledWith(true);
    await user.tab();
    await user.keyboard('{ArrowDown}');
    expect(screen.getByRole('radio', { name: 'Guides' })).toBeChecked();
    await expectNoViolations();
  });
});

describe('Dialog, Menu and Disclosure', () => {
  it('Dialog traps focus, closes on Escape and returns focus', async () => {
    function Harness() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <Button
            onPress={() => {
              setOpen(true);
            }}
          >
            Delete…
          </Button>
          <Dialog title="Delete this page?" isOpen={open} onOpenChange={setOpen} role="alertdialog">
            <p>This removes the file in one save.</p>
          </Dialog>
        </>
      );
    }
    render(<Harness />);
    const user = userEvent.setup();
    const trigger = screen.getByRole('button', { name: 'Delete…' });
    await user.click(trigger);
    expect(screen.getByRole('alertdialog', { name: 'Delete this page?' })).toBeTruthy();
    await expectNoViolations();
    await user.keyboard('{Escape}');
    await waitFor(() => {
      expect(screen.queryByRole('alertdialog')).toBeNull();
      expect(trigger).toHaveFocus();
    });
  });

  it('Dialog comes in a wide size for work on images, and scrolls rather than overflowing', () => {
    render(
      <Dialog title="Adjust the crop" isOpen onOpenChange={() => {}} size="wide">
        <p>The image</p>
      </Dialog>,
    );
    const dialog = screen.getByRole('dialog', { name: 'Adjust the crop' });
    const modal = dialog.parentElement;
    expect(modal?.className).toContain('max-w-3xl');
    expect(modal?.className).toContain('overflow-y-auto');
  });

  it('Menu opens from its named trigger and acts on Enter', async () => {
    const onAction = vi.fn();
    render(
      <Menu
        label="More actions"
        items={[
          { id: 'history', label: 'History' },
          { id: 'delete', label: 'Delete', isDanger: true },
        ]}
        onAction={onAction}
      />,
    );
    const user = userEvent.setup();
    // Opening from the keyboard focuses the first item.
    await user.tab();
    await user.keyboard('{Enter}');
    await waitFor(() => expect(screen.getByRole('menuitem', { name: 'History' })).toHaveFocus());
    await user.keyboard('{ArrowDown}{Enter}');
    expect(onAction).toHaveBeenCalledWith('delete');
  });

  it('Disclosure toggles its panel and reports aria-expanded', async () => {
    render(
      <Disclosure title="Details">
        <p>Slug, dates and tags.</p>
      </Disclosure>,
    );
    const user = userEvent.setup();
    const trigger = screen.getByRole('button', { name: 'Details' });
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    await user.click(trigger);
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByText('Slug, dates and tags.')).toBeTruthy();
    await expectNoViolations();
  });
});

describe('Table, InlineStatus and ErrorSummary', () => {
  it('Table renders rows with a row header and an accessible name', async () => {
    render(
      <Table
        label="Blog posts"
        columns={[
          { id: 'title', label: 'Title', isRowHeader: true },
          { id: 'status', label: 'Status' },
        ]}
        rows={[{ id: 'a', title: 'Harbor at dawn', status: 'Published' }]}
        renderCell={(row, column) => (column === 'title' ? row.title : row.status)}
      />,
    );
    expect(screen.getByRole('grid', { name: 'Blog posts' })).toBeTruthy();
    expect(screen.getByRole('rowheader', { name: 'Harbor at dawn' })).toBeTruthy();
    await expectNoViolations();
  });

  it('InlineStatus is a polite status in words', () => {
    render(<InlineStatus dot>Draft · saved just now</InlineStatus>);
    expect(screen.getByRole('status').textContent).toBe('Draft · saved just now');
  });

  it('ErrorSummary takes focus and links each error to its field', async () => {
    render(
      <>
        <ErrorSummary errors={[{ fieldId: 'title', message: 'Add a title.' }]} />
        <input id="title" aria-label="Title" />
      </>,
    );
    expect(screen.getByRole('alert')).toHaveFocus();
    const user = userEvent.setup();
    await user.click(screen.getByRole('link', { name: 'Add a title.' }));
    expect(screen.getByRole('textbox', { name: 'Title' })).toHaveFocus();
    await expectNoViolations();
  });
});
