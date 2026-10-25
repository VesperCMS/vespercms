import type { ReactNode } from 'react';
import { Tab as RACTab, TabList, TabPanel, Tabs as RACTabs, type Key } from 'react-aria-components';
import { colorTransition, cx } from './shared.tsx';

export type TabItem = {
  id: string;
  /** The tab's words, problem count included ("Details (1 problem)"). */
  label: string;
  children: ReactNode;
};

export type TabsProps = {
  /** The tab list's accessible name, e.g. "Harbor at dawn". */
  label: string;
  tabs: TabItem[];
  selected: string;
  onSelectedChange: (id: string) => void;
};

/**
 * The entry editor's tabs (DECISIONS.md, "The entry editor has tabs"): React
 * Aria's tabs, arrow keys between them. Every panel stays in the page while
 * another is shown, inert and hidden, so a field on another tab keeps its
 * state, and going to it can switch tabs first. The chosen tab is the
 * current item: accent-subtle and its halo.
 */
export function Tabs({ label, tabs, selected, onSelectedChange }: TabsProps) {
  return (
    <RACTabs
      selectedKey={selected}
      onSelectionChange={(key: Key) => {
        onSelectedChange(String(key));
      }}
      className="flex flex-col gap-6"
    >
      <TabList aria-label={label} className="flex flex-wrap gap-1 border-b border-border pb-2">
        {tabs.map((tab) => (
          <RACTab
            key={tab.id}
            id={tab.id}
            className={cx(
              'min-h-9 cursor-default rounded-md px-3 py-1 text-label text-content-muted outline-none',
              'data-[hovered]:bg-surface-sunken data-[hovered]:text-content',
              'data-[selected]:bg-accent-subtle data-[selected]:text-content data-[selected]:shadow-glow-selected',
              'data-[focus-visible]:outline-2 data-[focus-visible]:outline-solid data-[focus-visible]:outline-offset-2 data-[focus-visible]:outline-focus',
              colorTransition,
            )}
          >
            {tab.label}
          </RACTab>
        ))}
      </TabList>
      {tabs.map((tab) => (
        <TabPanel
          key={tab.id}
          id={tab.id}
          shouldForceMount
          className="outline-none data-[inert]:hidden"
        >
          {/* Hidden as well as inert, so nothing reads or finds a tab that isn't chosen. */}
          <div data-tab={tab.id} hidden={tab.id !== selected} className="flex flex-col gap-6">
            {tab.children}
          </div>
        </TabPanel>
      ))}
    </RACTabs>
  );
}
