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
 * state, and going to it can switch tabs first. The chosen tab is marked
 * by a line in the accent under its words, on the list's hairline.
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
      <TabList aria-label={label} className="flex flex-wrap gap-x-6 border-b border-border">
        {tabs.map((tab) => (
          <RACTab
            key={tab.id}
            id={tab.id}
            className={cx(
              // The chosen tab's mark is a line in the accent along the list's hairline:
              // the current-location marker (spec §10.2), drawn, so the border stays a hairline.
              'relative -mb-px flex min-h-10 cursor-default items-center rounded-sm text-label text-content-muted outline-none',
              "after:absolute after:inset-x-0 after:bottom-0 after:h-0.5 after:rounded-full after:content-['']",
              'data-[hovered]:text-content data-[hovered]:after:bg-border-strong',
              'data-[selected]:text-content data-[selected]:after:bg-accent',
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
